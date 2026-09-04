import assert from "node:assert/strict";
import test from "node:test";

// Mirrors getRowPricing's gross/pack derivation in src/app/orders/[id]/page.tsx.
// Backend contract (verified against /orderdatalist): orderdata_item_quantity is a
// piece count, orderdata_price its unit price, orderdata_totalprice their product.
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function pricing(o, packLookup = {}) {
  const qty = num(o.orderdata_item_quantity);
  const unitPrice = num(o.orderdata_price);
  const packSize = num(o.packSize ?? packLookup[o.orderdata_cat_no]) || 1;
  const explicitPieces = num(o.totalPieces);
  const explicitPacks = num(o.quantityPacks);
  const lineTotal = num(o.orderdata_totalprice);
  const explicitGross = num(o.listPriceTotal);
  const gross = explicitGross > 0 ? explicitGross : lineTotal > 0 ? lineTotal : qty * unitPrice;
  const pieces = explicitPieces > 0 ? explicitPieces : qty;
  const packs = explicitPacks > 0 ? explicitPacks
    : packSize > 1 ? (pieces > 0 ? Math.max(1, Math.round(pieces / packSize)) : 0)
    : pieces;
  return { gross, pieces, packs, packSize };
}

test("gross uses the backend line total, not discount+net", () => {
  // 20% discount: discount+net would have reconstructed the gross only at 50%.
  const r = pricing({ orderdata_item_quantity: "60", orderdata_price: "634",
    orderdata_discount: "7608", orderdata_afterDisPrice: "30432", orderdata_totalprice: "38040" });
  assert.equal(r.gross, 38040);
});

test("gross falls back to qty * unit price when no line total is sent", () => {
  assert.equal(pricing({ orderdata_item_quantity: "10", orderdata_price: "100" }).gross, 1000);
});

test("quantity is pieces; packs divide by pack size and never multiply", () => {
  const r = pricing({ orderdata_cat_no: "163/1", orderdata_item_quantity: "100",
    orderdata_price: "50", orderdata_totalprice: "5000" }, { "163/1": 10 });
  assert.equal(r.pieces, 100);
  assert.equal(r.packs, 10);
  assert.equal(r.gross, 5000);
});

test("pack size of 1 leaves packs equal to pieces", () => {
  const r = pricing({ orderdata_item_quantity: "7", orderdata_price: "10", orderdata_totalprice: "70" });
  assert.equal(r.packs, 7);
  assert.equal(r.pieces, 7);
});

test("explicit pieces and packs from an overlay win over inference", () => {
  const r = pricing({ orderdata_cat_no: "163/1", orderdata_item_quantity: "1",
    totalPieces: "50", quantityPacks: "5", orderdata_price: "10", orderdata_totalprice: "500" },
    { "163/1": 10 });
  assert.equal(r.pieces, 50);
  assert.equal(r.packs, 5);
});

test("zero quantity yields zero packs, not a phantom pack", () => {
  assert.equal(pricing({ orderdata_cat_no: "163/1", orderdata_item_quantity: "0" }, { "163/1": 10 }).packs, 0);
});

// ── Stale stored totals after a quantity edit ────────────────────────────────
// Mirrors the updated getRowPricing: quantity is authoritative, so a stored
// total describing the OLD quantity is rebuilt from the line's own rate.
function pricingV2(o, packLookup = {}, orderMeta = null) {
  const orderedQuantity = num(o.orderdata_item_quantity);
  const unitPrice = num(o.orderdata_price);
  const packSize = num(o.packSize ?? packLookup[o.orderdata_cat_no]) || 1;
  const explicitPieces = num(o.totalPieces);
  const storedDiscount = num(o.orderdata_discount);
  const storedNet = num(o.orderdata_afterDisPrice);

  const pieces = explicitPieces > 0 ? explicitPieces : orderedQuantity;
  const packs = packSize > 1 ? (pieces > 0 ? Math.max(1, Math.round(pieces / packSize)) : 0) : pieces;

  const lineTotal = num(o.orderdata_totalprice);
  const explicitGross = num(o.listPriceTotal);
  const storedGross = explicitGross > 0 ? explicitGross : lineTotal;
  const computedGross = pieces * unitPrice;
  const gross = computedGross > 0 ? computedGross : storedGross;
  const stale = storedGross > 0 && computedGross > 0 && Math.abs(storedGross - computedGross) > 0.02;

  const perItemPct = num(o.totalDiscountPercent ?? o.discount);
  const orderPct = num(orderMeta?.discountPercent);
  const base = storedGross > 0 ? storedGross : gross;
  const derivedPct = base > 0 && storedDiscount > 0 ? Math.round((storedDiscount / base) * 10000) / 100 : 0;
  const pct = perItemPct || orderPct || derivedPct;

  const discount = !stale && storedDiscount > 0 ? storedDiscount : gross * (pct / 100);
  const final = !stale && storedNet > 0 ? storedNet : Math.max(0, gross - discount);
  return { gross, discount, final, pieces, packs, pct };
}

test("editing qty 15 -> 16 updates amount, discount and final (order CM/2026/111)", () => {
  // Stored line still describes 15 pcs: 15 * 326 = 4890 at 50%.
  const r = pricingV2({
    orderdata_cat_no: "50/7", orderdata_item_quantity: "16", totalPieces: "16",
    orderdata_price: "326", orderdata_totalprice: "4890", listPriceTotal: "4890",
    orderdata_discount: "2445", orderdata_afterDisPrice: "2445",
  });
  assert.equal(r.pieces, 16);
  assert.equal(r.gross, 5216, "16 x 326, not the stale 4890");
  assert.equal(r.pct, 50);
  assert.equal(r.discount, 2608, "50% of the new gross");
  assert.equal(r.final, 2608);
});

test("a consistent line keeps its backend-supplied money untouched", () => {
  const r = pricingV2({
    orderdata_item_quantity: "60", orderdata_price: "634", orderdata_totalprice: "38040",
    orderdata_discount: "7608", orderdata_afterDisPrice: "30432",
  });
  assert.equal(r.gross, 38040);
  assert.equal(r.discount, 7608, "exact backend discount, not a re-derived one");
  assert.equal(r.final, 30432);
});

test("a line with no unit price still shows its stored total", () => {
  const r = pricingV2({ orderdata_item_quantity: "5", orderdata_price: "0", orderdata_totalprice: "900" });
  assert.equal(r.gross, 900);
});
