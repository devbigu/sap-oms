import assert from "node:assert/strict";
import test from "node:test";

import dealerCategoryReport from "./dealerCategoryReport.js";
import products from "../../public/data/nested_omsons_products.json" with { type: "json" };

const {
  aggregateDealerCategorySales,
  buildDealerPurchaseLines,
  buildDealerCategoryReport,
  classifyOrder,
  matchesStatusFilter,
} = dealerCategoryReport;

const reportCatalogue = [
  {
    sku: "1/1",
    category: "Burettes",
    name: "Glass Burette",
    variants: [
      { sku: "1/2", pack: 5, name: "Glass Burette Variant" },
    ],
  },
  {
    sku: "2/1",
    category: "Flasks",
    name: "Volumetric Flask",
    packSize: 10,
  },
  {
    sku: "3/1",
    categories: ["Laboratory > Test Tubes"],
    name: "Test Tube",
    packSize: 2,
  },
];

function buildReportFixture() {
  const orders = [
    {
      order_id: "O-100",
      order_date: "2027-01-10",
      order_dealer: "D-1",
      Dealer_Name: "Desk Scientific",
      accept_order: "1",
      del_status: "0",
      order_status: "Pending",
      mtstatus: "1",
    },
    {
      order_id: "O-101",
      order_date: "2027-03-05",
      order_dealer: "D-1",
      Dealer_Name: "Desk Scientific",
      accept_order: "1",
      del_status: "0",
      order_status: "Successful",
      mtstatus: "4",
    },
    {
      order_id: "O-102",
      order_date: "2027-04-12",
      order_dealer: "D-1",
      Dealer_Name: "Desk Scientific",
      accept_order: "0",
      del_status: "0",
      order_status: "Pending",
      mtstatus: "0",
    },
    {
      order_id: "O-103",
      order_date: "2027-05-20",
      order_dealer: "D-1",
      Dealer_Name: "Desk Scientific",
      accept_order: "1",
      del_status: "1",
      order_status: "Cancelled",
      mtstatus: "0",
    },
  ];

  const orderItemsByOrderId = {
    "O-100": [
      {
        orderdata_id: "L-1",
        orderdata_cat_no: "1/1",
        orderdata_item_quantity: 3,
        packSize: 10,
        finalPrice: 900,
      },
      {
        orderdata_id: "L-1",
        orderdata_cat_no: "1/1",
        orderdata_item_quantity: 3,
        packSize: 10,
        finalPrice: 900,
      },
      {
        orderdata_id: "L-2",
        orderdata_cat_no: "2/1",
        orderdata_item_quantity: 2,
        totalPieces: 20,
        finalPrice: 500,
      },
    ],
    "O-101": [
      {
        orderdata_id: "L-3",
        orderdata_cat_no: "1/2",
        orderdata_item_quantity: 4,
        packSize: 5,
        totalPieces: 20,
        finalPrice: 1200,
      },
      {
        orderdata_id: "L-4",
        orderdata_cat_no: "3/1",
        orderdata_item_quantity: 5,
        pack_size: 2,
        finalPrice: 250,
      },
      {
        orderdata_id: "L-5",
        product_name: "Unknown Glassware",
        orderdata_item_quantity: 1,
        packSize: 4,
        finalPrice: 75,
      },
    ],
    "O-102": [
      {
        orderdata_id: "L-6",
        orderdata_cat_no: "1/1",
        orderdata_item_quantity: 1,
        packSize: 10,
        finalPrice: 300,
      },
    ],
    "O-103": [
      {
        orderdata_id: "L-7",
        orderdata_cat_no: "2/1",
        orderdata_item_quantity: 9,
        packSize: 10,
        finalPrice: 999,
      },
    ],
  };

  return {
    dealer: {
      Dealer_Id: "D-1",
      Dealer_Name: "Desk Scientific",
      Dealer_City: "Mumbai",
      Dealer_Dealercode: "DS-01",
      staffname: "Aman",
    },
    orders,
    orderItemsByOrderId,
  };
}

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

test("Order classification preserves awaiting and completed meanings", () => {
  assert.equal(classifyOrder({ accept_order: "0", del_status: "0" }), "Awaiting");
  assert.equal(classifyOrder({ accept_order: "1", del_status: "0", mtstatus: "1" }), "SupposedToGo");
  assert.equal(classifyOrder({ accept_order: "1", del_status: "0", mtstatus: "4" }), "SentAndSettled");
  assert.equal(classifyOrder({ accept_order: "1", del_status: "1" }), "Cancelled");
});

