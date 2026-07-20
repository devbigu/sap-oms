import assert from "node:assert/strict";
import test from "node:test";

import dashboardSearch from "./dashboardSearch.js";
import { filterOrdersForActor } from "./staffOrderScope.js";
import {
  ORDER_FIXTURES,
  DEALER_A,
  DEALER_B,
  STAFF_1,
} from "./orderVisibilityFixtures.mjs";

const {
  buildDashboardSearchResponse,
  buildOrderDisplayNumber,
  chooseDashboardSearchNavigation,
  resolveDashboardSearchHref,
  searchDashboardProducts,
} = dashboardSearch;

const products = [
  {
    id: "prod-1",
    sku: "50/8",
    name: "Volumetric Flask",
    category: "Flasks",
    categories: ["Laboratory Glassware > Flasks"],
    descriptionHtml: "Class A flask",
    variants: [
      {
        id: "50/8",
        sku: "50/8",
        name: "Volumetric Flask - 100mL",
        specs: { Capacity: "100 mL" },
        specsText: "Capacity: 100 mL",
      },
    ],
  },
  {
    id: "prod-2",
    sku: "HOT-1",
    name: "Magnetic Stirrer",
    category: "Hotplate",
    categories: ["Laboratory Instruments > Hotplate"],
    specsText: "240V heating mantle",
  },
  {
    id: "prod-3",
    sku: "PIPETTE-ROOT",
    name: "Measuring Pipette",
    category: "Pipettes",
    categories: ["Laboratory Glassware > Pipettes"],
    variants: [
      {
        id: "58/8",
        sku: "58/8",
        name: "Measuring Pipette - 10 mL",
        specs: { Capacity: "10 mL" },
        specsText: "Capacity: 10 mL",
      },
    ],
  },
];

const orders = [
  {
    order_id: "3841",
    order_date: "2027-02-14",
    Dealer_Name: "Alpha Labs",
    order_status: "Pending",
    order_amount: "257544",
    order_dealer: "D-1",
  },
  {
    order_id: "5001",
    order_date: "2027-03-01",
    Dealer_Name: "Beta Labs",
    order_status: "Packed",
    order_amount: "1000",
    order_dealer: "D-2",
  },
];

const adminDealers = [
  {
    Dealer_Id: "D-1",
    Dealer_Name: "Alpha Labs",
    Dealer_City: "Delhi",
    Dealer_Dealercode: "ALPHA",
    staffname: "Riya",
  },
];

const adminStaff = [
  {
    staff_id: "S-9",
    staff_name: "Riya Sharma",
    staff_email: "riya@example.com",
    staff_roletype: "1",
  },
];

const itemSummariesByOrderId = {
  "3841": {
    searchText: "50/8 Volumetric Flask",
    matchedByItemText: true,
    matchedLabel: "Volumetric Flask",
  },
};

test("Admin can search all products", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "50/8",
    products,
  });

  assert.equal(response.groups.products[0].title, "Volumetric Flask");
});

test("Admin can search every order", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "3841",
    orders,
  });

  assert.equal(response.groups.orders[0].id, "3841");
});

test("Admin can search dealers", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "ALPHA",
    dealers: adminDealers,
  });

  assert.equal(response.groups.dealers[0].id, "D-1");
});

test("Admin can search staff", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "S-9",
    staff: adminStaff,
  });

  assert.equal(response.groups.staff[0].id, "S-9");
});

test("Staff can search all products", () => {
  const response = buildDashboardSearchResponse({
    role: "staff",
    query: "volumetric",
    products,
  });

  assert.equal(response.groups.products[0].title, "Volumetric Flask");
});

test("Staff can search an assigned dealer order", () => {
  const response = buildDashboardSearchResponse({
    role: "staff",
    query: "3841",
    orders: [orders[0]],
  });

  assert.equal(response.groups.orders[0].id, "3841");
});

test("Staff cannot search an unassigned dealer order", () => {
  const response = buildDashboardSearchResponse({
    role: "staff",
    query: "5001",
    orders: [],
  });

  assert.equal(response.groups.orders.length, 0);
});

test("Exact unassigned order id returns no order result to staff", () => {
  const response = buildDashboardSearchResponse({
    role: "staff",
    query: "OM/2026/5001",
    orders: [],
  });

  assert.equal(response.groups.orders.length, 0);
});

