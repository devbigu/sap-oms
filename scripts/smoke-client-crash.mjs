import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const crashMarkers = [
  "Application error: a client-side exception has occurred",
  "client-side exception has occurred while loading",
  "ChunkLoadError",
  "Internal Server Error",
  "Invariant: The client reference manifest",
];

const pageChecks = [
  "/Products",
  "/Products?cat=Lab%20Instruments&q=HMC-AL-15L",
  "/Products/OM310-020",
  "/categories/lab-instruments",
  "/search?q=OM310-020",
  "/dashboard/dealer",
  "/dashboard/dealer/AddOrderForm",
  "/dashboard/staff",
  "/dashboard/staff/dealerlist",
  "/dashboard/staff/orderstatus",
  "/dashboard/staff/pending-products",
  "/dashboard/staff/sales",
  "/Pages/Ordermanagement",
  "/Pages/Ordermanagement/outstandingorders",
  "/dashboard/admin",
  "/dashboard/admin/dealer/DealerList",
];

const artifactChecks = [
  ".next/server/app/Products/page_client-reference-manifest.js",
  ".next/server/app/Products/[sku]/page_client-reference-manifest.js",
  ".next/server/app/dashboard/dealer/page_client-reference-manifest.js",
  ".next/server/app/dashboard/dealer/AddOrderForm/page_client-reference-manifest.js",
  ".next/server/app/dashboard/staff/page_client-reference-manifest.js",
  ".next/server/app/dashboard/staff/dealerlist/page_client-reference-manifest.js",
  ".next/server/app/dashboard/staff/orderstatus/page_client-reference-manifest.js",
  ".next/server/app/dashboard/staff/pending-products/page_client-reference-manifest.js",
  ".next/server/app/dashboard/staff/sales/page_client-reference-manifest.js",
  ".next/server/app/Pages/Ordermanagement/page_client-reference-manifest.js",
  ".next/server/app/Pages/Ordermanagement/outstandingorders/page_client-reference-manifest.js",
  ".next/server/app/dashboard/admin/dealer/DealerList/page_client-reference-manifest.js",
];

const apiChecks = [
  {
    path: "/api/search/products?q=OM310-020&limit=5",
    validate: async (response) => {
      const json = await response.json();
      if (!json?.success || !Array.isArray(json.results) || json.results.length === 0) {
        throw new Error(`Expected product search results for OM310-020, got ${JSON.stringify(json).slice(0, 300)}`);
      }
    },
  },
  {
    path: "/api/search/products?q=HMC-AL-15L&limit=5",
    validate: async (response) => {
      const json = await response.json();
      const found = Array.isArray(json.results) && json.results.some((result) => result?.sku === "HMC-AL-15L");
      if (!json?.success || !found) {
        throw new Error(`Expected HMC-AL-15L in product search results, got ${JSON.stringify(json).slice(0, 300)}`);
      }
    },
  },
];

function buildUrl(path) {
  return new URL(path, baseUrl).toString();
}

function assertArtifact(path) {
  const fullPath = resolve(repoRoot, path);

  if (!existsSync(fullPath)) {
    throw new Error(`Missing build artifact ${path}`);
  }

  console.log(`ok artifact ${path}`);
}

async function assertPage(path) {
  const response = await fetch(buildUrl(path), { redirect: "manual" });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  const marker = crashMarkers.find((value) => body.includes(value));
  if (marker) {
    throw new Error(`${path} rendered crash marker: ${marker}`);
  }

  console.log(`ok page ${path}`);
}

async function assertApi({ path, validate }) {
  const response = await fetch(buildUrl(path), { redirect: "manual" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  await validate(response);
  console.log(`ok api ${path}`);
}

for (const path of artifactChecks) {
  assertArtifact(path);
}

for (const path of pageChecks) {
  await assertPage(path);
}

for (const check of apiChecks) {
  await assertApi(check);
}

console.log("Crash smoke test passed.");
