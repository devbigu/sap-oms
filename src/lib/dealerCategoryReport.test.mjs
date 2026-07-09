import assert from "node:assert/strict";
import test from "node:test";

import dealerCategoryReport from "./dealerCategoryReport.js";
import products from "../../public/data/nested_omsons_products.json" with { type: "json" };

const { aggregateDealerCategorySales } = dealerCategoryReport;

test("Same category aggregation combines totals", () => {
  const { rows, grandTotal } = aggregateDealerCategorySales([
    {
      category: "Burettes",
      quantity: 10,
      totalPieces: 20,
      grossAmount: 1000,
      discountAmount: 100,
      netAmount: 900,
    },
    {
      category: "Burettes",
      quantity: 5,
      totalPieces: 10,
      grossAmount: 500,
      discountAmount: 50,
      netAmount: 450,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    category: "Burettes",
    quantity: 15,
    pieces: 30,
    gross: 1500,
    discount: 150,
    netSales: 1350,
  });
  assert.deepEqual(grandTotal, {
    quantity: 15,
    pieces: 30,
    gross: 1500,
    discount: 150,
    netSales: 1350,
  });
});

test("Different categories remain separate rows", () => {
  const { rows } = aggregateDealerCategorySales([
    {
      category: "Burettes",
      quantity: 2,
      totalPieces: 4,
      grossAmount: 200,
      discountAmount: 20,
      netAmount: 180,
    },
    {
      category: "Flasks",
      quantity: 3,
      totalPieces: 6,
      grossAmount: 300,
      discountAmount: 30,
      netAmount: 270,
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].category, "Burettes");
  assert.equal(rows[1].category, "Flasks");
});

test("Missing category falls back to Uncategorized", () => {
  const { rows } = aggregateDealerCategorySales([
    {
      quantity: 1,
      totalPieces: 2,
      grossAmount: 100,
      discountAmount: 10,
      netAmount: 90,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Uncategorized");
});

test("Catalogue number mapping resolves category from existing products JSON", () => {
  const { rows } = aggregateDealerCategorySales([
    {
      orderdata_cat_no: "1/1",
      quantity: 1,
      totalPieces: 12,
      grossAmount: 1200,
      discountAmount: 100,
      netAmount: 1100,
    },
  ], products);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Burettes");
});

test("Grand Total sums all category rows", () => {
  const { rows, grandTotal } = aggregateDealerCategorySales([
    {
      category: "Burettes",
      quantity: 10,
      totalPieces: 20,
      grossAmount: 1000,
      discountAmount: 100,
      netAmount: 900,
    },
    {
      category: "Burettes",
      quantity: 5,
      totalPieces: 10,
      grossAmount: 500,
      discountAmount: 50,
      netAmount: 450,
    },
    {
      category: "Flasks",
      quantity: 3,
      totalPieces: 6,
      grossAmount: 300,
      discountAmount: 30,
      netAmount: 270,
    },
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(grandTotal, {
    quantity: 18,
    pieces: 36,
    gross: 1800,
    discount: 180,
    netSales: 1620,
  });
});

test("Invalid numeric values never become NaN", () => {
  const { rows, grandTotal } = aggregateDealerCategorySales([
    {
      category: "Burettes",
      quantity: undefined,
      totalPieces: null,
      grossAmount: "bad",
      discountAmount: undefined,
      netAmount: null,
    },
  ]);

  assert.equal(rows.length, 1);
  for (const value of [rows[0].quantity, rows[0].pieces, rows[0].gross, rows[0].discount, rows[0].netSales, grandTotal.quantity, grandTotal.pieces, grandTotal.gross, grandTotal.discount, grandTotal.netSales]) {
    assert.equal(Number.isNaN(value), false);
    assert.equal(value, 0);
  }
});

test("Cancelled and rejected orders are excluded", () => {
  const { rows, grandTotal } = aggregateDealerCategorySales([
    {
      category: "Burettes",
      quantity: 4,
      totalPieces: 8,
      grossAmount: 400,
      discountAmount: 40,
      netAmount: 360,
      order_status: "Cancelled",
    },
    {
      category: "Burettes",
      quantity: 2,
      totalPieces: 4,
      grossAmount: 200,
      discountAmount: 20,
      netAmount: 180,
      del_status: "1",
    },
    {
      category: "Burettes",
      quantity: 1,
      totalPieces: 2,
      grossAmount: 100,
      discountAmount: 10,
      netAmount: 90,
      order_status: "Rejected",
    },
    {
      category: "Burettes",
      quantity: 6,
      totalPieces: 12,
      grossAmount: 600,
      discountAmount: 60,
      netAmount: 540,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    category: "Burettes",
    quantity: 6,
    pieces: 12,
    gross: 600,
    discount: 60,
    netSales: 540,
  });
  assert.deepEqual(grandTotal, {
    quantity: 6,
    pieces: 12,
    gross: 600,
    discount: 60,
    netSales: 540,
  });
});
