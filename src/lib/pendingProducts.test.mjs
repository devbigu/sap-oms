import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function transpileTypeScriptModule(filePath, replacements = []) {
  const source = await fs.readFile(filePath, "utf8");
  const rewrittenSource = replacements.reduce(
    (current, [pattern, nextValue]) => current.replace(pattern, nextValue),
    source
  );

  const transpiled = ts.transpileModule(rewrittenSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  return `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
}

async function loadPendingProductsModule() {
  const orderProductNotesUrl = pathToFileURL(path.resolve("src/lib/orderProductNotes.mjs")).href;
  const productSearchUrl = pathToFileURL(path.resolve("src/lib/productSearch.js")).href;

  const orderDispatchPath = path.resolve("src/lib/orderDispatch.ts");
  const orderDispatchUrl = await transpileTypeScriptModule(orderDispatchPath, [
    [/from\s+["']@\/lib\/orderProductNotes\.mjs["']/g, `from "${orderProductNotesUrl}"`],
  ]);

  const pendingProductsPath = path.resolve("src/lib/pendingProducts.ts");
  const pendingProductsUrl = await transpileTypeScriptModule(pendingProductsPath, [
    [/from\s+["']\.\/orderDispatch["']/g, `from "${orderDispatchUrl}"`],
    [/from\s+["']\.\/productSearch\.js["']/g, `from "${productSearchUrl}"`],
  ]);

  return import(pendingProductsUrl);
}

const pendingProducts = await loadPendingProductsModule();

function buildFixtureLines() {
  const orders = [
    {
      order_id: "1001",
      order_date: "2026-07-01T00:00:00.000Z",
      order_dealer: "D-1",
      Dealer_Name: "Dealer A",
      accept_order: "1",
      del_status: "0",
      assignedstaff: "77",
      staffname: "Alice",
    },
    {
      order_id: "1002",
      order_date: "2026-07-04T00:00:00.000Z",
      order_dealer: "D-2",
      Dealer_Name: "Dealer B",
      accept_order: "1",
      del_status: "0",
      assignedstaff: "88",
      staffname: "Bob",
    },
    {
      order_id: "1003",
      order_date: "2026-07-02T00:00:00.000Z",
      order_dealer: "D-1",
      Dealer_Name: "Dealer A",
      accept_order: "1",
      del_status: "0",
      assignedstaff: "77",
      staffname: "Alice",
    },
    {
      order_id: "1004",
      order_date: "2026-07-03T00:00:00.000Z",
      order_dealer: "D-3",
      Dealer_Name: "Dealer C",
      accept_order: "0",
      del_status: "0",
      assignedstaff: "99",
      staffname: "Chris",
    },
    {
      order_id: "1005",
      order_date: "2026-07-05T00:00:00.000Z",
      order_dealer: "D-4",
      Dealer_Name: "Dealer D",
      accept_order: "1",
      del_status: "1",
      assignedstaff: "55",
      staffname: "Dana",
    },
    {
      order_id: "1006",
      order_date: "2026-07-06T00:00:00.000Z",
      order_dealer: "D-1",
      Dealer_Name: "Dealer A",
      accept_order: "1",
      del_status: "0",
      assignedstaff: "77",
      staffname: "Alice",
    },
  ];

  const orderItemsByOrderId = {
    "1001": [
      {
        orderdata_id: "501",
        orderdata_orderid: "1001",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "10",
        readyquantity: "0",
        packSize: "12",
      },
      {
        orderdata_id: "502",
        orderdata_orderid: "1001",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "5",
        readyquantity: "4",
        packSize: "12",
      },
    ],
    "1002": [
      {
        orderdata_id: "601",
        orderdata_orderid: "1002",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "8",
        readyquantity: "0",
        packSize: "12",
      },
    ],
    "1003": [
      {
        orderdata_id: "701",
        orderdata_orderid: "1003",
        orderdata_cat_no: "50/9",
        product_name: "Volumetric Flask",
        product_discription: "250 ml",
        orderdata_item_quantity: "6",
        readyquantity: "0",
        packSize: "6",
      },
    ],
    "1004": [
      {
        orderdata_id: "801",
        orderdata_orderid: "1004",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "20",
        readyquantity: "0",
      },
    ],
    "1005": [
      {
        orderdata_id: "901",
        orderdata_orderid: "1005",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "10",
        readyquantity: "0",
      },
    ],
    "1006": [
      {
        orderdata_id: "902",
        orderdata_orderid: "1006",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "3",
        readyquantity: "9",
      },
    ],
  };

  const dispatchRecordsByOrderId = {
    "1001": [
      {
        orderId: "1001",
        orderItemId: "501",
        sku: "50/8",
        normalizedSku: "50/8",
        occurrence: 1,
        orderedQuantity: 10,
        dispatchedQuantity: 4,
        currentStatus: "packing",
        updates: [{ id: "u1", quantity: 4, remark: "Packed", status: "packing", actorId: "77", actorRole: "staff", createdAt: "2026-07-02T12:00:00.000Z" }],
      },
      {
        orderId: "1001",
        orderItemId: "502",
        sku: "50/8",
        normalizedSku: "50/8",
        occurrence: 2,
        orderedQuantity: 5,
        dispatchedQuantity: 2,
        currentStatus: "dispatched",
        updates: [{ id: "u2", quantity: 2, remark: "Loaded", status: "dispatched", actorId: "1", actorRole: "admin", createdAt: "2026-07-03T12:00:00.000Z" }],
      },
    ],
  };

  const dealerDirectoryById = {
    "D-1": { Dealer_Id: "D-1", Dealer_Name: "Dealer A", assignedstaff: "77", staffname: "Alice" },
    "D-2": { Dealer_Id: "D-2", Dealer_Name: "Dealer B", assignedstaff: "88", staffname: "Bob" },
  };

  const catalogueProducts = [
    {
      sku: "flask",
      productName: "Volumetric Flask",
      category: "Glassware",
      variants: [
        { sku: "50/8", name: "Volumetric Flask 100 ml", specification: "100 ml", image: "flask-100.png" },
        { sku: "50/9", name: "Volumetric Flask 250 ml", specification: "250 ml", image: "flask-250.png" },
      ],
    },
  ];

  return pendingProducts.buildPendingProductLines({
    orders,
    orderItemsByOrderId,
    dispatchRecordsByOrderId,
    dealerDirectoryById,
    catalogueProducts,
  });
}

test("accepted non-deleted orders build pending product lines", () => {
  const lines = buildFixtureLines();
  assert.equal(lines.length, 4);
  assert.deepEqual(
    Array.from(new Set(lines.map((line) => line.orderId))).sort(),
    ["1001", "1002", "1003"]
  );
});

test("pending aggregation combines the exact same SKU across orders without double-counting Mongo and legacy dispatch", () => {
  const aggregates = pendingProducts.aggregatePendingProducts(buildFixtureLines());
  const flask100 = aggregates.find((entry) => entry.catalogueNumber === "50/8");

  assert.ok(flask100);
  assert.equal(flask100.orderedQuantity, 23);
  assert.equal(flask100.dispatchedQuantity, 6);
  assert.equal(flask100.pendingQuantity, 17);
  assert.equal(flask100.pendingOrders, 2);
  assert.equal(flask100.dealersAffected, 2);
});

test("different catalogue variants remain separate product groups", () => {
  const aggregates = pendingProducts.aggregatePendingProducts(buildFixtureLines());
  assert.equal(aggregates.length, 2);

  const catalogueNumbers = aggregates.map((entry) => entry.catalogueNumber).sort();
  assert.deepEqual(catalogueNumbers, ["50/8", "50/9"]);
});

test("ordered quantity uses the same dispatch unit as orderdata_item_quantity rather than pieces", () => {
  const aggregates = pendingProducts.aggregatePendingProducts(buildFixtureLines());
  const flask100 = aggregates.find((entry) => entry.catalogueNumber === "50/8");

  assert.ok(flask100);
  assert.equal(flask100.orderedQuantity, 23);
  assert.notEqual(flask100.orderedQuantity, 23 * 12);
});

test("fully dispatched or over-dispatched lines are clamped out of the pending view", () => {
  const lines = buildFixtureLines();
  assert.equal(lines.some((line) => line.orderId === "1006"), false);
});

test("staff and dealer scope filters only keep permitted line contributions", () => {
  const lines = buildFixtureLines();
  const staffLines = pendingProducts.filterPendingProductLines(lines, { assignedStaffId: "77" });
  const dealerLines = pendingProducts.filterPendingProductLines(lines, { dealerId: "D-2" });

  assert.deepEqual(
    Array.from(new Set(staffLines.map((line) => line.orderId))).sort(),
    ["1001", "1003"]
  );
  assert.deepEqual(
    Array.from(new Set(dealerLines.map((line) => line.orderId))).sort(),
    ["1002"]
  );
});

test("summary metrics are computed from the full role-scoped line set, not a page slice", () => {
  const summary = pendingProducts.buildPendingProductsSummaryFromLines(buildFixtureLines());

  assert.deepEqual(summary, {
    productsPending: 2,
    totalPendingUnits: 23,
    ordersWithPendingItems: 3,
    dealersAffected: 2,
  });
});

test("product drill-down totals match the main aggregate and keep unique orders intact", () => {
  const lines = buildFixtureLines();
  const aggregates = pendingProducts.aggregatePendingProducts(lines);
  const flask100 = aggregates.find((entry) => entry.catalogueNumber === "50/8");

  assert.ok(flask100);

  const detail = pendingProducts.buildPendingProductDrilldown(lines, flask100.productKey);
  assert.ok(detail.aggregate);
  assert.equal(detail.aggregate.pendingQuantity, flask100.pendingQuantity);
  assert.equal(detail.orders.length, 2);

  const order1001 = detail.orders.find((entry) => entry.orderId === "1001");
  assert.ok(order1001);
  assert.equal(order1001.orderedQuantity, 15);
  assert.equal(order1001.dispatchedQuantity, 6);
  assert.equal(order1001.pendingQuantity, 9);
  assert.equal(order1001.lineCount, 2);
});

test("search can match product names and catalogue numbers", () => {
  const aggregates = pendingProducts.aggregatePendingProducts(buildFixtureLines());
  const byName = pendingProducts.filterPendingProducts(aggregates, { search: "flask" });
  const byCatalogue = pendingProducts.filterPendingProducts(aggregates, { search: "50/9" });

  assert.equal(byName.length, 2);
  assert.deepEqual(byCatalogue.map((entry) => entry.catalogueNumber), ["50/9"]);
});

test("default sort places the highest pending quantity first", () => {
  const sorted = pendingProducts.sortPendingProducts(
    pendingProducts.aggregatePendingProducts(buildFixtureLines()),
    "pending_desc"
  );

  assert.deepEqual(sorted.map((entry) => entry.catalogueNumber), ["50/8", "50/9"]);
});
