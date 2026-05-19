// build_nested_products.js
//
// Produces a clean, frontend-friendly nested_products.json by merging:
//   1. Omsons_Catalog_pages29-end.xlsx  (catalog data — source of truth)
//   2. public/data/nested_products.csv  (WC export — images + HTML descriptions)

const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

// ── Paths ───────────────────────────────────────────────────────────
const CATALOG_XLSX = path.resolve("./Omsons_Catalog_with_images.xlsx");
const WC_CSV       = path.resolve("./public/data/nested_products.csv");
const OUTPUT_JSON  = path.resolve("./public/data/nested_products.json");

// ── Helpers ─────────────────────────────────────────────────────────

// "163/1" → "163", "OM260-020" → "OM260", "3038C" → "3038"
function parentSKU(catNo) {
  const s = String(catNo).trim();
  if (s.includes("/")) return s.split("/")[0];
  if (s.includes("-")) return s.split("-")[0];
  const m = s.match(/^(\d+)[A-Z]$/);
  if (m) return m[1];
  return s;
}

// Strip extraction noise like "3003 -20°C" → "3003"
function cleanCatNo(catNo) {
  const s = String(catNo).trim();
  return s.includes(" ") ? s.split(" ")[0] : s;
}

// Make a URL slug from product name + SKU
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// Parse "1245.00" / "₹1,245" / "on request" → number or null
function parsePrice(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || /on request|n\/a/i.test(s)) return null;
  const n = Number(s.replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// "10" → 10; "" → null
function parseInt0(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

// "Capacity (mL): 5; Graduation (mL): 0.02; Tolerance (±mL): 0.01"
//   → { "Capacity (mL)": "5", "Graduation (mL)": "0.02", "Tolerance (±mL)": "0.01" }
function parseSpecs(raw) {
  if (!raw) return {};
  return String(raw)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const ci = pair.indexOf(":");
      if (ci === -1) return acc;
      const key = pair.slice(0, ci).trim();
      const val = pair.slice(ci + 1).trim();
      if (key && val && val !== "-") acc[key] = val;
      return acc;
    }, {});
}

// Strip the variant-data <table> out of the WC description HTML — variants[] already has it
function stripVariantTable(html) {
  if (!html) return "";
  return String(html)
    .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, "")
    .replace(/\\n/g, "")
    .replace(/\r/g, "")
    .trim();
}

// Pipe-delimited features ("a | b | c") → array
function splitFeatures(raw) {
  if (!raw) return [];
  return String(raw)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Drop empty values so the JSON stays lean
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "string" && v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

// ── 1. Read WC CSV — build images + descriptions lookup ─────────────
console.log(`Reading WC CSV: ${WC_CSV}`);
const wcWB = XLSX.readFile(WC_CSV);
const wcRows = XLSX.utils.sheet_to_json(wcWB.Sheets[wcWB.SheetNames[0]], { defval: "" });

const wcBySKU = {};
wcRows.forEach((row) => {
  const sku = row["SKU"] != null ? String(row["SKU"]).trim() : "";
  if (!sku) return;

  const imagesRaw = row["Images"] ? String(row["Images"]).trim() : "";
  const images = imagesRaw
    ? imagesRaw.split(",").map((u) => u.trim()).filter(Boolean)
    : [];

  // Parse "Laboratory Glassware > Adapters, Laboratory Glassware" → ["Laboratory Glassware > Adapters", "Laboratory Glassware"]
  const catRaw = String(row["Categories"] || "").trim();
  const categories = catRaw ? catRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const tagsRaw = String(row["Tags"] || "").trim();
  const tags = tagsRaw ? tagsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  wcBySKU[sku] = {
    images,
    description: stripVariantTable(row["Description"] || ""),
    categories,
    tags,
  };
});
console.log(`  → ${Object.keys(wcBySKU).length} WC parent rows indexed`);

// ── 2. Read catalog Excel ───────────────────────────────────────────
console.log(`Reading catalog Excel: ${CATALOG_XLSX}`);
const catWB = XLSX.readFile(CATALOG_XLSX);
const catRows = XLSX.utils.sheet_to_json(catWB.Sheets[catWB.SheetNames[0]], { defval: "" });
console.log(`  → ${catRows.length} catalog rows`);

// ── 3. Group by parent SKU, build clean product objects ─────────────
const grouped = {};

catRows.forEach((row) => {
  const catNoRaw = String(row["Cat. No."]).trim();
  if (!catNoRaw) return;

  const catNo = cleanCatNo(catNoRaw);
  const parentId = parentSKU(catNo);
  const wc = wcBySKU[parentId] || {};

  if (!grouped[parentId]) {
    const name = String(row["Product Name"] || "").trim();
    grouped[parentId] = {
      id: parentId,                                // primary key (string — keeps "OM260" etc.)
      sku: parentId,                               // alias for compatibility
      slug: slugify(`${name}-${parentId}`),        // URL-safe: "adapters-reduction-163"
      name,
      category: String(row["Category"] || "").trim(),
      categories: wc.categories || [],             // WC hierarchical categories (optional)
      page: parseInt0(row["Page"]),                // source-PDF page (for traceability)
      hsnCode: String(row["HSN Code"] || "").trim(),
      features: splitFeatures(row["Features"]),    // ["bullet 1", "bullet 2", ...]
      descriptionHtml: wc.description || "",       // intro HTML only — variant table stripped
      tags: wc.tags || [],
      images: wc.images || [],
      variants: [],
    };
  }

  const parentImgs = grouped[parentId].images;

  grouped[parentId].variants.push({
    id: catNo,                                       // "163/1"
    sku: catNo,
    slug: slugify(catNo),                            // "163-1" — for /products/163-1
    name: `${grouped[parentId].name} - ${catNo}`,
    specs: parseSpecs(row["Specifications"]),        // structured object
    specsText: String(row["Specifications"] || ""),  // original string (handy for display)
    pack: parseInt0(row["Pack"]),
    price: parsePrice(row["Price"]),
    priceLabel: String(row["Price"] || "").trim(),   // keeps "on request" / "₹X" formatting
    inStock: true,                                   // placeholder — your stock system can update
    images: parentImgs,                              // copy of parent images (per your request)
  });
});

// Compact: strip empty fields from each product and variant
const result = Object.values(grouped).map((p) => {
  const cleaned = compact(p);
  cleaned.variants = (cleaned.variants || []).map(compact);
  return cleaned;
});

// ── 4. Write JSON ───────────────────────────────────────────────────
fs.writeFileSync(OUTPUT_JSON, JSON.stringify(result, null, 2));
const sizeMB = (fs.statSync(OUTPUT_JSON).size / 1024 / 1024).toFixed(2);
console.log(`\n✓ Wrote ${result.length} products → ${OUTPUT_JSON} (${sizeMB} MB)`);

// ── 5. Coverage report ──────────────────────────────────────────────
const totalVariants = result.reduce((sum, p) => sum + (p.variants?.length || 0), 0);
const withImg = result.filter((p) => p.images?.length > 0).length;
const withDesc = result.filter((p) => p.descriptionHtml).length;
const variantsWithPrice = result.reduce(
  (sum, p) => sum + (p.variants || []).filter((v) => typeof v.price === "number").length,
  0
);

console.log(`\nCoverage:`);
console.log(`  Total products:           ${result.length}`);
console.log(`  Total variants:           ${totalVariants}`);
console.log(`  Products with images:     ${withImg} (${((withImg / result.length) * 100).toFixed(1)}%)`);
console.log(`  Products with description:${withDesc}`);
console.log(`  Variants with valid price:${variantsWithPrice} / ${totalVariants}`);