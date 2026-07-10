import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

async function loadHelperModule() {
  const filePath = path.resolve("src/lib/invoiceRowReconciliation.ts");
  const source = await fs.readFile(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
  return import(dataUrl);
}

const helper = await loadHelperModule();

function buildRow({
  grossAmount,
  stagedDiscountAmount,
  quantity,
  packSize = 1,
  pieces = quantity,
  description = "Item",
  productUnit = "Pcs",
}) {
  return {
    grossAmount,
    stagedDiscountAmount,
    stagedNetAmount: grossAmount - stagedDiscountAmount,
    quantity,
    packSize,
    pieces,
    description,
    productUnit,
  };
}

test("single item reconciles base plus slab to the authoritative total", () => {
  const result = helper.reconcileInvoiceRowAmounts({
    rows: [
      buildRow({
        grossAmount: 525600,
        stagedDiscountAmount: 262800,
        quantity: 1,
      }),
    ],
    amounts: {
      gross: 525600,
      discountAmount: 268056,
      netPayable: 257544,
    },
    discountBreakdown: {
      gross: 525600,
      discountAmount: 268056,
      netPayable: 257544,
      grossAmount: 525600,
      netPayableAmount: 257544,
      baseDiscountAmount: 262800,
      baseDiscountPercent: 50,
      postBaseAmount: 262800,
      additionalDiscountType: "slab",
      slabDiscountPercent: 2,
      slabDiscountAmount: 5256,
      customDiscountAmount: 0,
      additionalDiscountAmount: 5256,
      hasSlabDiscount: true,
      hasCustomDiscount: false,
      hasKnownBaseDiscount: true,
      hasKnownAdditionalDiscount: true,
    },
    useAuthoritativeTotals: true,
  });

  assert.equal(result.rows[0].discountAmount, 268056);
  assert.equal(result.rows[0].netAmount, 257544);
  assert.equal(result.rows[0].discountAdjustmentAmount, 5256);
  assert.equal(result.totals.discountAmount, 268056);
  assert.equal(result.totals.netAmount, 257544);
});

test("multiple rows distribute the additional discount proportionally across post-base amounts", () => {
  const result = helper.reconcileInvoiceRowAmounts({
    rows: [
      buildRow({ grossAmount: 60000, stagedDiscountAmount: 30000, quantity: 1 }),
      buildRow({ grossAmount: 40000, stagedDiscountAmount: 20000, quantity: 1 }),
    ],
    amounts: {
      gross: 100000,
      discountAmount: 55000,
      netPayable: 45000,
    },
    discountBreakdown: {
      gross: 100000,
      discountAmount: 55000,
      netPayable: 45000,
      grossAmount: 100000,
      netPayableAmount: 45000,
      baseDiscountAmount: 50000,
      baseDiscountPercent: 50,
      postBaseAmount: 50000,
      additionalDiscountType: "slab",
      slabDiscountPercent: 10,
      slabDiscountAmount: 5000,
      customDiscountAmount: 0,
      additionalDiscountAmount: 5000,
      hasSlabDiscount: true,
      hasCustomDiscount: false,
      hasKnownBaseDiscount: true,
      hasKnownAdditionalDiscount: true,
    },
    useAuthoritativeTotals: true,
  });

  assert.deepEqual(
    result.rows.map((row) => row.discountAmount),
    [33000, 22000]
  );
  assert.deepEqual(
    result.rows.map((row) => row.netAmount),
    [27000, 18000]
  );
  assert.equal(result.totals.discountAmount, 55000);
  assert.equal(result.totals.netAmount, 45000);
});

test("when staged item discounts already match the authoritative total nothing is added again", () => {
  const result = helper.reconcileInvoiceRowAmounts({
    rows: [
      buildRow({ grossAmount: 60000, stagedDiscountAmount: 33000, quantity: 1 }),
      buildRow({ grossAmount: 40000, stagedDiscountAmount: 22000, quantity: 1 }),
    ],
    amounts: {
      gross: 100000,
      discountAmount: 55000,
      netPayable: 45000,
    },
    discountBreakdown: {
      gross: 100000,
      discountAmount: 55000,
      netPayable: 45000,
      grossAmount: 100000,
      netPayableAmount: 45000,
      baseDiscountAmount: 50000,
      baseDiscountPercent: 50,
      postBaseAmount: 50000,
      additionalDiscountType: "slab",
      slabDiscountPercent: 10,
      slabDiscountAmount: 5000,
      customDiscountAmount: 0,
      additionalDiscountAmount: 5000,
      hasSlabDiscount: true,
      hasCustomDiscount: false,
      hasKnownBaseDiscount: true,
      hasKnownAdditionalDiscount: true,
    },
    useAuthoritativeTotals: true,
  });

  assert.deepEqual(
    result.rows.map((row) => row.discountAdjustmentAmount),
    [0, 0]
  );
  assert.deepEqual(
    result.rows.map((row) => row.discountAmount),
    [33000, 22000]
  );
  assert.equal(result.totals.discountAmount, 55000);
});

test("legacy orders without a summary override keep the staged item calculations", () => {
  const result = helper.reconcileInvoiceRowAmounts({
    rows: [
      buildRow({ grossAmount: 525600, stagedDiscountAmount: 262800, quantity: 1 }),
    ],
    amounts: {
      gross: 525600,
      discountAmount: 268056,
      netPayable: 257544,
    },
    discountBreakdown: {
      gross: 525600,
      discountAmount: 268056,
      netPayable: 257544,
      grossAmount: 525600,
      netPayableAmount: 257544,
      baseDiscountAmount: 262800,
      baseDiscountPercent: 50,
      postBaseAmount: 262800,
      additionalDiscountType: "slab",
      slabDiscountPercent: 2,
      slabDiscountAmount: 5256,
      customDiscountAmount: 0,
      additionalDiscountAmount: 5256,
      hasSlabDiscount: true,
      hasCustomDiscount: false,
      hasKnownBaseDiscount: true,
      hasKnownAdditionalDiscount: true,
    },
    useAuthoritativeTotals: false,
  });

  assert.equal(result.rows[0].discountAmount, 262800);
  assert.equal(result.rows[0].netAmount, 262800);
  assert.equal(result.totals.discountAmount, 262800);
  assert.equal(result.totals.netAmount, 262800);
});

test("the final row absorbs the rounding remainder so row totals match exactly", () => {
  const result = helper.reconcileInvoiceRowAmounts({
    rows: [
      buildRow({ grossAmount: 40, stagedDiscountAmount: 20, quantity: 1 }),
      buildRow({ grossAmount: 30, stagedDiscountAmount: 20, quantity: 1 }),
      buildRow({ grossAmount: 30, stagedDiscountAmount: 20, quantity: 1 }),
    ],
    amounts: {
      gross: 100,
      discountAmount: 60.01,
      netPayable: 39.99,
    },
    discountBreakdown: {
      gross: 100,
      discountAmount: 60.01,
      netPayable: 39.99,
      grossAmount: 100,
      netPayableAmount: 39.99,
      baseDiscountAmount: 60,
      baseDiscountPercent: 60,
      postBaseAmount: 40,
      additionalDiscountType: "slab",
      slabDiscountPercent: 0,
      slabDiscountAmount: 0.01,
      customDiscountAmount: 0,
      additionalDiscountAmount: 0.01,
      hasSlabDiscount: true,
      hasCustomDiscount: false,
      hasKnownBaseDiscount: true,
      hasKnownAdditionalDiscount: true,
    },
    useAuthoritativeTotals: true,
  });

  assert.equal(result.rows[0].discountAmount, 20);
  assert.equal(result.rows[1].discountAmount, 20);
  assert.equal(result.rows[2].discountAmount, 20.01);
  assert.equal(result.rows[2].discountAdjustmentAmount, 0.01);
  assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.discountAmount, 0) * 100) / 100, 60.01);
  assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.netAmount, 0) * 100) / 100, 39.99);
  assert.equal(result.totals.discountAmount, 60.01);
  assert.equal(result.totals.netAmount, 39.99);
});
