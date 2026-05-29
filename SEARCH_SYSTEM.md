# Intelligent Product Search System

## Overview
A sophisticated product search system for Omsons Labs that uses intelligent ranking prioritizing:
1. **Exact SKU matches** (highest priority)
2. **Partial SKU matches** (prefix or substring)
3. **Product name matches** (word-based)
4. **Specification matches** (numeric values, dimensions)
5. **Semantic matches** (understanding product intent)

## Features

### ✨ Smart Ranking
- **SKU Priority**: Treats SKUs as unique identifiers (never as math)
- **Partial Matching**: "1/" matches "1/1", "1/2", "1/3", etc.
- **Word-Based Matching**: Splits queries into keywords and matches against product names
- **Specs Awareness**: Matches measurement values (e.g., "25 mL", "580mm")
- **Semantic Understanding**: Common lab terminology (burette → pipette, glass → glassware)
- **Relevance Scoring**: Each match gets a relevance score (0-100)

### 🚀 Performance
- **Hybrid Approach**: Local ranking + optional LLM enhancement
- **Client-side Filtering**: Category and match-type filtering
- **Debouncing**: Configurable debounce for input optimization
- **React Query Caching**: Automatic result caching with 2-minute stale time
- **Flat Product Index**: Variants are searchable as individual items

### 🎯 Match Types
| Type | Priority | Example | Use Case |
|------|----------|---------|----------|
| `exact_sku` | 100 | "1/4" → "1/4" | Direct SKU lookup |
| `partial_sku` | 90-75 | "1/" → "1/4", "1/1" | SKU prefix search |
| `name` | 85 | "burette" → product name | Product discovery |
| `specs` | 60 | "25 mL" → specs text | Size/spec search |
| `semantic` | 70 | "glass burette" → relevant products | Intent-based search |

## Files

### API Routes
- **`/src/app/api/search/products/route.ts`**
  - `GET /api/search/products?q=query&limit=20`
  - `POST /api/search/products` (extended options)

### Hooks
- **`/src/hooks/useProductSearch.ts`**
  - `useProductSearch()` - React hook with debouncing
  - `searchProducts()` - Direct function for imperative search

### Components
- **`/src/components/ProductSearch.tsx`** - Dropdown search component
- **`/src/app/search/page.tsx`** - Full search results page

## Usage

### Basic Search Hook
```tsx
import { useProductSearch } from '@/hooks/useProductSearch'

export default function MyComponent() {
  const { results, isLoading, query, debouncedSearch, clear } = useProductSearch({
    debounceMs: 300,
    minChars: 1,
    limit: 20,
  })

  return (
    <div>
      <input
        value={query}
        onChange={(e) => debouncedSearch(e.target.value)}
        placeholder="Search products..."
      />
      
      <div>
        {isLoading && <p>Loading...</p>}
        {results.map((r) => (
          <div key={r.id}>
            <strong>{r.sku}</strong> - {r.name}
            <small>{r.matchType} match ({r.relevance}%)</small>
          </div>
        ))}
      </div>
    </div>
  )
}
```

### Search Component
```tsx
import ProductSearch from '@/components/ProductSearch'

export default function Header() {
  return (
    <ProductSearch 
      maxResults={10}
      showVariants={true}
      onSelect={(product) => {
        console.log('Selected:', product)
        // Navigate or add to cart
      }}
    />
  )
}
```

### Imperative Search
```tsx
import { searchProducts } from '@/hooks/useProductSearch'

const results = await searchProducts('burette 25', {
  limit: 20,
  category: 'Burettes'
})
```

### API POST Request
```tsx
const response = await fetch('/api/search/products', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: '1/4',
    limit: 50,
    category: 'Burettes',
  })
})

const { results } = await response.json()
```

## Options

### useProductSearch() Options
```tsx
interface Options {
  debounceMs?: number      // Debounce delay (default: 300ms)
  minChars?: number        // Min characters to trigger search (default: 1)
  limit?: number           // Max results (default: 20)
  category?: string        // Filter by category (default: null)
}
```

### searchProducts() Options
```tsx
interface Options {
  limit?: number           // Max results (default: 20)
  category?: string        // Filter by category (default: null)
}
```

