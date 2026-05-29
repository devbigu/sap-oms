import assert from "node:assert/strict";
import test from "node:test";

import discountUtils from "./discount.js";

const {
  buildDiscountPayload,
  calculateDiscount,
  calculateStackedDiscount,
  getDiscountStatusMessage,
} = discountUtils;

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

test("calculateDiscount applies 2% at exactly the upper threshold", () => {
  assert.deepEqual(calculateDiscount(500000), {
    discountPercent: 2,
    discountAmount: 10000,
    finalPayableAmount: 490000,
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

test("getDiscountStatusMessage maps discount percent to UI status copy", () => {
  assert.equal(getDiscountStatusMessage(2), "2% Discount Applied");
  assert.equal(getDiscountStatusMessage(5), "5% Discount Applied");
  assert.equal(getDiscountStatusMessage(0), "No Discount Available");
});

test("calculateStackedDiscount adds allocated, slab, and coupon discounts", () => {
  assert.deepEqual(calculateStackedDiscount(300000, {
    allocatedDiscountPercent: 10,
    couponDiscountPercent: 5,
  }), {
    subtotal: 300000,
    allocatedDiscountPercent: 10,
    slabDiscountPercent: 2,
    couponDiscountPercent: 5,
    discountPercent: 17,
    discountAmount: 51000,
    finalPayableAmount: 249000,
  });
});

test("calculateStackedDiscount caps total discount at 100%", () => {
  assert.deepEqual(calculateStackedDiscount(700000, {
    allocatedDiscountPercent: 30,
    couponDiscountPercent: 80,
  }), {
    subtotal: 700000,
    allocatedDiscountPercent: 30,
    slabDiscountPercent: 5,
    couponDiscountPercent: 80,
    discountPercent: 100,
    discountAmount: 700000,
    finalPayableAmount: 0,
  });
});
