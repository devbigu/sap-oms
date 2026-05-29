const DISCOUNT_LOWER_THRESHOLD = 250000;
const DISCOUNT_UPPER_THRESHOLD = 500000;

function toValidAmount(value) {
  if (value === null || value === undefined || value === "") return 0;

  const amount = typeof value === "number"
    ? value
    : Number(String(value).replace(/,/g, ""));

  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount;
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toValidPercent(value) {
  if (value === null || value === undefined || value === "") return 0;

  const percent = typeof value === "number"
    ? value
    : Number(String(value).replace(/%/g, ""));

  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return percent;
}

function clampPercent(value) {
  return Math.min(100, roundCurrency(toValidPercent(value)));
}

function calculateDiscount(subtotalAmount) {
  const subtotal = roundCurrency(toValidAmount(subtotalAmount));

  let discountPercent = 0;
  if (subtotal >= DISCOUNT_LOWER_THRESHOLD && subtotal <= DISCOUNT_UPPER_THRESHOLD) {
    discountPercent = 2;
  } else if (subtotal > DISCOUNT_UPPER_THRESHOLD) {
    discountPercent = 5;
  }

  const discountAmount = roundCurrency(subtotal * (discountPercent / 100));
  const finalPayableAmount = roundCurrency(Math.max(0, subtotal - discountAmount));

  return {
    discountPercent,
    discountAmount,
    finalPayableAmount,
  };
}

function buildDiscountPayload(subtotalAmount) {
  const subtotal = roundCurrency(toValidAmount(subtotalAmount));

  return {
    subtotal,
    ...calculateDiscount(subtotal),
  };
}

function calculateStackedDiscount(subtotalAmount, options = {}) {
  const subtotal = roundCurrency(toValidAmount(subtotalAmount));
  const slab = calculateDiscount(subtotal);
  const allocatedDiscountPercent = clampPercent(options.allocatedDiscountPercent);
  const couponDiscountPercent = clampPercent(options.couponDiscountPercent);
  const slabDiscountPercent = slab.discountPercent;
  const discountPercent = clampPercent(
    allocatedDiscountPercent + slabDiscountPercent + couponDiscountPercent
  );
  const discountAmount = roundCurrency(subtotal * (discountPercent / 100));
  const finalPayableAmount = roundCurrency(Math.max(0, subtotal - discountAmount));

  return {
    subtotal,
    allocatedDiscountPercent,
    slabDiscountPercent,
    couponDiscountPercent,
    discountPercent,
    discountAmount,
    finalPayableAmount,
  };
}

function getDiscountStatusMessage(discountPercent) {
  if (discountPercent === 2) return "2% Discount Applied";
  if (discountPercent === 5) return "5% Discount Applied";
  return "No Discount Available";
}

module.exports = {
  DISCOUNT_LOWER_THRESHOLD,
  DISCOUNT_UPPER_THRESHOLD,
  buildDiscountPayload,
  calculateDiscount,
  calculateStackedDiscount,
  getDiscountStatusMessage,
};
