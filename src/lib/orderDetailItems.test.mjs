import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const filePath = path.resolve("src/lib/orderDetailItems.ts");
const source = await fs.readFile(filePath, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: filePath,
}).outputText;
const details = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

const legacyRow = (id, sku) => ({
  orderdata_id: id,
  orderdata_orderid: "7001",
  orderdata_cat_no: sku,
  orderdata_item_quantity: "1",
  product_name: `Product ${sku}`,
});

test("legacy PHP arrays preserve every product row", () => {
  const rows = [legacyRow("1", "A"), legacyRow("2", "B"), legacyRow("3", "C")];
  assert.deepEqual(details.normalizeOrderDetailResponse({ data: rows }, "7001").items.map((row) => row.orderdata_id), ["1", "2", "3"]);
});

test("modern object responses preserve every nested item", () => {
  const result = details.normalizeOrderDetailResponse({
    data: { order_id: "7001", items: Array.from({ length: 10 }, (_, index) => ({ productId: "DUP", productName: `Line ${index}` })) },
  }, "7001");
  assert.equal(result.items.length, 10);
  assert.equal(new Set(result.items.map((row) => row.orderdata_id)).size, 10);
  assert.equal(result.items[0].orderdata_id, "php:7001:dup:1");
  assert.equal(result.items[9].orderdata_id, "php:7001:dup:10");
});

test("array-wrapped modern responses flatten all item groups, not only raw[0]", () => {
  const result = details.normalizeOrderDetailResponse({
    data: [{ items: [{ productId: "A" }] }, { items: [{ productId: "B" }] }],
  }, "7001");
  assert.deepEqual(result.items.map((row) => row.orderdata_cat_no), ["A", "B"]);
});

test("no overlay preserves the complete PHP list", () => {
  const php = [legacyRow("1", "A"), legacyRow("2", "B")];
  assert.strictEqual(details.resolveEffectiveOrderDetailItems(php, null), php);
});

test("complete effective snapshot uses every overlay line", () => {
  const php = [legacyRow("1", "A"), legacyRow("2", "B")];
  const effective = [legacyRow("1", "A"), legacyRow("3", "C"), legacyRow("4", "D")];
  assert.deepEqual(details.resolveEffectiveOrderDetailItems(php, { itemContract: "complete", effectiveItems: effective }), effective);
});

test("partial overlay preserves unaffected lines and removes or replaces only its target", () => {
  const php = [legacyRow("1", "A"), legacyRow("2", "B"), legacyRow("3", "C")];
  const replacement = { ...legacyRow("overlay:4", "D"), originalLineId: "2" };
  const effective = details.resolveEffectiveOrderDetailItems(php, {
    itemContract: "partial",
    effectiveItems: [replacement],
    changeHistory: [
      { type: "replaced", originalLineId: "2" },
      { type: "removed", originalLineId: "3" },
    ],
  });
  assert.deepEqual(effective.map((row) => row.orderdata_id), ["1", "overlay:4"]);
});

test("overlay totals cannot erase rich slab or custom metadata in either load order", () => {
  const summary = {
    baseDiscountAmount: 500,
    additionalDiscountType: "slab",
    slabDiscountPercent: 2,
    slabDiscountAmount: 10,
    grossAmount: 1000,
  };
  const totals = { grossAmount: 900, discountAmount: 460, netPayableAmount: 440 };
  const first = details.mergeOrderSummarySources(summary, totals);
  const second = details.mergeOrderSummarySources({ ...summary }, { ...totals });
  assert.deepEqual(first, second);
  assert.equal(first.additionalDiscountType, "slab");
  assert.equal(first.slabDiscountAmount, 10);
  assert.equal(first.grossAmount, 900);
  assert.equal(first.discountAmount, 460);
  assert.equal(first.netPayableAmount, 440);
});

test("overlay totals ignore unrelated fields", () => {
  const merged = details.mergeOrderSummarySources(
    { additionalDiscountType: "custom", customDiscountAmount: 25 },
    { additionalDiscountType: "slab", slabDiscountAmount: 99, netPayableAmount: 475 }
  );
  assert.equal(merged.additionalDiscountType, "custom");
  assert.equal(merged.customDiscountAmount, 25);
  assert.equal(merged.slabDiscountAmount, undefined);
  assert.equal(merged.netPayableAmount, 475);
});
