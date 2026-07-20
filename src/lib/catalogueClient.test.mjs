import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

let importCounter = 0;

async function importCatalogueClient() {
  const source = await fs.readFile(path.resolve("src/lib/catalogueClient.ts"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  importCounter += 1;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}#${importCounter}`);
}

test("loadCatalogueProducts merges complete nested variants into enriched catalogue products", async () => {
  const originalFetch = globalThis.fetch;
  const client = await importCatalogueClient();

  globalThis.fetch = async (url) => {
    const pathName = String(url);
    if (pathName.includes("omsons_products_from_excel_with_images")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "58",
            sku: "58",
            name: "Volumetric Flask Amber",
            images: ["/image-enriched.jpg"],
            variants: [
              { id: "58/1", sku: "58/1", price: 100, images: ["/variant-enriched.jpg"] },
              { id: "58/2", sku: "58/2", price: 200 },
            ],
          },
        ],
      };
    }

    if (pathName.includes("nested_omsons_products")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "58",
            sku: "58",
            name: "Volumetric Flask Amber",
            images: ["/nested.jpg"],
            variants: [
              { id: "58/1", sku: "58/1", price: 90 },
              { id: "58/2", sku: "58/2", price: 190 },
              { id: "58/3", sku: "58/3", price: 300 },
            ],
          },
        ],
      };
    }

    throw new Error(`Unexpected URL ${pathName}`);
  };

  try {
    const products = await client.loadCatalogueProducts();
    const product = products.find((item) => item.sku === "58");
    assert.deepEqual(product.variants.map((variant) => variant.sku), ["58/1", "58/2", "58/3"]);
    assert.equal(product.images[0], "/image-enriched.jpg");
    assert.equal(product.variants[0].price, 100);
    assert.equal(product.variants[0].images[0], "/variant-enriched.jpg");
    assert.equal(product.variants[2].images[0], "/image-enriched.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadCatalogueProducts normalizes merged variant specification aliases", async () => {
  const originalFetch = globalThis.fetch;
  const client = await importCatalogueClient();
  const nestedVariants = Array.from({ length: 15 }, (_, index) => {
    const variantNumber = index + 1;
    return {
      id: `58/${variantNumber}`,
      sku: `58/${variantNumber}`,
      price: 90 + variantNumber,
      specs: {
        "Capacity (ml)": String(variantNumber),
        "Neck Size": "14/23",
        "Tolerance (±mL)": "0.025",
        Neck: `neck-${variantNumber}`,
        "Dia x Height OD (mm)": `dia-${variantNumber}`,
        "Secondary Only": `secondary-${variantNumber}`,
      },
    };
  });

  globalThis.fetch = async (url) => {
    const pathName = String(url);
    if (pathName.includes("omsons_products_from_excel_with_images")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "58",
            sku: "58",
            name: "Volumetric Flask Amber",
            images: ["/image-enriched.jpg"],
            variants: [
              {
                id: "58/1",
                sku: "58/1",
                price: 100,
                images: ["/variant-enriched.jpg"],
                specs: {
                  "Capacity (ml)": "1",
                  "Neck OD": "10-enriched",
                  "Dia x Height (mm)": "13x65-enriched",
                  "Tolerance (±mL)": "0.025",
                  "Unrelated Spec": "keep-enriched",
                },
              },
              {
                id: "58/2",
                sku: "58/2",
                price: 200,
                specs: {
                  "Neck OD": "",
                  "Dia x Height (mm)": "",
                  "Unrelated Spec": "keep-second",
                },
              },
            ],
          },
        ],
      };
    }

    if (pathName.includes("nested_omsons_products")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "58",
            sku: "58",
            name: "Volumetric Flask Amber",
            images: ["/nested.jpg"],
            variants: nestedVariants,
          },
        ],
      };
    }

    throw new Error(`Unexpected URL ${pathName}`);
  };

  try {
    const products = await client.loadCatalogueProducts();
    const product = products.find((item) => item.sku === "58");
    const expectedSkus = Array.from({ length: 15 }, (_, index) => `58/${index + 1}`);
    assert.deepEqual(product.variants.map((variant) => variant.sku), expectedSkus);

    const allSpecKeys = new Set(product.variants.flatMap((variant) => Object.keys(variant.specs ?? {})));
    assert.equal(allSpecKeys.has("Neck"), true);
    assert.equal(allSpecKeys.has("Neck OD"), false);
    assert.equal(allSpecKeys.has("Dia x Height (mm)"), true);
    assert.equal(allSpecKeys.has("Dia x Height OD (mm)"), false);

    assert.equal(product.variants[0].specs.Neck, "10-enriched");
    assert.equal(product.variants[0].specs["Dia x Height (mm)"], "13x65-enriched");
    assert.equal(product.variants[1].specs.Neck, "neck-2");
    assert.equal(product.variants[1].specs["Dia x Height (mm)"], "dia-2");
    assert.equal(product.variants[0].specs["Unrelated Spec"], "keep-enriched");
    assert.equal(product.variants[2].specs["Secondary Only"], "secondary-3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