test("Status filters include eligible, accepted, and completed orders correctly", () => {
  assert.equal(matchesStatusFilter({ accept_order: "1", del_status: "0", mtstatus: "1" }, "all"), true);
  assert.equal(matchesStatusFilter({ accept_order: "0", del_status: "0", mtstatus: "0" }, "all"), true);
  assert.equal(matchesStatusFilter({ accept_order: "0", del_status: "0", mtstatus: "0" }, "accepted"), false);
  assert.equal(matchesStatusFilter({ accept_order: "1", del_status: "0", mtstatus: "4" }, "completed"), true);
});

test("Duplicate order items are extracted once", () => {
  const fixture = buildReportFixture();
  const { lines } = buildDealerPurchaseLines({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  assert.equal(lines.filter((line) => line.lineKey === "O-100::item:L-1").length, 1);
});

test("All eligible orders contribute to the all-status report", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  assert.equal(report.summary.totalOrders, 3);
  assert.equal(report.summary.totalCategories, 4);
  assert.equal(report.summary.totalVariants, 5);
  assert.equal(report.summary.totalPurchasedQuantity, 94);
  assert.equal(report.summary.totalSalesValue, 3225);
});

test("Report exposes product-wise totals as the primary rows", () => {
  const report = buildDealerCategoryReport({
    dealer: { Dealer_Id: "D-1", Dealer_Name: "Desk Scientific" },
    orders: [
      { order_id: "O-1", order_dealer: "D-1", order_date: "2027-01-01", accept_order: "1", del_status: "0" },
      { order_id: "O-2", order_dealer: "D-1", order_date: "2027-01-02", accept_order: "1", del_status: "0" },
    ],
    orderItemsByOrderId: {
      "O-1": [
        { orderdata_id: "L-1", orderdata_cat_no: "2/1", product_name: "Flask", orderdata_item_quantity: 10, packSize: 1 },
        { orderdata_id: "L-2", orderdata_cat_no: "1/1", product_name: "Burette", orderdata_item_quantity: 20, packSize: 1 },
      ],
      "O-2": [
        { orderdata_id: "L-3", orderdata_cat_no: "2 / 1", product_name: "Flask variant spelling", orderdata_item_quantity: 2, packSize: 1 },
        { orderdata_id: "L-4", orderdata_cat_no: "3/1", product_name: "Test Tube", orderdata_item_quantity: 30, packSize: 1 },
      ],
    },
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  const flask = report.products.find((product) => product.normalizedCatalogueNumber === "21");
  const burette = report.products.find((product) => product.normalizedCatalogueNumber === "11");
  const testTube = report.products.find((product) => product.normalizedCatalogueNumber === "31");

  assert.equal(report.products.length, 3);
  assert.equal(flask?.purchasedQuantity, 12);
  assert.equal(flask?.orderCount, 2);
  assert.equal(burette?.purchasedQuantity, 20);
  assert.equal(testTube?.purchasedQuantity, 30);
});

test("Different catalogue numbers remain separate even when names match", () => {
  const report = buildDealerCategoryReport({
    dealer: { Dealer_Id: "D-1", Dealer_Name: "Desk Scientific" },
    orders: [
      { order_id: "O-1", order_dealer: "D-1", order_date: "2027-01-01", accept_order: "1", del_status: "0" },
    ],
    orderItemsByOrderId: {
      "O-1": [
        { orderdata_id: "L-1", orderdata_cat_no: "A100", product_name: "Volumetric Flask", orderdata_item_quantity: 1, packSize: 1 },
        { orderdata_id: "L-2", orderdata_cat_no: "A200", product_name: "Volumetric Flask", orderdata_item_quantity: 1, packSize: 1 },
      ],
    },
    catalogueProducts: [],
    statusFilter: "all",
  });

  assert.equal(report.products.length, 2);
  assert.deepEqual(report.products.map((product) => product.catalogueNumber).sort(), ["A100", "A200"]);
});

test("Selected dealer filtering excludes orders returned for another dealer", () => {
  const report = buildDealerCategoryReport({
    dealer: { Dealer_Id: "D-1", Dealer_Name: "Desk Scientific" },
    orders: [
      { order_id: "O-1", order_dealer: "D-1", order_date: "2027-01-01", accept_order: "1", del_status: "0" },
      { order_id: "O-2", order_dealer: "D-2", order_date: "2027-01-02", accept_order: "1", del_status: "0" },
    ],
    orderItemsByOrderId: {
      "O-1": [{ orderdata_id: "L-1", orderdata_cat_no: "2/1", orderdata_item_quantity: 2, packSize: 1 }],
      "O-2": [{ orderdata_id: "L-2", orderdata_cat_no: "2/1", orderdata_item_quantity: 99, packSize: 1 }],
    },
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  assert.equal(report.summary.totalOrders, 1);
  assert.equal(report.summary.totalPurchasedQuantity, 2);
});

test("All-time reports include orders with missing dates", () => {
  const report = buildDealerCategoryReport({
    dealer: { Dealer_Id: "D-1", Dealer_Name: "Desk Scientific" },
    orders: [
      { order_id: "O-1", order_dealer: "D-1", accept_order: "1", del_status: "0" },
    ],
    orderItemsByOrderId: {
      "O-1": [{ orderdata_id: "L-1", orderdata_cat_no: "2/1", orderdata_item_quantity: 2, packSize: 1 }],
    },
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  assert.equal(report.summary.totalOrders, 1);
  assert.equal(report.products.length, 1);
});

test("Accepted filter excludes awaiting orders", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "accepted",
  });

  assert.equal(report.summary.totalOrders, 2);
  assert.equal(report.summary.totalPurchasedQuantity, 84);
});

test("Completed filter keeps only completed or successful orders", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "completed",
  });

  assert.equal(report.summary.totalOrders, 1);
  assert.equal(report.summary.totalPurchasedQuantity, 34);
  assert.equal(report.categories[0].category, "Burettes");
});

test("Date filtering recalculates totals from the matching orders only", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    fromDate: "2027-03-01",
    toDate: "2027-03-31",
    statusFilter: "all",
  });

  assert.equal(report.summary.totalOrders, 1);
  assert.equal(report.summary.totalPurchasedQuantity, 34);
  assert.equal(report.categories.length, 3);
});

