import test from "node:test";
import assert from "node:assert/strict";
import {
  canActorAccessOrder,
  filterOrdersForActor,
  getAssignedDealerIds,
  getDealerAssignedStaffIds,
  resolveOrderDealerId,
  splitScopeIds,
} from "./staffOrderScope.js";
import {
  ORDER_FIXTURES,
  DEALER_A,
  ORDER_A_OLD,
  ORDER_B_REFERENCE,
  ORDER_D_UNASSIGNED,
  ORDER_E_DEALER_A,
  ORDER_F_DEALER_B,
  STAFF_1_SCOPE,
} from "./orderVisibilityFixtures.mjs";

const active = (id, dealer, extra = {}) => ({
  order_id: id,
  order_dealer: dealer,
  order_date: "2026-07-13 09:30:00",
  ...extra,
});

test("normalizes scalar, CSV, and array assignment identifiers", () => {
  assert.deepEqual(splitScopeIds(["29, 31", 29, ["32"]]), ["29", "31", "32"]);
  assert.deepEqual(getDealerAssignedStaffIds({ assignedstaff: "29,31", assignedStaff: ["32"], staff_id: 33 }), ["29", "31", "32", "33"]);
});

test("derives assigned dealers from Dealer_Id and assignment fields", () => {
  const dealers = [
    { Dealer_Id: 101, assignedstaff: "29,30" },
    { Dealer_Id: "102", assignedStaff: ["31"] },
    { Dealer_Id: "103", staff_id: 29 },
  ];
  assert.deepEqual(getAssignedDealerIds(dealers, "29"), ["101", "103"]);
});

test("staff scope is based on assigned dealer ownership, not order staff labels or dates", () => {
  const rows = [
    active("A", "101", { staffid: "999" }),
    active("B", "102", { staffid: "29", assignedstaff: "29" }),
    active("C", "101", { order_date: "2026-07-12 23:59:59" }),
  ];
  const scoped = filterOrdersForActor({ role: "staff", actorId: "29", assignedDealerIds: ["101"], orders: rows });
  assert.deepEqual(scoped.map((row) => row.order_id), ["A", "C"]);
});

test("staff scope supports confirmed dealer-id fallbacks and rejects missing ownership", () => {
  const rows = [
    active("A", undefined, { orderdata_dealerid: "101" }),
    active("B", undefined, { Dealer_Id: 101 }),
    active("C", undefined),
  ];
  assert.equal(resolveOrderDealerId(rows[0]), "101");
  assert.deepEqual(
    filterOrdersForActor({ role: "staff", actorId: 29, assignedDealerIds: [101], orders: rows }).map((row) => row.order_id),
    ["A", "B"]
  );
});

test("staff scope fails closed when identity or assignment metadata is absent", () => {
  const rows = [active("A", "101")];
  assert.deepEqual(filterOrdersForActor({ role: "staff", actorId: "", assignedDealerIds: ["101"], orders: rows }), []);
  assert.deepEqual(filterOrdersForActor({ role: "staff", actorId: "29", assignedDealerIds: [], orders: rows }), []);
  assert.deepEqual(filterOrdersForActor({ role: "unknown", actorId: "29", assignedDealerIds: ["101"], orders: rows }), []);
});

test("admin keeps global visibility and dealer keeps own visibility for every date", () => {
  const rows = [active("A", "101"), active("B", "102"), active("OLD", "101", { order_date: "2026-07-01" })];
  assert.deepEqual(filterOrdersForActor({ role: "admin", orders: rows }).map((row) => row.order_id), ["A", "B", "OLD"]);
  assert.deepEqual(filterOrdersForActor({ role: "dealer", actorId: "102", orders: rows }).map((row) => row.order_id), ["B"]);
});

test("direct access uses role and ownership without a date rule", () => {
  assert.equal(canActorAccessOrder(active("A", "101"), { role: "staff", actorId: "29", assignedDealerIds: ["101"] }), true);
  assert.equal(canActorAccessOrder(active("A", "102"), { role: "staff", actorId: "29", assignedDealerIds: ["101"] }), false);
  assert.equal(canActorAccessOrder(active("A", "101", { order_date: "2026-07-12" }), { role: "admin" }), true);
});

test("Staff 1 direct access requires assigned dealer regardless of order date", () => {
  assert.equal(canActorAccessOrder(ORDER_B_REFERENCE, STAFF_1_SCOPE), true);
  assert.equal(canActorAccessOrder(ORDER_D_UNASSIGNED, STAFF_1_SCOPE), false);
  assert.equal(canActorAccessOrder(ORDER_A_OLD, STAFF_1_SCOPE), true);
  assert.equal(canActorAccessOrder({ ...ORDER_B_REFERENCE, order_dealer: Number(DEALER_A) }, STAFF_1_SCOPE), true);
});

test("Dealer A sees all own orders with numeric and string IDs normalized", () => {
  const visible = filterOrdersForActor({ role: "dealer", actorId: Number(DEALER_A), orders: ORDER_FIXTURES });
  assert.deepEqual(visible.map((row) => String(row.order_id)), ["12001", "13001", "14001", "15001"]);
  assert.equal(canActorAccessOrder(ORDER_E_DEALER_A, { role: "dealer", actorId: DEALER_A }), true);
  assert.equal(canActorAccessOrder(ORDER_F_DEALER_B, { role: "dealer", actorId: DEALER_A }), false);
});

test("Staff pending count and list derive from the same assigned dataset for every date", () => {
  const pendingRows = [
    ORDER_B_REFERENCE,
    { ...ORDER_E_DEALER_A, order_id: "P-2" },
    { ...ORDER_E_DEALER_A, order_id: "DONE", order_status: "fulfilled" },
    ORDER_D_UNASSIGNED,
    ORDER_A_OLD,
    { ...ORDER_E_DEALER_A, order_id: "REJECTED", del_status: "1", order_status: "rejected" },
  ];
  const scoped = filterOrdersForActor({ ...STAFF_1_SCOPE, orders: pendingRows });
  const visiblePending = scoped.filter((row) => row.order_status === "pending" && row.del_status !== "1");
  const visibleIds = visiblePending.map((row) => String(row.order_id));

  assert.deepEqual(visibleIds, ["13001", "P-2", "12001"]);
  assert.equal(visiblePending.length, 3);
  assert.equal(new Set(visibleIds).size, 3);
  assert.equal(scoped.some((row) => row.order_id === ORDER_D_UNASSIGNED.order_id), false);
  assert.equal(scoped.some((row) => row.order_id === ORDER_A_OLD.order_id), true);
});
