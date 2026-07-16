import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { filterOrdersForActor } from "./staffOrderScope.js";

async function loadDealerView() {
  const filePath = path.resolve("src/lib/dealerOrderView.ts");
  const scopeUrl = pathToFileURL(path.resolve("src/lib/staffOrderScope.js")).href;
  const source = (await fs.readFile(filePath, "utf8")).replace(
    /from\s+["']@\/lib\/staffOrderScope\.js["']/g,
    `from "${scopeUrl}"`,
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const dealerView = await loadDealerView();

const orders = [
  { order_id: "A-PENDING", order_dealer: 101, order_date: "2026-07-13", accept_order: "0", order_status: "pending", order_amount: 100 },
  { order_id: "A-COMPLETE", order_dealer: "101", order_date: "2026-07-15", accept_order: "1", mtstatus: "Completed", order_net_amount: 250 },
  { order_id: "A-OLD", order_dealer: "101", order_date: "2026-07-12 23:59:59", accept_order: "0", order_status: "pending", order_amount: 900 },
  { order_id: "B-PENDING", order_dealer: "202", order_date: "2026-07-14", accept_order: "0", order_status: "pending", order_amount: 1000 },
  { order_id: "B-COMPLETE", order_dealer: 202, order_date: "2026-07-16", accept_order: "1", mtstatus: "Completed", order_amount: 2000 },
];

test("Dealer A list, totals, pending rows, recent rows, and metrics use only Dealer A active orders", () => {
  const view = dealerView.buildDealerOrderView(orders, "101");
  assert.deepEqual(view.orders.map((order) => order.order_id), ["A-PENDING", "A-COMPLETE"]);
  assert.equal(view.totalCount, 2);
  assert.equal(view.pendingCount, 1);
  assert.deepEqual(view.pendingOrders.map((order) => order.order_id), ["A-PENDING"]);
  assert.deepEqual(view.recentOrders.map((order) => order.order_id), ["A-COMPLETE", "A-PENDING"]);
  assert.equal(view.totalValue, 350);
  assert.equal(view.acceptedCount, 1);
  assert.equal(view.completedCount, 1);
  assert.equal(view.pendingCount, view.pendingOrders.length);
});

test("Dealer B receives only Dealer B post-cutoff orders", () => {
  const view = dealerView.buildDealerOrderView(orders, 202);
  assert.deepEqual(view.orders.map((order) => order.order_id), ["B-PENDING", "B-COMPLETE"]);
  assert.equal(view.pendingCount, 1);
  assert.equal(view.totalValue, 3000);
});

test("missing Dealer identity returns no global data", () => {
  assert.deepEqual(dealerView.buildDealerOrderView(orders, "").orders, []);
  assert.deepEqual(dealerView.buildDealerOrderView(orders, null).recentOrders, []);
});

test("Admin remains global post-cutoff and Staff remains assigned-dealer post-cutoff", () => {
  assert.deepEqual(
    filterOrdersForActor({ role: "admin", actorId: "1", orders }).map((order) => order.order_id),
    ["A-PENDING", "A-COMPLETE", "B-PENDING", "B-COMPLETE"],
  );
  assert.deepEqual(
    filterOrdersForActor({ role: "staff", actorId: "29", assignedDealerIds: [101], orders }).map((order) => order.order_id),
    ["A-PENDING", "A-COMPLETE"],
  );
});

test("Dealer callers use explicit identity and cache isolation without a hard-coded fallback", async () => {
  const sources = await Promise.all([
    fs.readFile(path.resolve("src/app/home/page.tsx"), "utf8"),
    fs.readFile(path.resolve("src/app/orders/page.tsx"), "utf8"),
    fs.readFile(path.resolve("src/app/dashboard/dealer/page.tsx"), "utf8"),
    fs.readFile(path.resolve("src/components/dashboard/PendingProductsDashboard.tsx"), "utf8"),
  ]);
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /return "225"|\?\? "225"/);
  assert.match(combined, /role=dealer/);
  assert.match(sources[1], /ACTIVE_ORDER_PERIOD_VERSION, actorRole, actorId/);
  assert.match(sources[2], /ACTIVE_ORDER_PERIOD_VERSION, "dealer", dealer\.Dealer_Id/);
  assert.match(sources[3], /ACTIVE_ORDER_PERIOD_VERSION[\s\S]*actor\?\.id/);
});

test("shared Pending Orders page permits Dealer scope and keys count/list requests by Dealer identity", async () => {
  const source = await fs.readFile(path.resolve("src/app/Pages/Ordermanagement/outstandingorders/page.tsx"), "utf8");
  assert.match(source, /new Set<Role>\(\['admin', 'staff', 'dealer', 'accountant'\]\)/);
  assert.match(source, /viewerRole, viewerId, page, search, statusFilter, acceptFilter/);
  assert.match(source, /role=\$\{viewerRole\}&id=\$\{encodeURIComponent\(viewerId\)\}/);
  assert.match(source, /const total\s+= typeof response\?\.total/);
});

test("Dealer dashboard search scopes headers before fetching item details and isolates item cache", async () => {
  const source = await fs.readFile(path.resolve("src/app/api/dashboard-search/route.ts"), "utf8");
  const ownershipFilter = source.indexOf("const scoped = filterOrdersForActor({");
  const detailBuild = source.indexOf("buildItemSummariesByOrderId(candidateOrders");
  assert.ok(ownershipFilter >= 0);
  assert.ok(detailBuild > ownershipFilter);
  assert.match(source, /role: actor\.role[\s\S]*actorId: actor\.actorId[\s\S]*assignedDealerIds/);
  assert.match(source, /ACTIVE_ORDER_PERIOD_VERSION}:\$\{actor\.role}:\$\{actor\.actorId/);
});

test("direct details, invoice, and reorder all retain Dealer ownership gates", async () => {
  const [detailRoute, detailPage, invoice, reorder, reorderRoute] = await Promise.all([
    fs.readFile(path.resolve("src/app/api/active-order/[id]/route.ts"), "utf8"),
    fs.readFile(path.resolve("src/app/orders/[id]/page.tsx"), "utf8"),
    fs.readFile(path.resolve("src/lib/invoicegenerator.tsx"), "utf8"),
    fs.readFile(path.resolve("src/app/dashboard/dealer/AddOrderForm/page.tsx"), "utf8"),
    fs.readFile(path.resolve("src/app/api/custom-discount-requests/[id]/route.ts"), "utf8"),
  ]);
  assert.match(detailRoute, /scopeOrdersForActor/);
  assert.match(detailPage, /buildDispatchHeaders\(currentUser\)/);
  assert.match(invoice, /actor\.actorId === ownerId/);
  assert.match(reorder, /"x-omsons-actor-role": "dealer"/);
  assert.match(reorder, /"x-omsons-actor-id": String\(user\.Dealer_Id\)/);
  assert.match(reorderRoute, /actorId !== ownerId/);
  assert.ok(reorder.indexOf("req.dealerId") < reorder.indexOf("req.orderSnapshot.products"));
});
