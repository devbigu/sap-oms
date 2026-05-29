# Quick Integration Guide

## Add Search to Your Header Component

### Step 1: Import ProductSearch
```tsx
import ProductSearch from '@/components/ProductSearch'
```

### Step 2: Add to Header
```tsx
export default function Header() {
  const router = useRouter()
  
  return (
    <header className="bg-white border-b">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-6">
        {/* Logo */}
        <h1>Logo</h1>
        
        {/* Search */}
        <div className="flex-1 max-w-lg">
          <ProductSearch
            maxResults={10}
            onSelect={(product) => {
              router.push(`/Products/${product.id}`)
            }}
          />
        </div>
        
        {/* Navigation */}
        <nav>...</nav>
      </div>
    </header>
  )
}
```

## Add Advanced Search Page

The search results page is already available at `/search?q=query`

```tsx
// This already exists:
<Link href={`/search?q=${encodeURIComponent(query)}`}>
  View all results →
</Link>
```

## Category Page Search

Add search filtered by category:

```tsx
import ProductSearch from '@/components/ProductSearch'

export default function CategoryPage({ params }) {
  return (
    <div>
      <h1>Burettes</h1>
      
      {/* Search limited to this category */}
      <div className="mb-8">
        <ProductSearch
          category="Burettes"
          maxResults={15}
        />
      </div>
      
      {/* Rest of page */}
    </div>
  )
}
```

## Use Search Hook Directly

For more control, use the hook:

```tsx
'use client'

import { useProductSearch } from '@/hooks/useProductSearch'

export default function CustomSearch() {
  const { results, isLoading, query, debouncedSearch } = useProductSearch({
    debounceMs: 500,
    minChars: 2,
    limit: 50,
  })

  return (
    <>
      <input
        type="text"
        placeholder="Search..."
        onChange={(e) => debouncedSearch(e.target.value)}
      />
      
      {isLoading && <div>Loading...</div>}
      
      <ul>
        {results.map((r) => (
          <li key={r.id}>
            {r.sku} - {r.name} ({r.matchType}, {r.relevance}%)
          </li>
        ))}
      </ul>
    </>
  )
}
```

## Search by Function

Direct function call without React hook:

```tsx
import { searchProducts } from '@/hooks/useProductSearch'

// In event handler
const handleSearch = async (query: string) => {
  const results = await searchProducts(query, {
    limit: 50,
    category: 'Burettes',
  })
  
  console.log(`Found ${results.length} products`)
  results.forEach(r => {
    console.log(`${r.sku}: ${r.name} (${r.matchType} match)`)
  })
}
```

## Search Behavior Examples

### Example 1: Exact SKU Search
```
User types: "1/4"
Results:
  1. "1/4" (exact_sku, 100% relevance) ← Highest priority
  2. "1/4" variant products
```

### Example 2: Partial SKU Search
```
User types: "1/"
Results:
  1. "1/1" (partial_sku, 90%)
  2. "1/2" (partial_sku, 90%)
  3. "1/3" (partial_sku, 90%)
  ... all variants starting with "1/"
```

### Example 3: Product Name Search
```
User types: "burette glass"
Results:
  1. Products with "burette" AND "glass" in name
  2. Products with "burette" OR "glass" in name
  3. Partial matches
```

### Example 4: Spec Search
```
User types: "25 ml"
Results:
  1. Products with "25" and "mL" in specs
  2. Products with capacity 25mL
```

### Example 5: Semantic Search
```
User types: "glass burette"
Results:
  1. "Burettes, Straight Bore, with Glass Key" ← Understands intent
  2. Other burette products
```

## Configuration Tips

### For Mobile/Responsive
```tsx
<ProductSearch
  maxResults={6}        // Fewer results on mobile
  showVariants={false}  // Hide variants on mobile
/>
```

### For High-Performance
```tsx
<ProductSearch
  maxResults={20}       // More results
  debounceMs: 500       // Slower debounce to reduce API calls
/>
```

### For Auto-Complete Style
```tsx
<ProductSearch
  maxResults={8}
  debounceMs: 200       // Fast debounce for responsive feel
/>
```

## Troubleshooting Integration

### Search not appearing
- Check import path is correct
- Ensure ProductSearch component rendered
- Check z-index if dropdown hidden behind other elements

### Results not showing
- Check browser console for errors
- Verify API route exists at `/api/search/products`
- Check product JSON file format

### Performance issues
- Increase `debounceMs`
- Reduce `maxResults`
- Add category filter

### Styling conflicts
- ProductSearch uses Tailwind CSS
- Adjust `w-full` or `max-w-` classes as needed
- Override with custom className if needed

## Example: Full Header Integration

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ProductSearch from '@/components/ProductSearch'
import Link from 'next/link'
import { ShoppingCart, Menu } from 'lucide-react'

export default function Header() {
  const router = useRouter()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between gap-4 lg:gap-8">
          
          {/* Logo */}
          <Link href="/" className="flex-shrink-0">
            <div className="text-xl font-bold text-indigo-600">
              Omsons Labs
            </div>
          </Link>

          {/* Search - Hidden on mobile, shown on desktop */}
          <div className="hidden lg:block flex-1 max-w-lg">
            <ProductSearch
              maxResults={10}
              onSelect={(product) => {
                router.push(`/Products/${product.id}`)
              }}
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            <Link
              href="/search"
              className="hidden sm:inline-block px-3 py-2 text-sm text-gray-700 hover:text-gray-900"
            >
              Search
            </Link>
            <Link
              href="/Pages/Cart"
              className="p-2 text-gray-700 hover:text-gray-900"
            >
              <ShoppingCart className="w-5 h-5" />
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-gray-700"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mobile Search */}
        {mobileMenuOpen && (
          <div className="mt-4 lg:hidden">
            <ProductSearch
              maxResults={6}
              onSelect={(product) => {
                router.push(`/Products/${product.id}`)
                setMobileMenuOpen(false)
              }}
            />
          </div>
        )}
      </div>
    </header>
  )
}
```

## Next Steps

1. ✅ Copy ProductSearch component to your header
2. ✅ Test basic search functionality
3. ✅ Style to match your design
4. ✅ Add advanced search page link
5. ✅ Monitor search analytics (future enhancement)
6. ✅ Gather user feedback on search accuracy

Enjoy! 🎉
