import test from "node:test";
import assert from "node:assert/strict";
import pricing from "./cataloguePricing.js";

test("manual order converts catalogue pack price to per-unit rupees", () => {
  assert.equal(pricing.variantPackPriceToUnitRupees(5200, 100), 52);
});

test("single-unit packs keep their catalogue price", () => {
  assert.equal(pricing.variantPackPriceToUnitRupees(125, 1), 125);
});

test("per-unit values round consistently to paise", () => {
  assert.equal(pricing.variantPackPriceToUnitRupees(100, 3), 33.33);
});
