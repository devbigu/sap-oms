import assert from "node:assert/strict";
import test from "node:test";

import productSearch from "./productSearch.js";

const {
  buildSearchUrl,
  flattenSpecificationValue,
  getProductSuggestions,
  getSearchQueryInfo,
  normalizeCatalogueNumber,
  normalizeProductForSearch,
  normalizeSearchQuery,
  searchProducts,
} = productSearch;

const catalogue = [
  {
    id: "flask-1",
    sku: "FLASK-ROOT",
    name: "Volumetric Flask",
    category: "Flasks",
    categories: ["Laboratory Glassware > Flasks", "Laboratory Glassware"],
    descriptionHtml: "<strong>Class A borosilicate flask</strong>",
    features: ["Calibrated for laboratory use"],
    images: ["/images/flask.jpg"],
    variants: [
      {
        id: "50/8",
        sku: "50/8",
        name: "Volumetric Flask - 100mL",
        specs: {
          "Capacity (mL)": "100",
          Material: "Borosilicate",
          "Neck Size": "14/23",
        },
        specsText: "Capacity (mL): 100; Material: Borosilicate; Neck Size: 14/23",
        images: ["/images/flask-variant.jpg"],
      },
    ],
  },
  {
    id: "desc-1",
    sku: "DESC-1",
    name: "Accessory Cleaning Kit",
    category: "Maintenance",
    categories: ["Maintenance"],
    descriptionHtml: "Compatible with 50/8 flasks and glassware accessories",
  },
  {
    id: "prefix-1",
    sku: "50A",
    name: "Starter Cylinder",
    category: "Cylinders",
    categories: ["Laboratory Glassware > Cylinders"],
    descriptionHtml: "General purpose starter cylinder",
  },
  {
    id: "string-spec-1",
    sku: "STRING-1",
    name: "Heating Mantle",
    category: "Heating",
    categories: ["Laboratory Instruments > Heating"],
    specsText: "240V mantle for 500 mL flasks",
  },
  {
    id: "array-spec-1",
    sku: "ARRAY-1",
    name: "Filter Disc",
    category: "Filters",
    categories: ["Membrane Filters"],
    variants: [
      {
        id: "ARRAY-1-A",
        sku: "ARRAY-1-A",
        name: "Filter Disc Variant",
        specs: ["PTFE membrane", "Hydrophobic surface"],
      },
    ],
  },
  {
    id: "hotplate-1",
    sku: "HOT-1",
    name: "Magnetic Stirrer Classic",
    category: "Hotplate",
    categories: ["Laboratory Instruments > Hotplate"],
  },
  {
    id: "minimal-1",
    sku: "MIN-1",
    name: "Minimal Pipette",
    variants: [
      {
        id: "58/8",
        sku: "58/8",
        name: "Minimal Pipette - 10 mL",
        specs: { Capacity: "10 mL" },
      },
    ],
  },
  {
    id: "alpha-1",
    sku: "AA-2",
    name: "Alpha Rack",
    category: "Storage",
    categories: ["Storage"],
    descriptionHtml: "Rack for sorting samples",
  },
  {
    id: "alpha-2",
    sku: "AA-1",
    name: "Beta Rack",
    category: "Storage",
    categories: ["Storage"],
    descriptionHtml: "Rack for sorting samples",
  },
];

const manyProducts = Array.from({ length: 10 }, (_, index) => ({
  id: `many-${index + 1}`,
  sku: `LAB-${index + 1}`,
  name: `Lab Product ${index + 1}`,
  category: "Lab Tools",
  categories: ["Lab Tools"],
}));

test("Empty query returns no full search results", () => {
  assert.deepEqual(searchProducts(catalogue, ""), []);
});

test("Empty query returns no suggestions", () => {
  assert.deepEqual(getProductSuggestions(catalogue, ""), []);
});

test("Query is limited to 3 keywords", () => {
  assert.equal(normalizeSearchQuery("one two three four five"), "one two three");
});

test("Repeated spaces are normalized", () => {
  assert.equal(normalizeSearchQuery("volumetric   flask"), "volumetric flask");
});

test("Leading and trailing spaces are removed", () => {
  assert.equal(normalizeSearchQuery("   flask   "), "flask");
});

test("Matching is case-insensitive", () => {
  const [firstResult] = searchProducts(catalogue, "VOLUMETRIC");
  assert.equal(firstResult.productName, "Volumetric Flask");
});

test("Exact catalogue-number match ranks first", () => {
  const [firstResult] = searchProducts(catalogue, "50/8");
  assert.equal(firstResult.catalogueNumber, "50/8");
});

