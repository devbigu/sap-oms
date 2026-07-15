import type { CatalogueProduct } from "@/lib/catalogue";

let cachedProducts: CatalogueProduct[] | null = null;
let cataloguePromise: Promise<CatalogueProduct[]> | null = null;

export async function loadCatalogueProducts(): Promise<CatalogueProduct[]> {
  if (cachedProducts) return cachedProducts;
  if (cataloguePromise) return cataloguePromise;

  cataloguePromise = fetch("/data/omsons_products_from_excel_with_images.json", {
    cache: "force-cache",
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error("Unable to load the product catalogue.");
      }

      const products = (await response.json()) as CatalogueProduct[];
      cachedProducts = Array.isArray(products) ? products : [];
      return cachedProducts;
    })
    .finally(() => {
      cataloguePromise = null;
    });

  return cataloguePromise;
}
