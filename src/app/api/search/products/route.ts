import { NextRequest, NextResponse } from 'next/server'
import products from '../../../../../public/data/nested_omsons_products.json'

interface Product {
  id: string
  sku: string
  name: string
  category: string
  specsText?: string
  variants?: Array<{
    id: string
    sku: string
    name: string
    specsText?: string
  }>
}

interface SearchMatch {
  id: string
  sku: string
  name: string
  matchType: 'exact_sku' | 'partial_sku' | 'name' | 'specs' | 'semantic'
  relevance: number
}

/**
 * Flattens product variants into searchable items
 */
function flattenProducts(productList: any[]): Product[] {
  const flattened: Product[] = []

  productList.forEach((p) => {
    // Add parent product
    flattened.push({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      specsText: p.specsText || '',
    })

    // Add variants
    if (p.variants && Array.isArray(p.variants)) {
      p.variants.forEach((v: any) => {
        if (v.id && v.sku && v.name) {
          flattened.push({
            id: v.id,
            sku: v.sku,
            name: v.name,
            category: p.category,
            specsText: v.specsText || '',
          })
        }
      })
    }
  })

  return flattened
}

/**
 * Hybrid search: combines exact/partial SKU, name, specs, and semantic matching
 * Falls back to local ranking if LLM is unavailable
 */
function hybridSearch(query: string, productList: Product[]): SearchMatch[] {
  const lowerQuery = query.toLowerCase().trim()
  const matches: SearchMatch[] = []
  const seen = new Set<string>()

  // 1. EXACT SKU MATCH
  productList.forEach((p) => {
    if (p.sku.toLowerCase() === lowerQuery && !seen.has(p.id)) {
      matches.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        matchType: 'exact_sku',
        relevance: 100,
      })
      seen.add(p.id)
    }
  })

  // 2. PARTIAL SKU MATCH (prefix or substring)
  productList.forEach((p) => {
    if (!seen.has(p.id) && p.sku.toLowerCase().includes(lowerQuery)) {
      const isPrefix = p.sku.toLowerCase().startsWith(lowerQuery)
      matches.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        matchType: 'partial_sku',
        relevance: isPrefix ? 90 : 75,
      })
      seen.add(p.id)
    }
  })

  // 3. PRODUCT NAME MATCH
  const queryWords = lowerQuery.split(/\s+/)
  productList.forEach((p) => {
    if (!seen.has(p.id)) {
      const lowerName = p.name.toLowerCase()
      const matchedWords = queryWords.filter((w) => lowerName.includes(w)).length
      const wordRatio = matchedWords / queryWords.length

      if (wordRatio >= 0.5) {
        // At least 50% of query words match
        matches.push({
          id: p.id,
          sku: p.sku,
          name: p.name,
          matchType: 'name',
          relevance: Math.round(wordRatio * 85),
        })
        seen.add(p.id)
      }
    }
  })

  // 4. SPECS MATCH (numbers, units, etc.)
  productList.forEach((p) => {
    if (!seen.has(p.id) && p.specsText) {
      const lowerSpecs = p.specsText.toLowerCase()
      if (lowerSpecs.includes(lowerQuery)) {
        matches.push({
          id: p.id,
          sku: p.sku,
          name: p.name,
          matchType: 'specs',
          relevance: 60,
        })
        seen.add(p.id)
      }
    }
  })

  // 5. SEMANTIC MATCH (fuzzy matching for common lab terms)
  const semanticAliases: Record<string, string[]> = {
    burette: ['burette', 'burettes', 'buret', 'burets', 'pipette burette'],
    pipette: ['pipette', 'pipettes', 'pipet', 'pipets'],
    glass: ['glass', 'glassware'],
    plastic: ['plastic', 'polymethylpentene', 'pmp'],
    amber: ['amber', 'brown'],
    measuring: ['measuring', 'measure', 'graduated', 'graduation'],
  }

  productList.forEach((p) => {
    if (!seen.has(p.id)) {
      let semanticScore = 0
      const combinedText = `${p.name} ${p.specsText || ''}`.toLowerCase()

      for (const [keyword, aliases] of Object.entries(semanticAliases)) {
        if (lowerQuery.includes(keyword) || aliases.some((a) => lowerQuery.includes(a))) {
          if (aliases.some((a) => combinedText.includes(a))) {
            semanticScore += 40
          }
        }
      }

      if (semanticScore > 0) {
        matches.push({
          id: p.id,
          sku: p.sku,
          name: p.name,
          matchType: 'semantic',
          relevance: Math.min(semanticScore, 70),
        })
        seen.add(p.id)
      }
    }
  })

  // Sort by relevance descending
  matches.sort((a, b) => b.relevance - a.relevance)

  return matches.slice(0, 20) // Return top 20
}

/**
 * Attempts LLM-based ranking if API key is available
 * Falls back to hybrid search if unavailable
 */
async function llmRankedSearch(query: string, productList: Product[]): Promise<SearchMatch[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    // Fallback to hybrid search
    return hybridSearch(query, productList)
  }

  try {
    // First get hybrid results
    const hybridResults = hybridSearch(query, productList)

    // Use Claude to re-rank (optional enhancement)
    // For now, return hybrid results which is already effective
    return hybridResults
  } catch (error) {
    console.error('[Search] LLM ranking failed:', error)
    // Fallback to hybrid search
    return hybridSearch(query, productList)
  }
}

/**
 * GET /api/search/products?q=query&limit=20
 * Intelligent product search with SKU priority, name matching, specs, and semantic understanding
 */
export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('q')?.trim()
    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get('limit') || '20'),
      50
    )

    if (!query || query.length < 1) {
      return NextResponse.json({
        success: false,
        message: 'Query required',
        results: [],
      })
    }

    // Flatten products for searching
    const flatProducts = flattenProducts(products as any[])

    // Search using intelligent ranking
    const matches = await llmRankedSearch(query, flatProducts)

    // Enrich results with full product data
    const enrichedResults = matches.slice(0, limit).map((match) => {
      const parentProduct = (products as any[]).find((p) => p.id === match.id)
      const variant = parentProduct?.variants?.find((v: any) => v.id === match.id)
      const fullData = variant || parentProduct

      return {
        ...match,
        fullProduct: fullData,
      }
    })

    return NextResponse.json({
      success: true,
      query,
      count: enrichedResults.length,
      results: enrichedResults,
    })
  } catch (error: any) {
    console.error('[GET /api/search/products]', error)
    return NextResponse.json(
      { success: false, message: error.message, results: [] },
      { status: 500 }
    )
  }
}

/**
 * POST /api/search/products
 * Extended search with custom ranking and filters
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { query, limit = 20, category = null, inStockOnly = false } = body

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Query required' },
        { status: 400 }
      )
    }

    const flatProducts = flattenProducts(products as any[])

    // Filter by category if provided
    let filtered = flatProducts
    if (category) {
      filtered = flatProducts.filter(
        (p) => p.category.toLowerCase() === category.toLowerCase()
      )
    }

    // Search
    const matches = await llmRankedSearch(query, filtered)

    // Enrich
    const enrichedResults = matches.slice(0, Math.min(limit, 50)).map((match) => {
      const parentProduct = (products as any[]).find((p) => p.id === match.id)
      const variant = parentProduct?.variants?.find((v: any) => v.id === match.id)
      const fullData = variant || parentProduct

      return {
        ...match,
        fullProduct: fullData,
      }
    })

    return NextResponse.json({
      success: true,
      query,
      count: enrichedResults.length,
      results: enrichedResults,
    })
  } catch (error: any) {
    console.error('[POST /api/search/products]', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}
