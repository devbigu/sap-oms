import assert from "node:assert/strict";
import test from "node:test";

function extractOrderNoteFromRemarks(value) {
  if (typeof value !== "string") return "";
  const match = value.match(/Order note:\s*([^|]+)/i);
  return match?.[1]?.trim() || "";
}

function formatAmountText(amount) {
  return Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getReadableAdditionalDiscountText(breakdown) {
  if (breakdown?.additionalDiscountType === "slab" && Number(breakdown.slabDiscountAmount) > 0) {
    const percentText = Number(breakdown.slabDiscountPercent) > 0
      ? `${breakdown.slabDiscountPercent}%`
      : "flat";
    return `slab discount applied: ${percentText} (Rs. ${formatAmountText(breakdown.slabDiscountAmount)})`;
  }

  if (breakdown?.additionalDiscountType === "custom" && Number(breakdown.customDiscountAmount) > 0) {
    return `Approved custom discount applied: Rs. ${formatAmountText(breakdown.customDiscountAmount)}`;
  }

  return null;
}

function resolveInvoiceRemark({
  orderNote,
  note,
  savedNote,
  orderRemark,
  itemRemarks,
  reason,
  discountBreakdown,
} = {}) {
  const direct = String(orderNote || note || "").trim();
  if (direct) return direct;

  const saved = typeof savedNote === "string" ? savedNote.trim() : "";
  if (saved) return saved;

  const fromOrderRemark = extractOrderNoteFromRemarks(orderRemark);
  if (fromOrderRemark) return fromOrderRemark;

  if (Array.isArray(itemRemarks)) {
    const fromItems = itemRemarks.map((r) => extractOrderNoteFromRemarks(r)).find(Boolean);
    if (fromItems) return fromItems;
  }

  const reasonStr = typeof reason === "string" ? reason.trim() : "";
  if (reasonStr === "slab_or_approved_discount") {
    const readable = getReadableAdditionalDiscountText(discountBreakdown);
    if (readable) return readable;
  }
  if (reasonStr) return reasonStr;

  return "N/A";
}

test("direct order note still wins", () => {
  assert.equal(resolveInvoiceRemark({
    orderNote: "Deliver before Friday",
    reason: "Fallback reason",
  }), "Deliver before Friday");
});

test("item note is used before reason", () => {
  assert.equal(resolveInvoiceRemark({
    itemRemarks: ["Cat. No: 50/1 | Order note: Pack carefully | Priority delivery"],
    reason: "Fallback reason",
  }), "Pack carefully");
});

test("slab technical reason becomes readable text", () => {
  assert.equal(resolveInvoiceRemark({
    reason: "slab_or_approved_discount",
    discountBreakdown: {
      additionalDiscountType: "slab",
      slabDiscountPercent: 2,
      slabDiscountAmount: 6414.48,
      customDiscountAmount: 0,
    },
  }), "slab discount applied: 2% (Rs. 6,414.48)");
});

test("custom technical reason becomes readable text", () => {
  assert.equal(resolveInvoiceRemark({
    reason: "slab_or_approved_discount",
    discountBreakdown: {
      additionalDiscountType: "custom",
      slabDiscountPercent: 0,
      slabDiscountAmount: 0,
      customDiscountAmount: 10000,
    },
  }), "Approved custom discount applied: Rs. 10,000.00");
});

test("ambiguous historical orders fall back without inventing a label", () => {
  assert.equal(resolveInvoiceRemark({
    reason: "slab_or_approved_discount",
    discountBreakdown: {
      additionalDiscountType: null,
      slabDiscountPercent: 0,
      slabDiscountAmount: 0,
      customDiscountAmount: 0,
    },
  }), "slab_or_approved_discount");
});