test("Dealer can search all products", () => {
  const response = buildDashboardSearchResponse({
    role: "dealer",
    query: "hotplate",
    products,
  });

  assert.equal(response.groups.products[0].id, "HOT-1");
});

test("Dealer can search their own order", () => {
  const response = buildDashboardSearchResponse({
    role: "dealer",
    query: "3841",
    orders: [orders[0]],
  });

  assert.equal(response.groups.orders[0].id, "3841");
});

test("Dealer cannot search another dealer order", () => {
  const response = buildDashboardSearchResponse({
    role: "dealer",
    query: "5001",
    orders: [],
  });

  assert.equal(response.groups.orders.length, 0);
});

test("Exact foreign order id returns no order result to dealer", () => {
  const response = buildDashboardSearchResponse({
    role: "dealer",
    query: "OM-2027-5001",
    orders: [],
  });

  assert.equal(response.groups.orders.length, 0);
});

test("Staff does not receive general staff results", () => {
  const response = buildDashboardSearchResponse({
    role: "staff",
    query: "riya",
    staff: adminStaff,
  });

  assert.equal(response.groups.staff.length, 0);
});

test("Staff does not receive unrestricted dealer results", () => {
  const response = buildDashboardSearchResponse({
    role: "staff",
    query: "alpha",
    dealers: adminDealers,
  });

  assert.equal(response.groups.dealers.length, 0);
});

test("Dealer does not receive staff results", () => {
  const response = buildDashboardSearchResponse({
    role: "dealer",
    query: "riya",
    staff: adminStaff,
  });

  assert.equal(response.groups.staff.length, 0);
});

test("Dealer does not receive dealer-management results", () => {
  const response = buildDashboardSearchResponse({
    role: "dealer",
    query: "alpha",
    dealers: adminDealers,
  });

  assert.equal(response.groups.dealers.length, 0);
});

test("Exact raw order id matches", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "3841",
    orders,
  });

  assert.equal(response.results[0].id, "3841");
});

test("Formatted OM order number matches", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "OM/2026/3841",
    orders,
  });

  assert.equal(response.groups.orders[0].id, "3841");
});

test("Hyphenated order format matches safely", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "OM-2027-3841",
    orders,
  });

  assert.equal(response.groups.orders[0].id, "3841");
});

test("Exact catalogue number ranks correctly", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "50/8",
    products,
    orders,
  });

  assert.equal(response.results[0].type, "product");
  assert.equal(response.results[0].catalogueNumber, "50/8");
});

test("Dashboard product search links variant catalogue numbers to product detail pages", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "58/8",
    products,
  });

  assert.equal(response.results[0].type, "product");
  assert.equal(response.results[0].catalogueNumber, "58/8");
  assert.equal(response.results[0].href, "/Products/58%2F8");
});

test("Product specification search works", () => {
  const productResults = searchDashboardProducts(products, "100 mL", { role: "admin" });
  assert.equal(productResults[0].catalogueNumber, "50/8");
});

test("Product category search works", () => {
  const productResults = searchDashboardProducts(products, "hotplate", { role: "admin" });
  assert.equal(productResults[0].catalogueNumber, "HOT-1");
});

test("Dealer code search works for admin", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "ALPHA",
    dealers: adminDealers,
  });

  assert.equal(response.groups.dealers[0].matchType, "dealer-code-exact");
});

test("Staff id search works for admin", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "S-9",
    staff: adminStaff,
  });

  assert.equal(response.groups.staff[0].matchType, "staff-id-exact");
});

test("Product-name order-item matching returns permitted orders", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "Volumetric Flask",
    orders,
    itemSummariesByOrderId,
  });

  assert.equal(response.groups.orders[0].id, "3841");
});

test("Duplicate results are removed", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "3841",
    orders: [orders[0], { ...orders[0] }],
  });

  assert.equal(response.groups.orders.length, 1);
});

test("Every result contains a valid href", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "3841",
    products,
    orders,
    dealers: adminDealers,
    staff: adminStaff,
  });

  assert.equal(response.results.every((result) => typeof result.href === "string" && result.href.length > 0), true);
});

