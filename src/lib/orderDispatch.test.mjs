import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadDispatchModule() {
  const filePath = path.resolve("src/lib/orderDispatch.ts");
  const orderProductNotesUrl = pathToFileURL(path.resolve("src/lib/orderProductNotes.mjs"));
  const source = await fs.readFile(filePath, "utf8");
  const rewrittenSource = source.replace(
    /from\s+["']@\/lib\/orderProductNotes\.mjs["']/,
    `from "${orderProductNotesUrl.href}"`
  );
  const transpiled = ts.transpileModule(rewrittenSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
  return import(dataUrl);
}

const dispatch = await loadDispatchModule();

const orderDetailPath = path.resolve("src/app/orders/[id]/page.tsx");
const orderListPath = path.resolve("src/app/Pages/Ordermanagement/page.tsx");
const dispatchApiPath = path.resolve("src/app/api/order-dispatch/route.ts");
const dispatchPanelPath = path.resolve("src/components/orders/ProductDispatchPanel.tsx");

function baseRecord(overrides = {}) {
  return {
    orderId: "3841",
    orderItemId: "501",
    sku: "50/8",
    normalizedSku: "50/8",
    occurrence: 1,
    dealerId: "225",
    assignedStaffId: "77",
    orderedQuantity: 10,
    dispatchedQuantity: 4,
    currentStatus: "packing",
    updates: [],
    ...overrides,
  };
}

test("Order details load products by order header ID", async () => {
  const source = await fs.readFile(orderDetailPath, "utf8");
  assert.match(source, /orderdatalist\?id=\$\{id\}/);
});

test("Dispatch updates use product orderdata_id when available", () => {
  assert.deepEqual(
    dispatch.buildDispatchIdentity({
      orderId: "3841",
      orderItemId: "501",
      sku: "50/8",
      occurrence: 1,
    }),
    { orderItemId: "501" }
  );
});

test("Entered quantity is treated as an incremental dispatch quantity", () => {
  const updated = dispatch.applyDispatchUpdateSnapshot(baseRecord(), {
    dispatchQuantity: 3,
    status: "packing",
    remark: "Packed three cartons",
    actorId: "77",
    actorRole: "staff",
    updateId: "u1",
    createdAt: new Date("2026-07-11T10:00:00Z"),
  });

  assert.equal(updated.dispatchedQuantity, 7);
});

test("Remaining quantity is ordered minus cumulative dispatched", () => {
  assert.equal(dispatch.computeRemainingQuantity(10, 7), 3);
});

test("Quantity equal to remaining quantity succeeds", () => {
  const updated = dispatch.applyDispatchUpdateSnapshot(baseRecord(), {
    dispatchQuantity: 6,
    status: "dispatched",
    remark: "Final dispatch",
    actorId: "1",
    actorRole: "admin",
    updateId: "u2",
    createdAt: new Date("2026-07-11T10:00:00Z"),
  });

  assert.equal(updated.dispatchedQuantity, 10);
  assert.equal(updated.currentStatus, "successful");
});

test("Quantity greater than remaining is rejected", () => {
  assert.throws(() => dispatch.applyDispatchUpdateSnapshot(baseRecord(), {
    dispatchQuantity: 7,
    status: "dispatched",
    remark: "Too much",
    actorId: "1",
    actorRole: "admin",
    updateId: "u3",
    createdAt: new Date("2026-07-11T10:00:00Z"),
  }), /exceeds remaining quantity/);
});

test("Zero and negative quantities are rejected", () => {
  assert.throws(() => dispatch.applyDispatchUpdateSnapshot(baseRecord(), {
    dispatchQuantity: 0,
    status: "packing",
    remark: "Zero",
    actorId: "1",
    actorRole: "admin",
    updateId: "u4",
    createdAt: new Date("2026-07-11T10:00:00Z"),
  }), /greater than zero/);

  assert.throws(() => dispatch.applyDispatchUpdateSnapshot(baseRecord(), {
    dispatchQuantity: -2,
    status: "packing",
    remark: "Negative",
    actorId: "1",
    actorRole: "admin",
    updateId: "u5",
    createdAt: new Date("2026-07-11T10:00:00Z"),
  }), /greater than zero/);
});

test("Sequential concurrent updates cannot over-dispatch", () => {
  const first = dispatch.applyDispatchUpdateSnapshot(baseRecord(), {
    dispatchQuantity: 4,
    status: "packing",
    remark: "First save wins",
    actorId: "77",
    actorRole: "staff",
    updateId: "u6",
    createdAt: new Date("2026-07-11T10:00:00Z"),
  });

  assert.throws(() => dispatch.applyDispatchUpdateSnapshot(first, {
    dispatchQuantity: 3,
    status: "packing",
    remark: "Second overlapping save loses",
    actorId: "77",
    actorRole: "staff",
    updateId: "u7",
    createdAt: new Date("2026-07-11T10:01:00Z"),
  }), /exceeds remaining quantity/);
});

test("History appends one entry per successful update", () => {
  const updated = dispatch.applyDispatchUpdateSnapshot(baseRecord(), {
    dispatchQuantity: 2,
    status: "packing",
    remark: "Packed two units",
    actorId: "77",
    actorRole: "staff",
    updateId: "u8",
    createdAt: new Date("2026-07-11T10:00:00Z"),
  });

  assert.equal(updated.updates.length, 1);
  assert.equal(updated.updates[0].quantity, 2);
  assert.equal(updated.updates[0].remark, "Packed two units");
});

test("Failed updates do not append history", () => {
  const record = baseRecord();
  assert.throws(() => dispatch.applyDispatchUpdateSnapshot(record, {
    dispatchQuantity: 20,
    status: "packing",
    remark: "Invalid",
    actorId: "77",
    actorRole: "staff",
    updateId: "u9",
    createdAt: new Date("2026-07-11T10:00:00Z"),
  }));
  assert.equal(record.updates.length, 0);
});

test("Admin may update an authorized order", () => {
  assert.equal(dispatch.canUserEditDispatch(
    { role: "admin", id: "1" },
    { dealerId: "225", assignedStaffId: "77", acceptOrder: "1", delStatus: "0" }
  ), true);
});

test("Admin with an accepted order is allowed by the shared pure helper", () => {
  assert.equal(dispatch.canUpdateOrderDispatch(
    { role: "admin", isAssignedStaff: false, isAccepted: true, isDeleted: false }
  ), true);
});

test('Admin with accepted value "1" is allowed', () => {
  assert.equal(dispatch.canUserEditDispatch(
    { role: "admin", id: "1" },
    { dealerId: "225", assignedStaffId: "77", acceptOrder: "1", delStatus: "0" }
  ), true);
});

test("Assigned staff may update their order", () => {
  assert.equal(dispatch.canUserEditDispatch(
    { role: "staff", id: "77" },
    { dealerId: "225", assignedStaffId: "77", acceptOrder: "1", delStatus: "0" }
  ), true);
});

test("Assigned staff with an unaccepted order is blocked", () => {
  assert.equal(dispatch.canUserEditDispatch(
    { role: "staff", id: "77" },
    { dealerId: "225", assignedStaffId: "77", acceptOrder: "0", delStatus: "0" }
  ), false);
});

test("Unassigned staff receives forbidden access", () => {
  assert.equal(dispatch.canUserEditDispatch(
    { role: "staff", id: "90" },
    { dealerId: "225", assignedStaffId: "77", acceptOrder: "1", delStatus: "0" }
  ), false);
});

test("Dealer cannot update dispatch", () => {
  assert.equal(dispatch.canUserEditDispatch(
    { role: "dealer", id: "225" },
    { dealerId: "225", assignedStaffId: "77", acceptOrder: "1", delStatus: "0" }
  ), false);
});

test("Multi-item dispatch is Staff-only and still requires assignment and accepted order access", () => {
  const context = { dealerId: "225", assignedStaffId: "77", acceptOrder: "1", delStatus: "0" };
  assert.equal(dispatch.canUserBulkDispatch({ role: "staff", id: "77" }, context), true);
  assert.equal(dispatch.canUserBulkDispatch({ role: "admin", id: "1" }, context), false);
  assert.equal(dispatch.canUserBulkDispatch({ role: "dealer", id: "225" }, context), false);
  assert.equal(dispatch.canUserBulkDispatch({ role: "staff", id: "90" }, context), false);
  assert.equal(dispatch.canUserBulkDispatch({ role: "staff", id: "77" }, { ...context, acceptOrder: "0" }), false);
  assert.equal(dispatch.canUserBulkDispatch({ role: "staff", id: "77" }, { ...context, delStatus: "1" }), false);
});

test("numeric and string acceptance values normalize consistently", () => {
  assert.equal(dispatch.normalizeOrderAcceptance(1), "accepted");
  assert.equal(dispatch.normalizeOrderAcceptance("1"), "accepted");
  assert.equal(dispatch.normalizeOrderAcceptance(0), "unaccepted");
  assert.equal(dispatch.normalizeOrderAcceptance("0"), "unaccepted");
  assert.equal(dispatch.normalizeOrderAcceptance(undefined), "missing");
});

test("missing secondary status cannot erase confirmed PHP acceptance", () => {
  assert.equal(dispatch.resolveOrderAcceptance({ phpValues: [undefined, "1", ""] }), "1");
});

test("Mongo acceptance is used only when PHP acceptance is unavailable", () => {
  assert.equal(dispatch.resolveOrderAcceptance({ phpValues: [undefined, ""], mongoAccepted: "1" }), "1");
  assert.equal(dispatch.resolveOrderAcceptance({ phpValues: ["0"], mongoAccepted: "1" }), "0");
});

test("Mongo acceptance cannot override cancellation, rejection, or deletion", () => {
  assert.equal(dispatch.resolveOrderAcceptance({ phpValues: [], mongoAccepted: "1", terminalValues: ["cancelled"] }), "0");
  assert.equal(dispatch.resolveOrderAcceptance({ phpValues: [], mongoAccepted: "1", terminalValues: ["rejected"] }), "0");
  assert.equal(dispatch.resolveOrderAcceptance({ phpValues: [], mongoAccepted: "1", deleted: "1" }), "0");
});

test("Missing acceptance field safely blocks staff access", () => {
  assert.equal(dispatch.canUserEditDispatch(
    { role: "staff", id: "77" },
    { dealerId: "225", assignedStaffId: "77", acceptOrder: undefined, delStatus: "0" }
  ), false);
});

test("Product Note does not enter dispatch merge or history fields", () => {
  const merged = dispatch.mergeOrderItemsWithDispatchRecords(
    [{
      orderdata_id: "501",
      orderdata_orderid: "3841",
      orderdata_cat_no: "50/8",
      orderdata_item_quantity: "10",
      fallbackProductNote: "Pack separately",
    }],
    []
  );

  assert.equal(merged[0].fallbackProductNote, "Pack separately");
  assert.deepEqual(merged[0].dispatchHistory, []);
});

test("Operational remark does not overwrite Product Note", () => {
  const updated = dispatch.applyDispatchUpdateSnapshot(baseRecord(), {
    dispatchQuantity: 2,
    status: "packing",
    remark: "Operational packing note",
    actorId: "77",
    actorRole: "staff",
    updateId: "u10",
    createdAt: new Date("2026-07-11T10:00:00Z"),
  });

  assert.equal(updated.updates[0].remark, "Operational packing note");
});

test("Duplicate SKUs remain separate through orderItemId", () => {
  const merged = dispatch.mergeOrderItemsWithDispatchRecords(
    [
      { orderdata_id: "501", orderdata_orderid: "3841", orderdata_cat_no: "50/8", orderdata_item_quantity: "10" },
      { orderdata_id: "502", orderdata_orderid: "3841", orderdata_cat_no: "50/8", orderdata_item_quantity: "10" },
    ],
    [
      { orderId: "3841", orderItemId: "501", sku: "50/8", normalizedSku: "50/8", occurrence: 1, dispatchedQuantity: 2, orderedQuantity: 10, currentStatus: "packing", updates: [] },
      { orderId: "3841", orderItemId: "502", sku: "50/8", normalizedSku: "50/8", occurrence: 2, dispatchedQuantity: 5, orderedQuantity: 10, currentStatus: "dispatched", updates: [] },
    ]
  );

  assert.deepEqual(
    merged.map((item) => item.dispatchedQuantity),
    [2, 5]
  );
});

test("Fallback SKU occurrence matching works when orderItemId is absent", () => {
  const merged = dispatch.mergeOrderItemsWithDispatchRecords(
    [
      { orderdata_orderid: "3841", orderdata_cat_no: "50/8", orderdata_item_quantity: "10" },
      { orderdata_orderid: "3841", orderdata_cat_no: "50/8", orderdata_item_quantity: "10" },
    ],
    [
      { orderId: "3841", sku: "50/8", normalizedSku: "50/8", occurrence: 1, dispatchedQuantity: 1, orderedQuantity: 10, currentStatus: "packing", updates: [] },
      { orderId: "3841", sku: "50/8", normalizedSku: "50/8", occurrence: 2, dispatchedQuantity: 4, orderedQuantity: 10, currentStatus: "dispatched", updates: [] },
    ]
  );

  assert.deepEqual(
    merged.map((item) => item.dispatchedQuantity),
    [1, 4]
  );
});

test("Bulk dispatch plan includes only remaining dispatchable lines", () => {
  const plan = dispatch.buildBulkDispatchPlan([
    {
      orderdata_id: "501",
      orderdata_orderid: "3841",
      orderdata_cat_no: "50/8",
      product_name: "Product A",
      orderedQuantity: 10,
      dispatchedQuantity: 4,
      remainingQuantity: 6,
      dispatchStatus: "packing",
      occurrence: 1,
    },
    {
      orderdata_id: "502",
      orderdata_orderid: "3841",
      orderdata_cat_no: "51/1",
      product_name: "Product B",
      orderedQuantity: 20,
      dispatchedQuantity: 0,
      remainingQuantity: 20,
      dispatchStatus: "pending",
      occurrence: 1,
    },
    {
      orderdata_id: "503",
      orderdata_orderid: "3841",
      orderdata_cat_no: "52/1",
      product_name: "Product C",
      orderedQuantity: 5,
      dispatchedQuantity: 5,
      remainingQuantity: 0,
      dispatchStatus: "successful",
      occurrence: 1,
    },
    {
      orderdata_id: "504",
      orderdata_orderid: "3841",
      orderdata_cat_no: "53/1",
      product_name: "Product D",
      orderedQuantity: 5,
      dispatchedQuantity: 0,
      remainingQuantity: 5,
      dispatchStatus: "not_in_stock",
      occurrence: 1,
    },
  ]);

  assert.deepEqual(plan.lines.map((line) => [line.sku, line.remainingQuantity]), [
    ["50/8", 6],
    ["51/1", 20],
  ]);
  assert.equal(plan.totalQuantity, 26);
  assert.deepEqual(plan.skipped.map((line) => line.reason), [
    "Already fully dispatched",
    "Not in Stock",
  ]);
});

test("Bulk dispatch plan preserves existing item identity and duplicate SKU occurrences", () => {
  const merged = dispatch.mergeOrderItemsWithDispatchRecords(
    [
      { orderdata_id: "601", orderdata_orderid: "3841", orderdata_cat_no: "50/8", orderdata_item_quantity: "10", product_name: "First duplicate" },
      { orderdata_id: "602", orderdata_orderid: "3841", orderdata_cat_no: "50/8", orderdata_item_quantity: "10", product_name: "Second duplicate" },
    ],
    [
      { orderId: "3841", orderItemId: "601", sku: "50/8", normalizedSku: "50/8", occurrence: 1, dispatchedQuantity: 2, orderedQuantity: 10, currentStatus: "packing", updates: [] },
      { orderId: "3841", orderItemId: "602", sku: "50/8", normalizedSku: "50/8", occurrence: 2, dispatchedQuantity: 7, orderedQuantity: 10, currentStatus: "packing", updates: [] },
    ]
  );
  const plan = dispatch.buildBulkDispatchPlan(merged);

  assert.deepEqual(
    plan.lines.map((line) => ({
      orderItemId: line.orderItemId,
      sku: line.sku,
      occurrence: line.occurrence,
      remainingQuantity: line.remainingQuantity,
    })),
    [
      { orderItemId: "601", sku: "50/8", occurrence: 1, remainingQuantity: 8 },
      { orderItemId: "602", sku: "50/8", occurrence: 2, remainingQuantity: 3 },
    ]
  );
});

test("selection keys keep duplicate catalogue lines independently selectable", () => {
  assert.notEqual(
    dispatch.buildBulkDispatchLineKey({ orderItemId: null, sku: "50/8", occurrence: 1 }),
    dispatch.buildBulkDispatchLineKey({ orderItemId: null, sku: "50/8", occurrence: 2 })
  );
  assert.notEqual(
    dispatch.buildBulkDispatchLineKey({ orderItemId: "601", sku: "50/8", occurrence: 1 }),
    dispatch.buildBulkDispatchLineKey({ orderItemId: "602", sku: "50/8", occurrence: 1 })
  );
});

test("Legacy readyquantity is imported once without double-counting", () => {
  const seed = dispatch.buildLegacyDispatchSeed({
    orderId: "3841",
    orderItemId: "501",
    sku: "50/8",
    occurrence: 1,
    dealerId: "225",
    assignedStaffId: "77",
    orderedQuantity: 10,
    legacyReadyQuantity: 4,
    legacyStatus: "2",
    now: new Date("2026-07-11T10:00:00Z"),
  });

  assert.equal(seed.dispatchedQuantity, 4);
  assert.equal(seed.legacyImported, true);
  assert.equal(seed.currentStatus, "dispatched");
});

test("No request is made to PHP getremark on the order details page", async () => {
  const source = await fs.readFile(orderDetailPath, "utf8");
  assert.doesNotMatch(source, /getremark\?id=/);
});

test("No request is made to PHP addremark in the new dispatch API", async () => {
  const source = await fs.readFile(dispatchApiPath, "utf8");
  assert.doesNotMatch(source, /addremark/);
});

test("Order details fetch header access fields through the role-scoped orders-data adapter", async () => {
  const source = await fs.readFile(orderDetailPath, "utf8");
  assert.match(source, /orders-data\?source=\$\{source\}&role=\$\{encodeURIComponent\(actor\.role\)\}/);
  assert.match(source, /actor\.role === "dealer" \|\| actor\.role === "staff" \? "orderhispegination"/);
});

test("Dispatch API fetches header access fields from orderhispegination", async () => {
  const source = await fs.readFile(dispatchApiPath, "utf8");
  assert.match(source, /orderhispegination\?page=1&limit=20&search=/);
});

test("No full-page reload occurs after dispatch update", async () => {
  const source = await fs.readFile(orderDetailPath, "utf8");
  assert.doesNotMatch(source, /window\.location\.reload/);
});

test("Existing View, Accept, and Decline flows remain unchanged on the order list", async () => {
  const source = await fs.readFile(orderListPath, "utf8");
  assert.match(source, /onView=\{\(\) => router\.push\(`\/orders\/\$\{order\.order_id\}`\)\}/);
  assert.match(source, /onAccept=\{\(\) => handleAccept\(order\.order_id, 1\)\}/);
  assert.match(source, /onDecline=\{\(\) => handleAccept\(order\.order_id, 0\)\}/);
});

test("Admin and Staff use the shared dispatch component on the unified order details route", async () => {
  const source = await fs.readFile(orderDetailPath, "utf8");
  assert.match(source, /ProductDispatchPanel/);
  assert.match(source, /resolveCurrentUser/);
});

test("UI and API rely on the shared normalized dispatch access helper", async () => {
  const panelSource = await fs.readFile(dispatchPanelPath, "utf8");
  const apiSource = await fs.readFile(dispatchApiPath, "utf8");
  assert.match(panelSource, /canUserEditDispatch/);
  assert.match(panelSource, /isAcceptedOrderForDispatch/);
  assert.doesNotMatch(panelSource, /String\(acceptOrder \?\? "0"\) !== "1"/);
  assert.match(apiSource, /canUserEditDispatch/);
});

test("Order details page wires the Staff-only selected-products dispatch flow", async () => {
  const source = await fs.readFile(orderDetailPath, "utf8");
  assert.match(source, /canUserBulkDispatch/);
  assert.match(source, /buildBulkDispatchPlan\(displayOrders\)/);
  assert.match(source, /Select All Dispatchable/);
  assert.match(source, /Clear Selection/);
  assert.match(source, /Dispatch Selected \(\{selectedDispatchLines\.length\}\)/);
  assert.match(source, /Dispatch Selected Products/);
  assert.match(source, /selectedDispatchLines\.map/);
  assert.match(source, /String\(line\.remainingQuantity\)/);
  assert.match(source, /handleDispatchRecordsSaved\(records\)/);
  assert.doesNotMatch(source, /displayOrders\.forEach\(.*fetch/s);
});

test("selected-products API reuses normalized merge, bulk plan, idempotency, and guarded Mongo updates", async () => {
  const source = await fs.readFile(dispatchApiPath, "utf8");
  assert.match(source, /action.*dispatch_selected/s);
  assert.match(source, /actor\.role !== "staff"/);
  assert.match(source, /mergeOrderItemsWithDispatchRecords\(effectiveItems, docs\)/);
  assert.match(source, /buildBulkDispatchPlan\(mergedItems\)/);
  assert.match(source, /bulkUpdateId\(idempotencyKey, line\)/);
  assert.match(source, /"updates\.id": \{ \$ne: updateId \}/);
  assert.match(source, /\$expr:\s*\{\s*\$lte:/);
  assert.match(source, /fetchStaffAssignedDealerIds\(actor\.id\)/);
  assert.match(source, /const dispatchQuantity = Number\(input\.dispatchQuantity\)/);
  assert.match(source, /invalidatePendingProductsCache\(\)/);
});

test("Admin acceptance mirror runs only after the PHP acceptance request succeeds", async () => {
  const source = await fs.readFile(orderListPath, "utf8");
  const phpCall = source.indexOf("acceptstatus_requst");
  const mirrorCall = source.indexOf("mirror_acceptance");
  assert.ok(phpCall >= 0 && mirrorCall > phpCall);
  assert.match(source, /status === 1 && session\.role === 'admin'/);
});

test("acceptance mirror reuses the existing order overlay collection", async () => {
  const overlaySource = await fs.readFile(path.resolve("src/lib/orderOverlays.ts"), "utf8");
  assert.match(overlaySource, /saveAcceptedState/);
  assert.match(overlaySource, /getOrderOverlayCollection\(\)/);
  assert.doesNotMatch(overlaySource, /order_acceptance/);
});
