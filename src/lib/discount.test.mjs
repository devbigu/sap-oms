import assert from "node:assert/strict";
import test from "node:test";

import discountUtils from "./discount.js";

const {
  buildDiscountPayload,
  calculateDiscount,
  calculateStackedDiscount,
  getDiscountStatusMessage,
  getSlabPercent,
} = discountUtils;

// ─── getSlabPercent ──────────────────────────────────────────────────────────

test("getSlabPercent returns 0% below ₹2,50,000", () => {
  assert.equal(getSlabPercent(249999.99), 0);
  assert.equal(getSlabPercent(100000), 0);
  assert.equal(getSlabPercent(0), 0);
});

test("getSlabPercent returns 2% at exactly ₹2,50,000", () => {
  assert.equal(getSlabPercent(250000), 2);
});

test("getSlabPercent returns 2% between ₹2,50,000 and below ₹5,00,000", () => {
  assert.equal(getSlabPercent(300000), 2);
  assert.equal(getSlabPercent(499999.99), 2);
});

test("getSlabPercent returns 5% at exactly ₹5,00,000", () => {
  assert.equal(getSlabPercent(500000), 5);
});

test("getSlabPercent returns 5% above ₹5,00,000", () => {
  assert.equal(getSlabPercent(700000), 5);
  assert.equal(getSlabPercent(1000000), 5);
});

// ─── calculateDiscount (legacy, slab-only) ───────────────────────────────────

test("calculateDiscount returns no discount below threshold", () => {
  assert.deepEqual(calculateDiscount(100000), {
    discountPercent: 0,
    discountAmount: 0,
    finalPayableAmount: 100000,
  });
});

test("calculateDiscount applies 2% at exactly the lower threshold", () => {
  assert.deepEqual(calculateDiscount(250000), {
    discountPercent: 2,
    discountAmount: 5000,
    finalPayableAmount: 245000,
  });
});

test("calculateDiscount applies 5% at exactly ₹5,00,000 (boundary fix)", () => {
  assert.deepEqual(calculateDiscount(500000), {
    discountPercent: 5,
    discountAmount: 25000,
    finalPayableAmount: 475000,
  });
});

test("calculateDiscount applies 5% above the upper threshold", () => {
  assert.deepEqual(calculateDiscount(700000), {
    discountPercent: 5,
    discountAmount: 35000,
    finalPayableAmount: 665000,
  });
});

test("calculateDiscount handles decimal subtotals", () => {
  assert.deepEqual(calculateDiscount(250000.5), {
    discountPercent: 2,
    discountAmount: 5000.01,
    finalPayableAmount: 245000.49,
  });
});

test("calculateDiscount treats null, undefined, empty, and invalid values as zero", () => {
  for (const input of [null, undefined, "", "not-a-number", Number.NaN, -100]) {
    assert.deepEqual(calculateDiscount(input), {
      discountPercent: 0,
      discountAmount: 0,
      finalPayableAmount: 0,
    });
  }
});

// ─── buildDiscountPayload ────────────────────────────────────────────────────

test("buildDiscountPayload includes submitted discount fields", () => {
  assert.deepEqual(buildDiscountPayload(320000), {
    subtotal: 320000,
    discountPercent: 2,
    discountAmount: 6400,
    finalPayableAmount: 313600,
  });
});

test("discount values update when subtotal changes", () => {
  assert.equal(buildDiscountPayload(100000).discountPercent, 0);
  assert.equal(buildDiscountPayload(300000).discountPercent, 2);
  assert.equal(buildDiscountPayload(500001).discountPercent, 5);
});

// ─── getDiscountStatusMessage ────────────────────────────────────────────────

test("getDiscountStatusMessage maps discount percent to UI status copy", () => {
  assert.equal(getDiscountStatusMessage(2), "2% Discount Applied");
  assert.equal(getDiscountStatusMessage(5), "5% Discount Applied");
  assert.equal(getDiscountStatusMessage(0), "No Discount Available");
});

// ─── calculateStackedDiscount — sequential slab logic ────────────────────────

test("calculateStackedDiscount applies slab on amountBeforeSlab, NOT on gross", () => {
  // Gross = 300000, allocated = 10%, coupon = 5%
  // baseDiscountPercent = 15%
  // baseDiscountAmount = 300000 * 0.15 = 45000
  // amountBeforeSlab = 300000 - 45000 = 255000
  // slab on 255000 = 2% (255000 >= 250000 and < 500000)
  // slabDiscountAmount = 255000 * 0.02 = 5100
  // finalPayable = 255000 - 5100 = 249900
  // effectiveTotalDiscountAmount = 45000 + 5100 = 50100
  // effectiveTotalDiscountPercent = (50100 / 300000) * 100 = 16.7
  const result = calculateStackedDiscount(300000, {
    allocatedDiscountPercent: 10,
    couponDiscountPercent: 5,
  });

  assert.equal(result.subtotal, 300000);
  assert.equal(result.allocatedDiscountPercent, 10);
  assert.equal(result.couponDiscountPercent, 5);
  assert.equal(result.baseDiscountPercent, 15);
  assert.equal(result.baseDiscountAmount, 45000);
  assert.equal(result.amountBeforeSlab, 255000);
  assert.equal(result.slabDiscountPercent, 2);
  assert.equal(result.slabDiscountAmount, 5100);
  assert.equal(result.finalPayableAmount, 249900);
  assert.equal(result.effectiveTotalDiscountAmount, 50100);
  assert.equal(result.effectiveTotalDiscountPercent, 16.7);

  // Legacy aliases
  assert.equal(result.discountPercent, 16.7);
  assert.equal(result.discountAmount, 50100);
});

