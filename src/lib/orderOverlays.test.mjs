import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadOverlayModule() {
  const filePath = path.resolve("src/lib/orderOverlays.ts");
  const source = await fs.readFile(filePath, "utf8");
  const mongoStubUrl = `data:text/javascript;base64,${Buffer.from('export async function getDb(){ throw new Error("not used"); }').toString("base64")}`;
  const amountStubUrl = `data:text/javascript;base64,${Buffer.from('export function resolveOrderAmounts(order){ const gross = Number(order?.grossAmount ?? order?.order_amount ?? order?.total ?? 0) || 0; const discount = Number(order?.discountAmount ?? order?.order_discount_amount ?? 0) || 0; const net = Number(order?.netPayableAmount ?? order?.order_net_amount ?? (gross - discount)) || 0; return { gross, discountAmount: discount || Math.max(0, gross - net), netPayable: net || Math.max(0, gross - discount) }; }').toString("base64")}`;
  const rewrittenSource = source
    .replace(/from\s+["']@\/lib\/mongodb["']/, `from "${mongoStubUrl}"`)
    .replace(/from\s+["']@\/lib\/orderProductNotes\.mjs["']/, `from "${pathToFileURL(path.resolve("src/lib/orderProductNotes.mjs")).href}"`)
    .replace(/from\s+["']@\/lib\/orderAmounts["']/, `from "${amountStubUrl}"`);
  const transpiled = ts.transpileModule(rewrittenSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);
}

const overlays = await loadOverlayModule();

const baseOrder = {
  order_id: "5001",
  order_dealer: "D-1",
  Dealer_Name: "Dealer One",
  accept_order: "0",
  del_status: "0",
  order_amount: "1000",
  order_discount_amount: "100",
  order_net_amount: "900",
};

const baseItems = [
  {
    orderdata_id: "L-1",
    orderdata_orderid: "5001",
    orderdata_cat_no: "ABC-100",
    product_name: "Volumetric Flask",
    orderdata_item_quantity: "10",
    orderdata_price: "50",
    packSize: "1",
    readyquantity: "0",
    orderdata_status: "0",
  },
  {
    orderdata_id: "L-2",
    orderdata_orderid: "5001",
    orderdata_cat_no: "TT-20",
    product_name: "Test Tube",
    orderdata_item_quantity: "20",
    orderdata_price: "25",
    packSize: "1",
    readyquantity: "0",
    orderdata_status: "0",
  },
];

test("pending unaccepted order is eligible for Dealer cancellation and editing", () => {
  const eligibility = overlays.resolveOrderOverlayEligibility({
    order: baseOrder,
    items: baseItems,
  });

  assert.equal(eligibility.canDealerChange, true);
  assert.equal(eligibility.reason, "eligible");
});

test("accepted order is the discovered edit cutoff", () => {
  const eligibility = overlays.resolveOrderOverlayEligibility({
    order: { ...baseOrder, accept_order: "1" },
    items: baseItems,
  });

  assert.equal(eligibility.canDealerChange, false);
  assert.equal(eligibility.reason, "order_already_accepted");
});

test("legacy or MongoDB dispatch blocks Dealer changes", () => {
  assert.equal(overlays.resolveOrderOverlayEligibility({
    order: baseOrder,
    items: [{ ...baseItems[0], readyquantity: "1" }],
  }).reason, "dispatch_already_started");

  assert.equal(overlays.resolveOrderOverlayEligibility({
    order: baseOrder,
    items: baseItems,
    dispatchRecords: [{ dispatchedQuantity: 1, updates: [] }],
  }).reason, "dispatch_already_started");
});

test("cancelled overlay marks effective order cancelled without mutating original items", () => {
  const effective = overlays.resolveEffectiveOrder({
    orderId: "5001",
    originalOrder: baseOrder,
    originalItems: baseItems,
    overlay: {
      orderId: "5001",
      dealerId: "D-1",
      status: "cancelled",
      cancellation: {
        status: "cancelled",
        reason: "Ordered by mistake",
        cancelledBy: { id: "D-1", role: "dealer" },
        cancelledAt: "2026-07-20T00:00:00.000Z",
      },
      edits: [],
      latestRevision: 0,
      source: overlays.ORDER_OVERLAY_VERSION,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    },
  });

  assert.equal(effective.isCancelled, true);
  assert.equal(effective.cancellation.reason, "Ordered by mistake");
  assert.deepEqual(effective.effectiveItems, baseItems);
});

test("edit revision records removal, replacement, and quantity changes", () => {
  const revision = overlays.buildOrderEditRevision({
    orderId: "5001",
    baseOrder,
    originalItems: baseItems,
    requestedItems: [
      {
        originalLineId: "L-1",
        orderdata_id: "L-1",
        orderdata_cat_no: "XYZ-200",
        product_name: "Conical Flask",
        orderdata_item_quantity: "10",
        orderdata_price: "60",
      },
      {
        originalLineId: "L-2",
        orderdata_id: "L-2",
        orderdata_cat_no: "TT-20",
        product_name: "Test Tube",
        orderdata_item_quantity: "30",
        orderdata_price: "25",
      },
    ],
    expectedRevision: 0,
    idempotencyKey: "edit-1",
    actor: { role: "dealer", actorId: "D-1" },
  });

  assert.equal(revision.revision, 1);
  assert.deepEqual(revision.changes.map((change) => change.type), ["replaced", "quantity_changed"]);
  assert.match(revision.changes[0].summary, /Replaced/);
  assert.match(revision.changes[1].summary, /from 20 to 30/);
});

test("edit revision rejects empty edited orders", () => {
  assert.throws(() => overlays.buildOrderEditRevision({
    orderId: "5001",
    baseOrder,
    originalItems: baseItems,
    requestedItems: [],
    expectedRevision: 0,
    actor: { role: "dealer", actorId: "D-1" },
  }), /must keep at least one item/);
});

test("latest edit revision supplies effective items and change history", () => {
  const revision = overlays.buildOrderEditRevision({
    orderId: "5001",
    baseOrder,
    originalItems: baseItems,
    requestedItems: [
      { ...baseItems[0], originalLineId: "L-1" },
      { ...baseItems[1], originalLineId: "L-2", orderdata_item_quantity: "25" },
    ],
    expectedRevision: 0,
    idempotencyKey: "edit-2",
    actor: { role: "dealer", actorId: "D-1" },
  });

  const effective = overlays.resolveEffectiveOrder({
    orderId: "5001",
    originalOrder: baseOrder,
    originalItems: baseItems,
    overlay: {
      orderId: "5001",
      dealerId: "D-1",
      status: "active",
      edits: [revision],
      latestRevision: 1,
      source: overlays.ORDER_OVERLAY_VERSION,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    },
  });

  assert.equal(effective.isEdited, true);
  assert.equal(effective.latestRevision, 1);
  assert.equal(effective.effectiveItems[1].orderdata_item_quantity, "25");
  assert.equal(effective.changeHistory[0].type, "quantity_changed");
});