## Search Result Structure
```typescript
interface SearchResult {
  id: string                                               // Product variant ID
  sku: string                                              // Product SKU
  name: string                                             // Product name
  matchType: 'exact_sku' | 'partial_sku' | 'name' | 'specs' | 'semantic'
  relevance: number                                        // 0-100
  fullProduct: {
    id: string
    sku: string
    name: string
    category: string
    specsText?: string
    price?: number
    priceLabel?: string
    images?: string[]
    inStock?: boolean
    variants?: Array<...>
    // ... other fields
  }
}
```

## Environment Variables
None required for hybrid search (local-only).

**Optional for LLM-powered ranking:**
```env
ANTHROPIC_API_KEY=sk-ant-...   # For Claude-powered ranking (future enhancement)
```

## Search Examples

### Exact SKU
- Query: `"1/4"` → Returns SKU "1/4" first (relevance: 100)
- Fallback: Returns "1/1", "1/2", etc. (relevance: 90)

### Partial SKU
- Query: `"1/"` → Returns all "1/x" variants
- Query: `"1/4"` → Includes all products with "1/4" in SKU

### Product Name
- Query: `"burette"` → All burette products sorted by word match ratio
- Query: `"automatic burette"` → Products with both terms prioritized

### Specifications
- Query: `"25 mL"` → Matches specs containing "25 mL"
- Query: `"580mm"` → Matches height/dimension specs

### Semantic
- Query: `"glass burette"` → Understands "burette" + "glass key"
- Query: `"automatic pipette"` → Matches automatic burettes/pipettes

## Performance Tips

1. **Debounce Settings**
   ```tsx
   debounceMs: 300   // For real-time search UI
   debounceMs: 500   // For slower connections
   debounceMs: 100   // For server-side debouncing
   ```

2. **Limit Results**
   - UI dropdown: `limit: 10-15`
   - Search page: `limit: 50-100`
   - API calls: `limit: 20-50`

3. **Category Filtering**
   - Reduces search space by ~80%
   - Use on category pages

## Customization

### Add Custom Semantic Aliases
In `/src/app/api/search/products/route.ts`:

```typescript
const semanticAliases: Record<string, string[]> = {
  burette: ['burette', 'burettes', 'buret', 'burets', 'pipette burette'],
  // Add your aliases here
  myterm: ['term1', 'term2', 'synonym'],
}
```

### Adjust Match Relevance Scores
```typescript
// In hybridSearch function
matches.push({
  id: p.id,
  sku: p.sku,
  name: p.name,
  matchType: 'name',
  relevance: Math.round(wordRatio * 85), // ← Adjust multiplier
})
```

### Change Minimum Match Threshold
```typescript
// Only include name matches if 50% of words match
if (wordRatio >= 0.5) { // ← Change threshold
  matches.push(...)
}
```

## Future Enhancements

1. **LLM-Powered Ranking** - Use Claude API for intelligent re-ranking
2. **Fuzzy Matching** - Levenshtein distance for typo tolerance
3. **Popular Searches** - Track and suggest trending queries
4. **Search Analytics** - Log searches for insights
5. **Auto-Complete** - Suggest product names/SKUs while typing
6. **Filters** - Price range, stock status, category, etc.
7. **Sort Options** - Relevance, price, newest, most popular

## Troubleshooting

### No results for valid SKU
- Check SKU format (case-sensitive by default)
- Verify product exists in JSON file
- Variants must be properly formatted

### Results too broad
- Increase `minChars` (default: 1)
- Decrease `limit`
- Use category filtering

### Slow searches
- Increase `debounceMs`
- Reduce `limit`
- Filter by category

### Missing products
- Ensure product JSON is properly formatted
- Variants need `id`, `sku`, `name` fields
- Check for duplicate SKUs

## API Documentation

### GET /api/search/products
```
GET /api/search/products?q=1/4&limit=20

Response:
{
  "success": true,
  "query": "1/4",
  "count": 5,
  "results": [
    {
      "id": "1/4",
      "sku": "1/4",
      "name": "Burettes, Straight Bore... - 1/4",
      "matchType": "exact_sku",
      "relevance": 100,
      "fullProduct": { ... }
    }
  ]
}
```

### POST /api/search/products
```
POST /api/search/products
Content-Type: application/json

{
  "query": "burette 25",
  "limit": 50,
  "category": "Burettes"
}

Response: Same as GET
```

## License & Attribution
Part of Omsons Labs MiriSoft Order Management System
