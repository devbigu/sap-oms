import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const pagesProductsPath = path.resolve("src/app/Pages/products/page.tsx");
const productsPath = path.resolve("src/app/Products/page.tsx");

async function readPagesProducts() {
  return fs.readFile(pagesProductsPath, "utf8");
}

async function readProducts() {
  return fs.readFile(productsPath, "utf8");
}

test("/Pages/products no longer fetches the PHP product pagination endpoint", async () => {
  const source = await readPagesProducts();

  assert.doesNotMatch(source, /axios\.get\(`\$\{BACKEND_URL\}\/pegination/);
  assert.doesNotMatch(source, /\/pegination\?/);
});

test("/Pages/products uses the same catalogue source as /Products", async () => {
  const pagesSource = await readPagesProducts();
  const productsSource = await readProducts();

  assert.match(productsSource, /loadCatalogueProducts/);
  assert.match(pagesSource, /loadCatalogueProducts/);
  assert.match(pagesSource, /from ['"]@\/lib\/catalogueClient['"]/);
});

test("/Pages/products keeps the existing admin catalogue table UI intact", async () => {
  const source = await readPagesProducts();

  for (const label of ['"Catalogue No."', '"Product"', '"Price"', '"Qty"', '"Unit"', '"Actions"']) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(source, /Export CSV/);
  assert.match(source, /Delete Product/);
  assert.match(source, /Browse and manage your product catalogue/);
});

test("/Pages/products preserves search, filters, and pagination behavior", async () => {
  const source = await readPagesProducts();

  assert.match(source, /searchProducts\(products,\s*queryInfo\.normalizedQuery\)/);
  assert.match(source, /productMatchesCategory\(product,\s*selectedCategory\)/);
  assert.match(source, /filteredProducts\.slice\(start,\s*start \+ ITEMS_PER_PAGE\)/);
  assert.match(source, /function pageNumbers/);
  assert.match(source, /handlePageChange/);
});

test("/Pages/products narrows variant catalogue-number searches to the matching variant row", async () => {
  const source = await readPagesProducts();

  assert.match(source, /matchedVariant/);
  assert.match(source, /variantCatalogue\.includes\(catalogueQuery\)/);
  assert.match(source, /isVariantCatalogueMatch \? \[variant\] : undefined/);
});

test("/Pages/products maps catalogue rows to card fields used by the existing UI", async () => {
  const source = await readPagesProducts();

  assert.match(source, /product_image:\s*getVariantImage\(product,\s*variant\)/);
  assert.match(source, /product_name:\s*firstNonEmpty\(product\.name/);
  assert.match(source, /product_cat:\s*sku/);
  assert.match(source, /product_price:\s*priceToString\(variant\?\.price\)/);
  assert.match(source, /product_quantity:\s*getVariantPackSize\(variant\)/);
});

test("/Pages/products preserves product detail route data without changing /Products", async () => {
  const pagesSource = await readPagesProducts();
  const productsSource = await readProducts();

  assert.match(pagesSource, /product_detail_href:\s*`\/Products\/\$\{encodeURIComponent/);
  assert.match(productsSource, /Link href=\{`\/Products\/\$\{product\.sku\}`\}/);
  assert.match(productsSource, /loadCatalogueProducts\(\)/);
});
