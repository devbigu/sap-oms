import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

import orderDate from "./orderDate.js";
import { filterOrdersForActor } from "./staffOrderScope.js";

test("orders remain visible regardless of date validity while role scope remains enforced", () => {
  const orders = [
    { order_id: "old", order_date: "2026-07-12", order_dealer: "101", order_amount: 100 },
    { order_id: "missing", order_dealer: "101", order_amount: 200 },
    { order_id: "malformed", order_date: "not-a-date", order_dealer: "101", order_amount: 300 },
    { order_id: "foreign", order_date: "2026-07-14", order_dealer: "202", order_amount: 400 },
  ];
  const before = structuredClone(orders);

  const admin = filterOrdersForActor({ role: "admin", actorId: "1", orders });
  const dealer = filterOrdersForActor({ role: "dealer", actorId: "101", orders });

  assert.deepEqual(admin.map((order) => order.order_id), ["old", "missing", "malformed", "foreign"]);
  assert.deepEqual(dealer.map((order) => order.order_id), ["old", "missing", "malformed"]);
  assert.deepEqual(orders, before);
  assert.deepEqual(orders.map((order) => order.order_amount), [100, 200, 300, 400]);
});

test("date normalization remains available only for explicit date filtering", () => {
  assert.equal(orderDate.normalizeBusinessCalendarDate("12/07/2026 10:20:30"), "2026-07-12");
  assert.equal(orderDate.normalizeBusinessCalendarDate("not-a-date"), null);
});

test("production order paths contain no removed date-cap constants or predicates", async () => {
  const files = [
    "src/lib/orderAccess.ts",
    "src/lib/orderHeaders.ts",
    "src/lib/staffOrderScope.js",
    "src/lib/invoicegenerator.tsx",
    "src/app/api/drafts/route.ts",
    "src/app/api/custom-discount-requests/route.ts",
  ];
  const source = (await Promise.all(files.map((file) => fs.readFile(path.resolve(file), "utf8")))).join("\n");

  assert.doesNotMatch(source, /ACTIVE_ORDER_CUTOFF_DATE|OUTSIDE_ACTIVE_ORDER_PERIOD|before_cutoff/);
  assert.doesNotMatch(source, /orders-from-2026-07-13|active order period/i);
  assert.doesNotMatch(source, /\.gte\(["']invoice_date["']/);
  assert.doesNotMatch(source, /createdAt\s*:\s*\{\s*\$gte/);
});
