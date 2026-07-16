import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const source = await fs.readFile(path.resolve("src/lib/activeOrderSnapshot.ts"), "utf8");

test("active-order snapshots preserve discount breakdown and invoice metadata", () => {
  for (const field of [
    "baseDiscountAmount",
    "baseDiscountPercent",
    "postBaseAmount",
    "amountBeforeSlab",
    "additionalDiscountType",
    "additionalDiscountAmount",
    "slabDiscountAmount",
    "slabDiscountPercent",
    "customDiscountAmount",
    "customDiscountPercent",
    "approvedDiscountAmount",
    "approvedDiscountPercent",
    "allocatedDiscountPercent",
    "couponDiscountPercent",
    "invoice_id",
    "invoice_number",
    "invoice_date",
  ]) {
    assert.match(source, new RegExp(`"${field}"`));
  }
});