test("Route resolution uses actual repository routes", () => {
  assert.equal(resolveDashboardSearchHref({ type: "order", orderId: "3841" }, "admin"), "/orders/3841");
  assert.equal(resolveDashboardSearchHref({ type: "order", orderId: "3841" }, "staff"), "/orders/3841");
  assert.equal(resolveDashboardSearchHref({ type: "order", orderId: "3841" }, "dealer"), "/orders/3841");
  assert.equal(resolveDashboardSearchHref({ type: "product", catalogueNumber: "50/8" }, "dealer"), "/Products/50%2F8");
  assert.equal(resolveDashboardSearchHref({ type: "dealer", dealerId: "D-1" }, "admin"), "/dashboard/admin/dealer/D-1");
  assert.equal(resolveDashboardSearchHref({ type: "staff", staffId: "S-9" }, "admin"), "/dashboard/admin/staff/S-9");
});

test("Enter opens a highlighted suggestion", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "3841",
    orders,
  });

  assert.equal(
    chooseDashboardSearchNavigation({
      query: "3841",
      results: response.results,
      highlightedResult: response.results[0],
    }),
    "/orders/3841",
  );
});

test("Exact permitted order navigation works without highlight", () => {
  const response = buildDashboardSearchResponse({
    role: "admin",
    query: "OM/2026/3841",
    orders,
  });

  assert.equal(
    chooseDashboardSearchNavigation({
      query: "OM/2026/3841",
      results: response.results,
    }),
    "/orders/3841",
  );
});

test("No-highlight fallback navigates to the full product search", () => {
  assert.equal(
    chooseDashboardSearchNavigation({
      query: "volumetric flask",
      results: [],
    }),
    "/search?q=volumetric%20flask",
  );
});

test("Query URL fallback is encoded correctly", () => {
  assert.equal(
    chooseDashboardSearchNavigation({
      query: "50/8",
      results: [],
    }),
    "/search?q=50%2F8",
  );
});

test("Order display formatting keeps repository route shape", () => {
  assert.equal(buildOrderDisplayNumber("3841", "2027-02-14"), "OM/2027/3841");
});

test("dashboard order search applies actor scope across all dates before product-line matching", () => {
  const itemSearch = Object.fromEntries(
    ORDER_FIXTURES.map((order) => [
      String(order.order_id),
      { searchText: "cutoff-fixture-flask", matchedByItemText: true, matchedLabel: "Fixture Flask" },
    ]),
  );
  const buildFor = (role, actorId, assignedDealerIds = []) => {
    const scopedOrders = filterOrdersForActor({
      role,
      actorId,
      assignedDealerIds,
      orders: ORDER_FIXTURES,
    });
    return buildDashboardSearchResponse({
      role,
      query: "cutoff-fixture-flask",
      orders: scopedOrders,
      itemSummariesByOrderId: itemSearch,
    }).groups.orders.map((order) => order.id).sort();
  };

  const adminIds = buildFor("admin", "1");
  const staffIds = buildFor("staff", STAFF_1, [DEALER_A]);
  const dealerAIds = buildFor("dealer", DEALER_A);
  const dealerBIds = buildFor("dealer", DEALER_B);

  assert.equal(adminIds.includes("12001"), true);
  assert.deepEqual(staffIds, ["12001", "13001", "14001", "15001"]);
  assert.deepEqual(dealerAIds, ["12001", "13001", "14001", "15001"]);
  assert.deepEqual(dealerBIds, ["14002", "15002"]);
  assert.equal(staffIds.some((id) => dealerBIds.includes(id)), false);
});

test("role-specific cached search inputs cannot expose a previous actor's orders", () => {
  const cachedInputs = new Map();
  cachedInputs.set("dealer:101", filterOrdersForActor({ role: "dealer", actorId: DEALER_A, orders: ORDER_FIXTURES }));
  cachedInputs.set("dealer:202", filterOrdersForActor({ role: "dealer", actorId: DEALER_B, orders: ORDER_FIXTURES }));

  const idsFor = (key) => buildDashboardSearchResponse({
    role: "dealer",
    query: "15",
    orders: cachedInputs.get(key),
  }).groups.orders.map((order) => order.id);

  assert.deepEqual(idsFor("dealer:101"), ["15001"]);
  assert.deepEqual(idsFor("dealer:202"), ["15002"]);
});
