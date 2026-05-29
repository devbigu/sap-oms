'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

interface SearchResult {
  id: string
  sku: string
  name: string
  matchType: 'exact_sku' | 'partial_sku' | 'name' | 'specs' | 'semantic'
  relevance: number
  fullProduct: any
}

interface UseProductSearchReturn {
  results: SearchResult[]
  isLoading: boolean
  isError: boolean
  query: string
  setQuery: (q: string) => void
  debouncedSearch: (q: string) => void
  clear: () => void
}

/**
 * Hook for product search with debouncing and React Query caching
 * @param options - Configuration options
 * @returns Search results, loading state, and search controls
 *
 * Usage:
 * ```tsx
 * const { results, isLoading, query, setQuery } = useProductSearch({
 *   debounceMs: 300,
 *   minChars: 2,
 * })
 * ```
 */
export function useProductSearch(options?: {
  debounceMs?: number
  minChars?: number
  limit?: number
  category?: string
}): UseProductSearchReturn {
  const debounceMs = options?.debounceMs ?? 300
  const minChars = options?.minChars ?? 1
  const limit = options?.limit ?? 20

  const [query, setQuery] = useState('')
  const debounceTimer = useRef<NodeJS.Timeout>()
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Debounced search
  const debouncedSearch = useCallback(
    (q: string) => {
      setQuery(q)

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }

      debounceTimer.current = setTimeout(() => {
        if (q.length >= minChars) {
          setDebouncedQuery(q)
        } else {
          setDebouncedQuery('')
        }
      }, debounceMs)
    },
    [debounceMs, minChars]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [])

  // Fetch search results
  const { data, isLoading, isError } = useQuery({
    queryKey: ['product-search', debouncedQuery, limit, options?.category],
    queryFn: async () => {
      if (!debouncedQuery) return { results: [] }

      const res = await axios.post('/api/search/products', {
        query: debouncedQuery,
        limit,
        category: options?.category || null,
      })

      return res.data
    },
    enabled: debouncedQuery.length >= minChars,
    staleTime: 2 * 60 * 1000, // 2 minutes
  })

  const results = data?.results || []

  const clear = useCallback(() => {
    setQuery('')
    setDebouncedQuery('')
  }, [])

  return {
    results,
    isLoading,
    isError,
    query,
    setQuery,
    debouncedSearch,
    clear,
  }
}

/**
 * Alternative: Direct function for imperative search (without debouncing)
 */
export async function searchProducts(
  query: string,
  options?: {
    limit?: number
    category?: string
  }
): Promise<SearchResult[]> {
  if (!query) return []

  try {
    const res = await axios.post('/api/search/products', {
      query,
      limit: options?.limit || 20,
      category: options?.category || null,
    })

    return res.data.results || []
  } catch (error) {
    console.error('Product search error:', error)
    return []
  }
}