test("User example: Gross=373500, base=50% → slab=0% → payable=186750", () => {
  const result = calculateStackedDiscount(373500, {
    allocatedDiscountPercent: 50,
  });

  assert.equal(result.subtotal, 373500);
  assert.equal(result.baseDiscountPercent, 50);
  assert.equal(result.baseDiscountAmount, 186750);
  assert.equal(result.amountBeforeSlab, 186750);
  assert.equal(result.slabDiscountPercent, 0);
  assert.equal(result.slabDiscountAmount, 0);
  assert.equal(result.finalPayableAmount, 186750);
});

test("Boundary: amountBeforeSlab = 249999.99 → slab 0%", () => {
  // gross = 249999.99, no base discount
  const result = calculateStackedDiscount(249999.99, {});
  assert.equal(result.amountBeforeSlab, 249999.99);
  assert.equal(result.slabDiscountPercent, 0);
  assert.equal(result.slabDiscountAmount, 0);
  assert.equal(result.finalPayableAmount, 249999.99);
});

test("Boundary: amountBeforeSlab = 250000 → slab 2%", () => {
  const result = calculateStackedDiscount(250000, {});
  assert.equal(result.amountBeforeSlab, 250000);
  assert.equal(result.slabDiscountPercent, 2);
  assert.equal(result.slabDiscountAmount, 5000);
  assert.equal(result.finalPayableAmount, 245000);
});

test("Boundary: amountBeforeSlab = 499999.99 → slab 2%", () => {
  const result = calculateStackedDiscount(499999.99, {});
  assert.equal(result.amountBeforeSlab, 499999.99);
  assert.equal(result.slabDiscountPercent, 2);
  assert.equal(result.slabDiscountAmount, 10000);
  assert.equal(result.finalPayableAmount, 489999.99);
});

test("Boundary: amountBeforeSlab = 500000 → slab 5%", () => {
  const result = calculateStackedDiscount(500000, {});
  assert.equal(result.amountBeforeSlab, 500000);
  assert.equal(result.slabDiscountPercent, 5);
  assert.equal(result.slabDiscountAmount, 25000);
  assert.equal(result.finalPayableAmount, 475000);
});

test("Base discount reduces amount enough to change slab tier", () => {
  // gross = 600000, allocated = 20%
  // baseAmount = 120000, amountBeforeSlab = 480000 → slab 2%
  const result = calculateStackedDiscount(600000, {
    allocatedDiscountPercent: 20,
  });
  assert.equal(result.amountBeforeSlab, 480000);
  assert.equal(result.slabDiscountPercent, 2);
  assert.equal(result.slabDiscountAmount, 9600);
  assert.equal(result.finalPayableAmount, 470400);
});

test("calculateStackedDiscount caps base discount at 100%", () => {
  const result = calculateStackedDiscount(700000, {
    allocatedDiscountPercent: 30,
    couponDiscountPercent: 80,
  });
  assert.equal(result.baseDiscountPercent, 100);
  assert.equal(result.baseDiscountAmount, 700000);
  assert.equal(result.amountBeforeSlab, 0);
  assert.equal(result.slabDiscountPercent, 0);
  assert.equal(result.slabDiscountAmount, 0);
  assert.equal(result.finalPayableAmount, 0);
});

test("calculateStackedDiscount with approved custom discount", () => {
  // gross = 400000, allocated = 10%, custom approved = 15%
  // base = 25%, baseAmount = 100000, beforeSlab = 300000
  // slab on 300000 = 2%, slabAmount = 6000
  // payable = 294000
  const result = calculateStackedDiscount(400000, {
    allocatedDiscountPercent: 10,
    approvedCustomDiscountPercent: 15,
  });
  assert.equal(result.baseDiscountPercent, 25);
  assert.equal(result.amountBeforeSlab, 300000);
  assert.equal(result.slabDiscountPercent, 2);
  assert.equal(result.slabDiscountAmount, 6000);
  assert.equal(result.finalPayableAmount, 294000);
});

test("calculateStackedDiscount with no options defaults everything to 0", () => {
  const result = calculateStackedDiscount(100000);
  assert.equal(result.allocatedDiscountPercent, 0);
  assert.equal(result.couponDiscountPercent, 0);
  assert.equal(result.baseDiscountPercent, 0);
  assert.equal(result.baseDiscountAmount, 0);
  assert.equal(result.amountBeforeSlab, 100000);
  assert.equal(result.slabDiscountPercent, 0);
  assert.equal(result.finalPayableAmount, 100000);
});
