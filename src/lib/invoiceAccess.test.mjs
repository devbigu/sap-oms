import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

import { canActorAccessOrder } from "./staffOrderScope.js";
import {
  DEALER_A,
  DEALER_B,
  ORDER_A_OLD,
  ORDER_B_REFERENCE,
  ORDER_C_LATER,
  ORDER_D_UNASSIGNED,
  STAFF_1_SCOPE,
} from "./orderVisibilityFixtures.mjs";

function canGenerateInvoice(order, actor) {
  return canActorAccessOrder(order, actor);
}

test("invoice access includes older, cutoff-date, and later orders", () => {
  assert.equal(canGenerateInvoice(ORDER_A_OLD, { role: "admin", actorId: "1" }), true);
  assert.equal(canGenerateInvoice(ORDER_B_REFERENCE, { role: "admin", actorId: "1" }), true);
  assert.equal(canGenerateInvoice(ORDER_C_LATER, { role: "admin", actorId: "1" }), true);
});

test("invoice access keeps staff and dealer isolation without a date cap", () => {
  assert.equal(canGenerateInvoice(ORDER_B_REFERENCE, STAFF_1_SCOPE), true);
  assert.equal(canGenerateInvoice(ORDER_D_UNASSIGNED, STAFF_1_SCOPE), false);
  assert.equal(canGenerateInvoice(ORDER_B_REFERENCE, { role: "dealer", actorId: DEALER_A }), true);
  assert.equal(canGenerateInvoice(ORDER_D_UNASSIGNED, { role: "dealer", actorId: DEALER_A }), false);
  assert.equal(canGenerateInvoice(ORDER_D_UNASSIGNED, { role: "dealer", actorId: DEALER_B }), true);
});

test("invoice generation checks actor access before summary overrides and item requests", async () => {
  const source = await fs.readFile(path.resolve("src/lib/invoicegenerator.tsx"), "utf8");
  const generationStart = source.indexOf("export async function generateOrderInvoicePDF");
  const accessGuard = source.indexOf("if (!canGenerateOrderInvoiceForActor(order, options))", generationStart);
  const summaryRequest = source.indexOf("fetchOrderSummaryOverride(order)", generationStart);
  const itemRequest = source.indexOf("fetchOrderItems(displayOrder.order_id)", generationStart);

  assert.ok(generationStart >= 0);
  assert.ok(accessGuard > generationStart);
  assert.ok(summaryRequest > accessGuard);
  assert.ok(itemRequest > accessGuard);
});

test("stored invoice upload keeps actor access and listing/deletion have no date predicate", async () => {
  const source = await fs.readFile(path.resolve("src/lib/invoicegenerator.tsx"), "utf8");
  assert.match(source, /if \(!canGenerateOrderInvoiceForActor\(order, options\)\) return \{ success: false/);
  assert.doesNotMatch(source, /\.gte\("invoice_date"/);
  assert.doesNotMatch(source, /isActiveOrder\(\{ order_date: invoice\.invoice_date \}\)/);
});

test("Dealer invoice generation compares stable actor and order owner IDs before loading details", async () => {
  const source = await fs.readFile(path.resolve("src/lib/invoicegenerator.tsx"), "utf8");
  const guard = source.indexOf("canGenerateOrderInvoiceForActor(order, options)");
  const itemFetch = source.indexOf("fetchOrderItems(displayOrder.order_id)", guard);

  assert.ok(guard >= 0);
  assert.match(source, /actor\.role !== "dealer"/);
  assert.match(source, /actor\.actorId === ownerId/);
  assert.ok(itemFetch > guard);
});