test("Pack quantity times pack size produces total pieces when explicit pieces are missing", () => {
  const fixture = buildReportFixture();
  const { lines } = buildDealerPurchaseLines({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  const buretteLine = lines.find((line) => line.lineKey === "O-100::item:L-1");
  assert.equal(buretteLine?.purchasedQuantity, 30);
});

test("Explicit total pieces are not multiplied by pack size twice", () => {
  const fixture = buildReportFixture();
  const { lines } = buildDealerPurchaseLines({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  const variantLine = lines.find((line) => line.lineKey === "O-101::item:L-3");
  assert.equal(variantLine?.purchasedQuantity, 20);
});

test("Category grouping keeps related variants together and separate categories apart", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  const burettes = report.categories.find((row) => row.category === "Burettes");
  const flasks = report.categories.find((row) => row.category === "Flasks");
  assert.ok(burettes);
  assert.ok(flasks);
  assert.equal(burettes.variantCount, 2);
  assert.equal(flasks.variantCount, 1);
  assert.notEqual(burettes.category, flasks.category);
});

test("Missing categories fall back safely without dropping quantity", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  const uncategorized = report.categories.find((row) => row.category === "Uncategorized");
  assert.ok(uncategorized);
  assert.equal(uncategorized.purchasedQuantity, 4);
});

test("Distinct order count is correct for category totals", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  const burettes = report.categories.find((row) => row.category === "Burettes");
  assert.equal(burettes?.orderCount, 3);
});

test("Category percentages use the complete filtered dealer total", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  const burettes = report.categories.find((row) => row.category === "Burettes");
  assert.equal(burettes?.shareOfPurchases, 63.83);
});

test("Product drill-down totals add back up to the category total", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  const burettes = report.categories.find((row) => row.category === "Burettes");
  assert.ok(burettes);
  const productTotal = burettes.products.reduce((sum, product) => sum + product.purchasedQuantity, 0);
  assert.equal(productTotal, burettes.purchasedQuantity);
});

test("Contributing orders remain grouped under each product once", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  const burettes = report.categories.find((row) => row.category === "Burettes");
  const buretteProduct = burettes?.products.find((product) => product.catalogueNumber === "1/1");
  assert.equal(buretteProduct?.orders.length, 2);
});

test("Latest purchase date is tracked from the newest contributing order", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  const testTubes = report.categories.find((row) => row.category === "Test Tubes");
  assert.match(testTubes?.latestPurchaseDate || "", /^2027-03-05/);
});

test("Partial upstream failures surface a warning instead of fake zero totals", () => {
  const fixture = buildReportFixture();
  const report = buildDealerCategoryReport({
    ...fixture,
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
    failedOrderIds: ["O-101"],
  });

  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0].message, /Totals may be incomplete/);
  assert.deepEqual(report.meta.failedOrderIds, ["O-101"]);
});

test("Empty dealer history returns zero categories and zero totals", () => {
  const report = buildDealerCategoryReport({
    dealer: { Dealer_Id: "D-9", Dealer_Name: "No Orders Dealer" },
    orders: [],
    orderItemsByOrderId: {},
    catalogueProducts: reportCatalogue,
    statusFilter: "all",
  });

  assert.equal(report.summary.totalOrders, 0);
  assert.equal(report.summary.totalCategories, 0);
  assert.equal(report.categories.length, 0);
});
