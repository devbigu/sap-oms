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
