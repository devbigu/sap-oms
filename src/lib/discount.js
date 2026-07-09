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

/**
 * Determine the slab discount percentage for a given amount.
 *
 * Slab tiers (applied on amountBeforeSlab, NOT on gross):
 *   - below ₹2,50,000        → 0%
 *   - ₹2,50,000 to < ₹5,00,000 → 2%
 *   - ₹5,00,000 and above    → 5%
 */
function getSlabPercent(amount) {
  const value = roundCurrency(toValidAmount(amount));
  if (value >= DISCOUNT_UPPER_THRESHOLD) return 5;
  if (value >= DISCOUNT_LOWER_THRESHOLD) return 2;
  return 0;
}

/**
 * Legacy helper — computes slab on the raw subtotal.
 * Kept for backward compatibility with buildDiscountPayload.
 */
function calculateDiscount(subtotalAmount) {
  const subtotal = roundCurrency(toValidAmount(subtotalAmount));
  const discountPercent = getSlabPercent(subtotal);
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

/**
 * Calculate discounts **sequentially**:
 *
 * 1. baseDiscountPercent = allocated + coupon + approved custom  (capped at 100%)
 * 2. baseDiscountAmount  = grossSubtotal × baseDiscountPercent / 100
 * 3. amountBeforeSlab    = grossSubtotal − baseDiscountAmount
 * 4. slabDiscountPercent  ← determined from amountBeforeSlab (not gross)
 * 5. slabDiscountAmount  = amountBeforeSlab × slabDiscountPercent / 100
 * 6. finalPayableAmount  = amountBeforeSlab − slabDiscountAmount
 */
function calculateStackedDiscount(subtotalAmount, options = {}) {
  const subtotal = roundCurrency(toValidAmount(subtotalAmount));

  // ── Step 1: gather all base-discount sources ──────────────────────────
  const allocatedDiscountPercent = clampPercent(options.allocatedDiscountPercent);
  const couponDiscountPercent = clampPercent(options.couponDiscountPercent);
  const approvedCustomDiscountPercent = clampPercent(options.approvedCustomDiscountPercent);
  const approvedProductDiscountPercent = clampPercent(options.approvedProductDiscountPercent);

  const baseDiscountPercent = clampPercent(
    allocatedDiscountPercent +
    couponDiscountPercent +
    approvedCustomDiscountPercent +
    approvedProductDiscountPercent
  );

  // ── Step 2–3: apply base discount, get amountBeforeSlab ───────────────
  const baseDiscountAmount = roundCurrency(subtotal * (baseDiscountPercent / 100));
  const amountBeforeSlab = roundCurrency(Math.max(0, subtotal - baseDiscountAmount));

  // ── Step 4–5: determine slab from amountBeforeSlab and apply on it ────
  const slabDiscountPercent = getSlabPercent(amountBeforeSlab);
  const slabDiscountAmount = roundCurrency(amountBeforeSlab * (slabDiscountPercent / 100));

  // ── Step 6: final payable ─────────────────────────────────────────────
  const finalPayableAmount = roundCurrency(Math.max(0, amountBeforeSlab - slabDiscountAmount));

  // ── Effective totals ──────────────────────────────────────────────────
  const effectiveTotalDiscountAmount = roundCurrency(baseDiscountAmount + slabDiscountAmount);
  const effectiveTotalDiscountPercent = subtotal > 0
    ? roundCurrency((effectiveTotalDiscountAmount / subtotal) * 100)
    : 0;

  return {
    subtotal,

    // Base discount breakdown
    allocatedDiscountPercent,
    couponDiscountPercent,
    approvedCustomDiscountPercent,
    approvedProductDiscountPercent,
    baseDiscountPercent,
    baseDiscountAmount,

    // Slab (applied on amountBeforeSlab, NOT on gross)
    amountBeforeSlab,
    slabDiscountPercent,
    slabDiscountAmount,

    // Effective totals
    effectiveTotalDiscountPercent,
    effectiveTotalDiscountAmount,
    finalPayableAmount,

    // Legacy aliases — downstream code references these keys
    discountPercent: effectiveTotalDiscountPercent,
    discountAmount: effectiveTotalDiscountAmount,
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
  getSlabPercent,
  buildDiscountPayload,
  calculateDiscount,
  calculateStackedDiscount,
  getDiscountStatusMessage,
};
