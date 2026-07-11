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

test("Order details fetch header access fields from orderhispegination", async () => {
  const source = await fs.readFile(orderDetailPath, "utf8");
  assert.match(source, /orderhispegination\?page=1&limit=20&search=/);
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
