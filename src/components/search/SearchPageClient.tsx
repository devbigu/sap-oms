'use client'

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CatalogueProductCard from "@/components/catalogue/CatalogueProductCard";
import { useCatalogueProducts } from "@/hooks/useCatalogueProducts";
import productSearch from "@/lib/productSearch.js";
import type { CatalogueProduct } from "@/lib/catalogue";

const { getSearchQueryInfo, normalizeProductForSearch, searchProducts, buildSearchUrl } = productSearch;
const PAGE_SIZE = 24;

function SearchPageSearchForm({
  initialValue,
  onSubmitSearch,
  onClearSearch,
}: {
  initialValue: string;
  onSubmitSearch: (value: string) => void;
  onClearSearch: () => void;
}) {
  const [inputValue, setInputValue] = useState(initialValue);
  const inputQueryInfo = useMemo(() => getSearchQueryInfo(inputValue), [inputValue]);

  return (
    <form
      className="mt-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitSearch(inputValue);
      }}
    >
      <label htmlFor="search-page-query" className="mb-2 block text-sm font-medium text-slate-700">
        Search products
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="search-page-query"
          type="text"
          value={inputValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            setInputValue(nextValue);
            if (!nextValue.trim()) {
              onClearSearch();
            }
          }}
          placeholder="Try volumetric flask, 100ml flask, or 50/8"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        />
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setInputValue("");
              onClearSearch();
            }}
            className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Clear
          </button>
        </div>
      </div>
      {inputQueryInfo.hasOverflowKeywords && (
        <p className="mt-2 text-sm text-amber-700">Only the first 3 keywords will be used.</p>
      )}
    </form>
  );
}

function SearchPagePagination({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const items: Array<number | "..."> = [1];
  const start = Math.max(2, currentPage - 2);
  const end = Math.min(totalPages - 1, currentPage + 2);

  if (start > 2) items.push("...");
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < totalPages - 1) items.push("...");
  if (totalPages > 1) items.push(totalPages);

  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => onChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="rounded border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 disabled:cursor-default disabled:opacity-40"
      >
        Prev
      </button>
      {items.map((item, index) =>
        item === "..." ? (
          <span key={`ellipsis-${index}`} className="px-2 text-sm text-slate-400">
            ...
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={`min-w-10 rounded border px-3 py-2 text-sm ${
              item === currentPage
                ? "border-slate-800 bg-slate-800 text-white"
                : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            {item}
          </button>
        )
      )}
      <button
        type="button"
        onClick={() => onChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="rounded border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 disabled:cursor-default disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

export default function SearchPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { products, loading, error } = useCatalogueProducts();

  const queryFromUrl = searchParams.get("q") ?? "";
  const pageParam = searchParams.get("page") ?? "";
  const queryInfo = useMemo(() => getSearchQueryInfo(queryFromUrl), [queryFromUrl]);

  const normalizedProducts = useMemo(
    () => products.map((product) => normalizeProductForSearch(product)),
    [products]
  );

  const results = useMemo(
    () => searchProducts(normalizedProducts as never[], queryInfo.normalizedQuery),
    [normalizedProducts, queryInfo.normalizedQuery]
  );

  const parsedPage = Number.parseInt(pageParam, 10);
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const paginatedResults = results.slice(pageStart, pageStart + PAGE_SIZE);

  const updatePage = (page: number) => {
    if (!queryInfo.normalizedQuery) {
      router.push("/search");
      return;
    }

    if (page <= 1) {
      router.push(buildSearchUrl(queryInfo.normalizedQuery));
      return;
    }

    const params = new URLSearchParams();
    params.set("q", queryInfo.normalizedQuery);
    params.set("page", String(page));
    router.push(`/search?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1360px] px-6 py-8">
          <h1 className="text-3xl font-bold text-slate-900">Product Search</h1>
          <p className="mt-2 text-sm text-slate-600">
            Search for products by name, catalogue number, specification, or category.
          </p>

          <SearchPageSearchForm
            key={queryInfo.normalizedQuery}
            initialValue={queryInfo.normalizedQuery}
            onSubmitSearch={(value) => router.push(buildSearchUrl(value))}
            onClearSearch={() => router.push("/search")}
          />
        </div>
      </div>

      <div className="mx-auto max-w-[1360px] px-6 py-8">
        {!queryInfo.normalizedQuery && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
            <h2 className="text-xl font-semibold text-slate-900">Start with a search</h2>
            <p className="mt-2 text-sm text-slate-600">
              Search for products by name, catalogue number, specification, or category.
            </p>
          </div>
        )}

        {queryInfo.normalizedQuery && loading && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-600">
            Loading catalogue...
          </div>
        )}

        {queryInfo.normalizedQuery && !loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
            <h2 className="text-lg font-semibold text-red-900">Search unavailable</h2>
            <p className="mt-2 text-sm text-red-700">
              The product catalogue could not be loaded right now. Please try again.
            </p>
          </div>
        )}

        {queryInfo.normalizedQuery && !loading && !error && results.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
            <h2 className="text-xl font-semibold text-slate-900">
              No products found for &ldquo;{queryInfo.normalizedQuery}&rdquo;.
            </h2>
            <p className="mt-2 text-sm text-slate-600">Try adjusting the search or clear it to start again.</p>
            <button
              type="button"
              onClick={() => router.push("/search")}
              className="mt-5 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Clear search
            </button>
          </div>
        )}

        {queryInfo.normalizedQuery && !loading && !error && results.length > 0 && (
          <>
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">
                  Search results for &ldquo;{queryInfo.normalizedQuery}&rdquo;
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {results.length} product{results.length === 1 ? "" : "s"} found
                </p>
              </div>
              <p className="text-sm text-slate-500">
                Showing {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, results.length)} of {results.length}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {paginatedResults.map((result) => (
                <CatalogueProductCard
                  key={`${result.route}-${result.catalogueNumber}`}
                  product={result.originalProduct as CatalogueProduct}
                  href={result.route}
                  skuLabel={result.catalogueNumber}
                  descriptionOverride={result.previewText}
                />
              ))}
            </div>

            <SearchPagePagination currentPage={currentPage} totalPages={totalPages} onChange={updatePage} />
          </>
        )}
      </div>
    </div>
  );
}
