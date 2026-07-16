import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

import { isActiveOrder } from "./activeOrderPeriod.js";
import { canActorAccessOrder } from "./staffOrderScope.js";
import {
  DEALER_A,
  DEALER_B,
  ORDER_A_OLD,
  ORDER_B_CUTOFF,
  ORDER_C_LATER,
  ORDER_D_UNASSIGNED,
  STAFF_1_SCOPE,
} from "./activeOrderFixtures.mjs";

function canGenerateInvoice(order, actor) {
  return isActiveOrder(order) && canActorAccessOrder(order, actor);
}

test("invoice access rejects old orders and includes exact-cutoff and later orders", () => {
  assert.equal(canGenerateInvoice(ORDER_A_OLD, { role: "admin", actorId: "1" }), false);
  assert.equal(canGenerateInvoice(ORDER_B_CUTOFF, { role: "admin", actorId: "1" }), true);
  assert.equal(canGenerateInvoice(ORDER_C_LATER, { role: "admin", actorId: "1" }), true);
});

test("invoice access keeps staff and dealer isolation after the cutoff", () => {
  assert.equal(canGenerateInvoice(ORDER_B_CUTOFF, STAFF_1_SCOPE), true);
  assert.equal(canGenerateInvoice(ORDER_D_UNASSIGNED, STAFF_1_SCOPE), false);
  assert.equal(canGenerateInvoice(ORDER_B_CUTOFF, { role: "dealer", actorId: DEALER_A }), true);
  assert.equal(canGenerateInvoice(ORDER_D_UNASSIGNED, { role: "dealer", actorId: DEALER_A }), false);
  assert.equal(canGenerateInvoice(ORDER_D_UNASSIGNED, { role: "dealer", actorId: DEALER_B }), true);
});

test("invoice generation checks the order date before summary overrides and item requests", async () => {
  const source = await fs.readFile(path.resolve("src/lib/invoicegenerator.tsx"), "utf8");
  const generationStart = source.indexOf("export async function generateOrderInvoicePDF");
  const cutoffGuard = source.indexOf("if (!canGenerateOrderInvoiceForActor(order, options))", generationStart);
  const summaryRequest = source.indexOf("fetchOrderSummaryOverride(order)", generationStart);
  const itemRequest = source.indexOf("fetchOrderItems(displayOrder.order_id)", generationStart);

  assert.ok(generationStart >= 0);
  assert.ok(cutoffGuard > generationStart);
  assert.ok(summaryRequest > cutoffGuard);
  assert.ok(itemRequest > cutoffGuard);
});

test("stored invoice upload, listing, and deletion all enforce the same cutoff", async () => {
  const source = await fs.readFile(path.resolve("src/lib/invoicegenerator.tsx"), "utf8");
  assert.match(source, /if \(!canGenerateOrderInvoiceForActor\(order, options\)\) return \{ success: false/);
  assert.match(source, /\.gte\("invoice_date", ACTIVE_ORDER_CUTOFF_DATE\)/);
  assert.match(source, /isActiveOrder\(\{ order_date: invoice\.invoice_date \}\)/);
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
