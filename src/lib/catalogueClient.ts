import type { CatalogueProduct } from "@/lib/catalogue";

let cachedProducts: CatalogueProduct[] | null = null;
let cataloguePromise: Promise<CatalogueProduct[]> | null = null;

type CatalogueVariant = NonNullable<CatalogueProduct["variants"]>[number];

const SPEC_KEY_ALIASES: Record<string, string> = {
  "neck": "Neck",
  "neck od": "Neck",
  "dia x height mm": "Dia x Height (mm)",
  "dia x height od mm": "Dia x Height (mm)",
};

function keyFor(value: unknown) {
  return String(value ?? "").trim();
}

function specAliasKeyFor(value: string) {
  return value
    .toLowerCase()
    .replace(/\u00d7/g, "x")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalSpecKeyFor(key: string) {
  const trimmedKey = key.trim();
  return SPEC_KEY_ALIASES[specAliasKeyFor(trimmedKey)] ?? trimmedKey;
}

function hasSpecValue(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function mergeVariantSpecs(
  primarySpecs?: Record<string, string>,
  fallbackSpecs?: Record<string, string>
) {
  if (!primarySpecs && !fallbackSpecs) return undefined;

  const merged: Record<string, string> = {};

  const applySpecs = (specs: Record<string, string> | undefined, preferNonEmpty: boolean) => {
    for (const [key, value] of Object.entries(specs ?? {})) {
      const canonicalKey = canonicalSpecKeyFor(key);
      if (!canonicalKey) continue;

      const existingValue = merged[canonicalKey];
      if (preferNonEmpty && hasSpecValue(value)) {
        merged[canonicalKey] = value;
        continue;
      }

      if (!hasSpecValue(existingValue)) {
        merged[canonicalKey] = value;
      }
    }
  };

  applySpecs(fallbackSpecs, false);
  applySpecs(primarySpecs, true);

  return merged;
}

function normalizeCatalogueProductSpecs(product: CatalogueProduct): CatalogueProduct {
  const variants = product.variants?.map((variant) => ({
    ...variant,
    specs: mergeVariantSpecs(variant.specs),
  }));

  return variants ? { ...product, variants } : product;
}

function mergeCatalogueProduct(
  enrichedProduct: CatalogueProduct,
  completeProduct?: CatalogueProduct
): CatalogueProduct {
  if (!completeProduct) return normalizeCatalogueProductSpecs(enrichedProduct);

  const enrichedVariants = Array.isArray(enrichedProduct.variants) ? enrichedProduct.variants : [];
  const completeVariants = Array.isArray(completeProduct.variants) ? completeProduct.variants : [];
  const variantsBySku = new Map<string, NonNullable<CatalogueProduct["variants"]>[number]>();

  for (const variant of completeVariants) {
    const key = keyFor(variant.sku || variant.id);
    if (key) variantsBySku.set(key, { ...variant, specs: mergeVariantSpecs(variant.specs) });
  }

  for (const variant of enrichedVariants) {
    const key = keyFor(variant.sku || variant.id);
    if (key) {
      const fallbackVariant = variantsBySku.get(key);
      variantsBySku.set(key, {
        ...fallbackVariant,
        ...variant,
        specs: mergeVariantSpecs(variant.specs, fallbackVariant?.specs),
      });
    }
  }

  const mergedVariants = Array.from(variantsBySku.values()).map((variant: CatalogueVariant) => ({
    ...variant,
    images: variant.images?.length ? variant.images : enrichedProduct.images ?? completeProduct.images ?? [],
  }));

  return {
    ...completeProduct,
    ...enrichedProduct,
    features: enrichedProduct.features?.length ? enrichedProduct.features : completeProduct.features,
    descriptionHtml: enrichedProduct.descriptionHtml || completeProduct.descriptionHtml,
    images: enrichedProduct.images?.length ? enrichedProduct.images : completeProduct.images,
    variants: mergedVariants,
  };
}

function mergeCatalogueProducts(
  enrichedProducts: CatalogueProduct[],
  completeProducts: CatalogueProduct[]
) {
  const completeByKey = new Map<string, CatalogueProduct>();
  for (const product of completeProducts) {
    for (const key of [product.sku, product.id].map(keyFor).filter(Boolean)) {
      completeByKey.set(key, product);
    }
  }

  const seen = new Set<string>();
  const merged = enrichedProducts.map((product) => {
    const key = keyFor(product.sku || product.id);
    if (key) seen.add(key);
    return mergeCatalogueProduct(product, completeByKey.get(key));
  });

  for (const product of completeProducts) {
    const key = keyFor(product.sku || product.id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(normalizeCatalogueProductSpecs(product));
  }

  return merged;
}

async function fetchCatalogueFile(path: string): Promise<CatalogueProduct[]> {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error("Unable to load the product catalogue.");
  }

  const products = (await response.json()) as CatalogueProduct[];
  return Array.isArray(products) ? products : [];
}

export async function loadCatalogueProducts(): Promise<CatalogueProduct[]> {
  if (cachedProducts) return cachedProducts;
  if (cataloguePromise) return cataloguePromise;

  cataloguePromise = Promise.all([
    fetchCatalogueFile("/data/omsons_products_from_excel_with_images.json"),
    fetchCatalogueFile("/data/nested_omsons_products.json").catch(() => []),
  ])
    .then(([enrichedProducts, completeProducts]) => {
      cachedProducts = mergeCatalogueProducts(enrichedProducts, completeProducts);
      return cachedProducts;
    })
    .finally(() => {
      cataloguePromise = null;
    });

  return cataloguePromise;
}
