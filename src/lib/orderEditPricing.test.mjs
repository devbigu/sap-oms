import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const filePath = path.resolve("src/lib/orderEditPricing.ts");
const source = await fs.readFile(filePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: filePath,
}).outputText;
const pricing = await import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);

// A 10-pack line: 10 packs x 5 per pack = 50 pieces at Rs.100, 20% discount.
const line = {
  orderdata_cat_no: "163/1",
  orderdata_item_quantity: "50",
  totalPieces: "50",
  orderdata_price: "100",
  orderdata_totalprice: "5000",
  listPriceTotal: "5000",
  orderdata_discount: "1000",
  orderdata_afterDisPrice: "4000",
};

test("pack size comes from the catalogue, not the stored line", () => {
  assert.equal(pricing.resolveLinePackSize({ orderdata_cat_no: "163/1", packSize: "1" }, { "163/1": 5 }), 5);
  assert.equal(pricing.resolveLinePackSize({ orderdata_cat_no: "x", packSize: "8" }, {}), 8);
  assert.equal(pricing.resolveLinePackSize({ orderdata_cat_no: "x" }, {}), 1);
});

test("stored pieces are shown as packs in the dialog", () => {
  assert.equal(pricing.resolveLinePacks(line, 5), 10);
  assert.equal(pricing.resolveLinePacks({ orderdata_item_quantity: "7" }, 1), 7);
});

test("the line's discount rate is recovered from the order as placed", () => {
  assert.equal(pricing.resolveLineDiscountPercent(line), 20);
});

test("increasing qty scales pieces, amount, discount and final", () => {
  const money = pricing.computeEditedLine(line, 20, 5); // 10 packs -> 20 packs
  assert.equal(money.pieces, 100, "pieces = packs * pack size");
  assert.equal(money.gross, 10000, "amount = pieces * unit price");
  assert.equal(money.discount, 2000, "discount scales at the same 20%");
  assert.equal(money.final, 8000);
});

test("decreasing qty scales everything back down", () => {
  const money = pricing.computeEditedLine(line, 2, 5);
  assert.deepEqual(
    { pieces: money.pieces, gross: money.gross, discount: money.discount, final: money.final },
    { pieces: 10, gross: 1000, discount: 200, final: 800 }
  );
});

test("pack size is never double counted", () => {
  // Regression: gross was pieces * packSize * unitPrice, inflating 5x here.
  assert.equal(pricing.computeEditedLine(line, 10, 5).gross, 5000);
});

test("saved line carries pieces, not packs, plus fresh money", () => {
  const saved = pricing.applyEditedLine(line, pricing.computeEditedLine(line, 20, 5));
  assert.equal(saved.orderdata_item_quantity, "100", "quantity stays a piece count");
  assert.equal(saved.quantityPacks, "20");
  assert.equal(saved.packSize, "5");
  assert.equal(saved.orderdata_totalprice, "10000");
  assert.equal(saved.listPriceTotal, "10000", "no stale line total left behind");
  assert.equal(saved.orderdata_discount, "2000");
  assert.equal(saved.orderdata_afterDisPrice, "8000");
});

test("a piece count that is not a whole multiple of the pack keeps its quantity", () => {
  const money = pricing.computeLineFromPieces(line, 7, 5);
  assert.equal(money.pieces, 7, "never floors a partial pack away to zero");
  assert.equal(money.gross, 700);
});

test("order totals sum the recomputed lines", () => {
  const totals = pricing.sumEditedTotals([
    pricing.computeEditedLine(line, 20, 5),
    pricing.computeEditedLine(line, 2, 5),
  ]);
  assert.deepEqual(totals, { grossAmount: 11000, discountAmount: 2200, netPayableAmount: 8800 });
});

test("a zero-discount line stays at zero when quantity changes", () => {
  const plain = { orderdata_item_quantity: "10", orderdata_price: "50", totalPieces: "10" };
  const money = pricing.computeEditedLine(plain, 4, 5);
  assert.equal(money.gross, 1000);
  assert.equal(money.discount, 0);
  assert.equal(money.final, 1000);
});
