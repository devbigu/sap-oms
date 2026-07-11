'use client'

import { useEffect, useState } from "react";
import type { CatalogueProduct } from "@/lib/catalogue";
import { loadCatalogueProducts } from "@/lib/catalogueClient";

export function useCatalogueProducts() {
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    loadCatalogueProducts()
      .then((catalogueProducts) => {
        if (!active) return;
        setProducts(catalogueProducts);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setProducts([]);
        setError(err instanceof Error ? err : new Error("Unable to load the product catalogue."));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return { products, loading, error };
}
