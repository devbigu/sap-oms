'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useProductSearch, searchProducts } from '@/hooks/useProductSearch'
import { Search, AlertCircle, ShoppingCart } from 'lucide-react'
import Link from 'next/link'

interface Product {
  id: string
  sku: string
  name: string
  category: string
  price?: number
  priceLabel?: string
  images?: string[]
  inStock?: boolean
}

function SearchResultsContent() {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get('q') || ''

  const { results, isLoading, isError, query, debouncedSearch, clear } =
    useProductSearch({
      debounceMs: 300,
      minChars: 1,
      limit: 100,
    })

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  // Filter by category if selected
  const filteredResults = selectedCategory
    ? results.filter((r) => r.fullProduct.category === selectedCategory)
    : results

  // Get unique categories
  const categories = [...new Set(results.map((r) => r.fullProduct.category))].sort()

  const matchTypeColors: Record<string, string> = {
    exact_sku: 'bg-red-100 text-red-700',
    partial_sku: 'bg-orange-100 text-orange-700',
    name: 'bg-blue-100 text-blue-700',
    specs: 'bg-purple-100 text-purple-700',
    semantic: 'bg-green-100 text-green-700',
  }

  const matchTypeLabels: Record<string, string> = {
    exact_sku: 'Exact SKU',
    partial_sku: 'SKU Match',
    name: 'Name Match',
    specs: 'Specs Match',
    semantic: 'Semantic Match',
  }

  // Initialize with query on mount
  if (initialQuery && !query) {
    debouncedSearch(initialQuery)
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Product Search</h1>
          <p className="text-gray-600">Search by SKU, product name, or specifications</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Search Bar */}
        <div className="mb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by SKU (e.g., '1/4'), name (e.g., 'burette'), or specs (e.g., '25 mL')..."
              value={query}
              onChange={(e) => debouncedSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg text-base bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
            {query && (
              <button
                onClick={clear}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Layout: Sidebar + Results */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar - Filters */}
          {results.length > 0 && (
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Filters</h3>

                {/* Category Filter */}
                {categories.length > 0 && (
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Category
                    </label>
                    <div className="space-y-2">
                      <button
                        onClick={() => setSelectedCategory(null)}
                        className={`block w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                          selectedCategory === null
                            ? 'bg-indigo-50 text-indigo-700 font-medium'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        All Categories ({results.length})
                      </button>
                      {categories.map((cat) => {
                        const count = results.filter(
                          (r) => r.fullProduct.category === cat
                        ).length
                        return (
                          <button
                            key={cat}
                            onClick={() => setSelectedCategory(cat)}
                            className={`block w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                              selectedCategory === cat
                                ? 'bg-indigo-50 text-indigo-700 font-medium'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {cat} <span className="text-gray-500">({count})</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Match Type Legend */}
                <div className="pt-4 border-t border-gray-200">
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Match Types
                  </label>
                  <div className="space-y-2 text-xs">
                    {Object.entries(matchTypeLabels).map(([key, label]) => (
                      <div key={key} className="flex items-center gap-2">
                        <span
                          className={`inline-block w-3 h-3 rounded ${matchTypeColors[key]}`}
                        />
                        <span className="text-gray-600">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main Results */}
          <div className={results.length > 0 ? 'lg:col-span-3' : 'lg:col-span-4'}>
            {/* Loading */}
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="inline-block">
                    <div className="w-8 h-8 border-4 border-gray-200 border-t-indigo-500 rounded-full animate-spin mb-3" />
                  </div>
                  <p className="text-gray-600">Searching...</p>
                </div>
              </div>
            )}

            {/* Error */}
            {isError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-red-900">Search Error</h3>
                  <p className="text-sm text-red-700 mt-1">Failed to fetch search results. Please try again.</p>
                </div>
              </div>
            )}

            {/* No query */}
            {!isLoading && !isError && !query && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
                <Search className="w-12 h-12 text-blue-400 mx-auto mb-3" />
                <h3 className="font-semibold text-blue-900 mb-2">Start Searching</h3>
                <p className="text-sm text-blue-700">
                  Enter a product name, SKU, or specification to find products
                </p>
              </div>
            )}

            {/* No results */}
            {!isLoading && !isError && query && filteredResults.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-8 text-center">
                <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
                <h3 className="font-semibold text-amber-900 mb-2">No Results Found</h3>
                <p className="text-sm text-amber-700">
                  No products match "{query}"
                  {selectedCategory && ` in ${selectedCategory}`}. Try adjusting your search.
                </p>
              </div>
            )}

            {/* Results Grid */}
            {!isLoading && filteredResults.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-6">
                  <p className="text-sm text-gray-600">
                    Showing <span className="font-semibold">{filteredResults.length}</span> results
                    {selectedCategory && ` in ${selectedCategory}`}
                  </p>
                </div>

                <div className="space-y-3">
                  {filteredResults.map((result, idx) => {
                    const product = result.fullProduct

                    return (
                      <Link
                        key={`${result.id}-${idx}`}
                        href={`/Products/${result.id}`}
                        className="block bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition p-4"
                      >
                        <div className="flex items-start gap-4">
                          {/* Image */}
                          {product.images?.[0] && (
                            <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden shrink-0">
                              <img
                                src={product.images[0]}
                                alt={result.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="font-mono text-xs font-semibold text-indigo-600">
                                {result.sku}
                              </span>
                              <span
                                className={`text-xs font-medium px-2 py-0.5 rounded ${
                                  matchTypeColors[result.matchType]
                                }`}
                              >
                                {matchTypeLabels[result.matchType]}
                              </span>
                              {result.relevance > 0 && (
                                <span className="text-xs text-gray-500">
                                  {result.relevance}% match
                                </span>
                              )}
                            </div>

                            <h3 className="text-sm font-semibold text-gray-900 truncate">
                              {result.name}
                            </h3>

                            {product.specsText && (
                              <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                {product.specsText}
                              </p>
                            )}

                            <div className="flex items-center gap-4 mt-3">
                              {product.priceLabel && (
                                <span className="text-sm font-semibold text-gray-900">
                                  ₹{product.priceLabel}
                                </span>
                              )}
                              {product.inStock !== undefined && (
                                <span
                                  className={`text-xs font-medium ${
                                    product.inStock
                                      ? 'text-green-700'
                                      : 'text-red-700'
                                  }`}
                                >
                                  {product.inStock ? 'In Stock' : 'Out of Stock'}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Add to Cart CTA */}
                          <button
                            className="ml-auto p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition shrink-0"
                            title="Add to cart"
                          >
                            <ShoppingCart className="w-5 h-5" />
                          </button>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SearchResultsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-100" />}>
      <SearchResultsContent />
    </Suspense>
  )
}
