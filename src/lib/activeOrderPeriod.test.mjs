import assert from "node:assert/strict";
import test from "node:test";
import policy from "./activeOrderPeriod.js";

const { normalizeBusinessCalendarDate, isActiveOrder, isActiveOrderSnapshot, filterActiveOrders } = policy;

test("active order period is inclusive at 13 July 2026", () => {
  assert.equal(isActiveOrder({ order_date: "2026-07-12" }), false);
  assert.equal(isActiveOrder({ order_date: "2026-07-12 23:59:59" }), false);
  assert.equal(isActiveOrder({ order_date: "2026-07-13 00:00:00" }), true);
  assert.equal(isActiveOrder({ order_date: "2026-07-13T18:30:00.000Z" }), true);
  assert.equal(isActiveOrder({ order_date: "2026-07-14" }), true);
  assert.equal(isActiveOrder({ order_date: "2026-07-13" }), true);
  assert.equal(isActiveOrder({ order_date: "13/07/2026" }), true);
  assert.equal(isActiveOrder({ order_date: "13-07-2026" }), true);
});

test("legacy date formats normalize without locale-dependent parsing", () => {
  assert.equal(normalizeBusinessCalendarDate("13/07/2026 10:20:30"), "2026-07-13");
  assert.equal(normalizeBusinessCalendarDate("13-07-2026"), "2026-07-13");
  assert.equal(normalizeBusinessCalendarDate("2026/07/13"), "2026-07-13");
  assert.equal(normalizeBusinessCalendarDate("2026-07-13T00:00:00+05:30"), "2026-07-13");
  assert.equal(normalizeBusinessCalendarDate("2026-07-13T00:00:00.000Z"), "2026-07-13");
});

test("missing, invalid, and updated-only order dates fail closed", () => {
  assert.equal(isActiveOrder({}), false);
  assert.equal(isActiveOrder({ order_date: "not-a-date" }), false);
  assert.equal(isActiveOrder({ order_date: "2026-07-12", updatedAt: "2026-07-14" }), false);
  assert.deepEqual(filterActiveOrders([{ order_date: "2026-07-12" }, { order_date: "2026-07-13" }]).length, 1);
});

test("draft and pending snapshots use their authoritative creation date", () => {
  assert.equal(isActiveOrderSnapshot({ createdAt: "2026-07-12T23:59:59+05:30" }), false);
  assert.equal(isActiveOrderSnapshot({ createdAt: "2026-07-13T00:00:00+05:30" }), true);
  assert.equal(isActiveOrderSnapshot({ order_date: "2026-07-12", createdAt: "2026-07-14" }), false);
});