test("Variant-only catalogue-number match routes to the variant product detail", () => {
  const [firstResult] = searchProducts(catalogue, "58/8");
  assert.equal(firstResult.productName, "Minimal Pipette");
  assert.equal(firstResult.catalogueNumber, "58/8");
  assert.equal(firstResult.route, "/Products/58%2F8");
});

test("Catalogue prefix ranks above description-only match", () => {
  const results = getProductSuggestions(catalogue, "50");
  assert.equal(results[0].catalogueNumber, "50A");
  assert.equal(results[1].catalogueNumber, "50/8");
});

test("Product-name matching works", () => {
  const [firstResult] = searchProducts(catalogue, "volumetric flask");
  assert.equal(firstResult.productName, "Volumetric Flask");
});

test("Description matching works", () => {
  const [firstResult] = searchProducts(catalogue, "compatible accessories");
  assert.equal(firstResult.catalogueNumber, "DESC-1");
});

test("String specifications are searchable", () => {
  const [firstResult] = searchProducts(catalogue, "240v mantle");
  assert.equal(firstResult.catalogueNumber, "STRING-1");
});

test("Object-based specifications are searchable", () => {
  const [firstResult] = searchProducts(catalogue, "14/23");
  assert.equal(firstResult.catalogueNumber, "50/8");
});

test("Array-based specifications are searchable when present", () => {
  const [firstResult] = searchProducts(catalogue, "hydrophobic");
  assert.equal(firstResult.catalogueNumber, "ARRAY-1-A");
});

test("Category-name matching works", () => {
  const [firstResult] = searchProducts(catalogue, "hotplate");
  assert.equal(firstResult.catalogueNumber, "HOT-1");
});

test("Category-slug matching works", () => {
  const [firstResult] = searchProducts(catalogue, "membrane-filters");
  assert.equal(firstResult.catalogueNumber, "ARRAY-1");
});

test("Every keyword may match a different field", () => {
  const [firstResult] = searchProducts(catalogue, "100 borosilicate flask");
  assert.equal(firstResult.catalogueNumber, "50/8");
});

test("Products with missing optional fields do not throw", () => {
  assert.doesNotThrow(() => searchProducts(catalogue, "minimal"));
});

test("Duplicate products are not returned", () => {
  const duplicatedCatalogue = [...catalogue, { ...catalogue[0] }];
  const results = searchProducts(duplicatedCatalogue, "volumetric");
  assert.equal(results.filter((result) => result.productName === "Volumetric Flask").length, 1);
});

test("Suggestions are limited to 8", () => {
  assert.equal(getProductSuggestions(manyProducts, "lab").length, 8);
});

test("Full results are not limited to 8", () => {
  assert.equal(searchProducts(manyProducts, "lab").length, 10);
});

test("Catalogue separator normalization works safely", () => {
  const [firstResult] = searchProducts(catalogue, "50-8");
  assert.equal(firstResult.catalogueNumber, "50/8");
  assert.equal(normalizeCatalogueNumber("50 8"), normalizeCatalogueNumber("50/8"));
});

test("Original catalogue numbers remain unchanged for display", () => {
  const [firstResult] = searchProducts(catalogue, "50 8");
  assert.equal(firstResult.catalogueNumber, "50/8");
});

test("Stable ranking works for equal scores", () => {
  const results = searchProducts(catalogue, "sorting");
  assert.equal(results[0].productName, "Alpha Rack");
  assert.equal(results[1].productName, "Beta Rack");
});

test("URL generation encodes spaces", () => {
  assert.equal(buildSearchUrl("volumetric flask"), "/search?q=volumetric%20flask");
});

test("URL generation encodes slash", () => {
  assert.equal(buildSearchUrl("50/8"), "/search?q=50%2F8");
});

test("Query greater than 3 keywords is reduced correctly", () => {
  const info = getSearchQueryInfo("one two three four");
  assert.equal(info.normalizedQuery, "one two three");
  assert.equal(info.hasOverflowKeywords, true);
});

test("No [object Object] specification text is produced", () => {
  const flattened = flattenSpecificationValue({
    "Capacity (mL)": "100",
    Nested: { ignored: "value" },
    "Neck Size": "14/23",
  });

  assert.equal(flattened.includes("[object Object]"), false);
});

test("normalizeProductForSearch preserves normalized product details", () => {
  const normalized = normalizeProductForSearch(catalogue[0]);
  assert.equal(normalized.productName, "Volumetric Flask");
  assert.equal(normalized.categoryName, "Flasks");
  assert.equal(normalized.variants[0].catalogueNumber, "50/8");
});
