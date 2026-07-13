"use client"

import React, { useState, useEffect, useRef } from 'react'
import { GoLocation } from "react-icons/go"
import { IoCartOutline } from "react-icons/io5"
import { FaMagnifyingGlass } from "react-icons/fa6"
import { categories } from '@/Assets/dataset'
import AccountList from "@/components/AccountList"
import Cart from "@/components/Cart"
import Link from 'next/link'
import { useCartStore } from "@/Store/store"
import { useRouter } from 'next/navigation'

// ─────────────────────────────────────────────────────────────
// TYPES  (matches nested_omsons_products.json schema)
// ─────────────────────────────────────────────────────────────
type Variant = {
  id: string
  sku: string
  name: string
  specsText?: string
  specs?: Record<string, string>
  images?: string[]
}

type Product = {
  id: string
  sku: string
  slug: string
  name: string
  category: string
  categories?: string[]
  features?: string[]
  descriptionHtml?: string
  images?: string[]
  variants?: Variant[]
  /** Pre-computed search index — built once on load */
  _searchIndex?: string
}

export type RecentlyViewedItem = {
  SKU: string
  Name: string
  image?: string
  viewedAt: number   // unix ms — used to sort & deduplicate
}

// ─────────────────────────────────────────────────────────────
// RECENTLY VIEWED STORAGE HELPERS (exported so page.tsx can use them)
// ─────────────────────────────────────────────────────────────
const RV_KEY = "recentlyViewed"
const RV_MAX = 12   // keep last 12

export function getRecentlyViewed(): RecentlyViewedItem[] {
  try {
    return JSON.parse(localStorage.getItem(RV_KEY) ?? "[]")
  } catch {
    return []
  }
}

export function pushRecentlyViewed(item: Omit<RecentlyViewedItem, "viewedAt">) {
  try {
    const existing = getRecentlyViewed().filter(p => p.SKU !== item.SKU)
    const updated: RecentlyViewedItem[] = [
      { ...item, viewedAt: Date.now() },
      ...existing,
    ].slice(0, RV_MAX)
    localStorage.setItem(RV_KEY, JSON.stringify(updated))
    // Dispatch custom event so page.tsx can react without a full reload
    window.dispatchEvent(new Event("recentlyViewedUpdated"))
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────
// CATEGORY FILTER STORAGE (read by /Products page)
// ─────────────────────────────────────────────────────────────
const CAT_KEY = "selectedCategoryFilter"

export function storeCategoryFilter(value: string) {
  try {
    if (value === "all") {
      localStorage.removeItem(CAT_KEY)
    } else {
      localStorage.setItem(CAT_KEY, value)
    }
  } catch { /* ignore */ }
}

export function UserName() {
  const [value, setValue] = useState(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("UserData")
      if (!raw) return
      const data = JSON.parse(raw)
      setValue(data?.Dealer_Name ?? data?.city ?? data?.District ?? data?.district ?? null)
    } catch { /* ignore */ }
  }, [])
  return <span className="font-bold uppercase">{value}</span>;
}

// ─────────────────────────────────────────────────────────────
// LOCATION HOOK
// ─────────────────────────────────────────────────────────────
function useLocationFromStorage() {
  const [city, setCity] = useState<string | null>(null)
  const [pincode, setPincode] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem("UserData")
      if (!raw) return
      const data = JSON.parse(raw)
      setCity(data?.Dealer_Address ?? data?.city ?? data?.District ?? data?.district ?? null)
      setPincode(data?.Pincode ?? data?.pincode ?? data?.Pin ?? data?.pin ?? null)
    } catch { /* ignore */ }
  }, [])

  return { city, pincode }
}

// ─────────────────────────────────────────────────────────────
// SCORE helper — ranks how well a product matches a query
// Searches: SKU → variant SKUs → name → category → deep index
// ─────────────────────────────────────────────────────────────
function scoreProduct(product: Product, q: string): number {
  const sku  = (product.sku ?? '').toLowerCase()
  const name = (product.name ?? '').toLowerCase()

  // Tier 1: SKU matches (highest priority)
  if (sku === q)             return 100  // exact SKU
  if (sku.startsWith(q))    return 90   // SKU prefix
  if (sku.includes(q))      return 80   // SKU substring

  // Tier 2: Check variant SKUs
  if (product.variants?.some(v => (v.sku ?? '').toLowerCase().includes(q))) return 75

  // Tier 3: Name matches
  if (name.startsWith(q))   return 70   // name prefix
  if (name.includes(q))     return 60   // name substring

  // Tier 4: Category match
  if ((product.category ?? '').toLowerCase().includes(q)) return 50

  // Tier 5: Deep search via pre-computed index
  // (features, specs, description, categories, variant specsText)
  if (product._searchIndex?.includes(q)) return 30

  return 0
}

// ─────────────────────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────────────────────
const Header = () => {
  const router = useRouter()
  const cart = useCartStore((s) => s.cart)
  const itemCount = cart.reduce((acc, item) => acc + item.quantity, 0)

  const [selectedCategory, setSelectedCategory] = useState("all")
  const [query, setQuery] = useState("")

  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [suggestions, setSuggestions] = useState<Product[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const logoImage =
    "https://omsonslabs.com/wp-content/uploads/elementor/thumbs/Logo-White-rjr8rdx3pqxz9p6ypfegb07hgtpvj3g22mnujlpa0w.png"

  const { city, pincode } = useLocationFromStorage()

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load products once & build search index ─────────────────
  useEffect(() => {
    fetch("/data/nested_omsons_products.json")
      .then(r => r.json())
      .then((raw: Product[]) => {
        const indexed = raw.map(p => {
          const parts: string[] = [
            p.name ?? '', p.sku ?? '', p.category ?? '',
            ...(p.categories || []),
            ...(p.features || []),
            // Strip HTML tags from description before indexing
            (p.descriptionHtml || '').replace(/<[^>]*>?/gm, ''),
            // Flatten all variant SKUs, names, and specsText
            ...(p.variants?.flatMap(v => [
              v.sku ?? '', v.name ?? '', v.specsText ?? ''
            ]) || [])
          ]
          return { ...p, _searchIndex: parts.join(' ').toLowerCase() }
        })
        setAllProducts(indexed)
      })
      .catch(console.error)
  }, [])

  // ── Filter & rank suggestions (debounced) ───────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const q = query.trim().toLowerCase()
    if (!q) { setSuggestions([]); setShowDropdown(false); return }

    debounceRef.current = setTimeout(() => {
      let pool = allProducts
      if (selectedCategory !== "all") {
        const lowerCat = selectedCategory.toLowerCase()
        pool = pool.filter(p =>
          (p.category ?? '').toLowerCase().includes(lowerCat) ||
          p.categories?.some(c => c.toLowerCase().includes(lowerCat))
        )
      }

      const matched = pool
        .map(p => ({ product: p, score: scoreProduct(p, q) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(({ product }) => product)

      setSuggestions(matched)
      setShowDropdown(matched.length > 0)
      setActiveIndex(-1)
    }, 300)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, selectedCategory, allProducts])

  // ── Close on outside click ──────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // ── Keyboard navigation ─────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) {
      if (e.key === "Enter") commitSearch()
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, -1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (activeIndex >= 0) {
        goToProduct(suggestions[activeIndex])
      } else {
        commitSearch()
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false); setActiveIndex(-1)
    }
  }

  // ── Navigate to product & store in recently viewed ──────────
  const goToProduct = (product: Product) => {
    setShowDropdown(false)
    setQuery(product.name)
    pushRecentlyViewed({ SKU: product.sku, Name: product.name, image: product.images?.[0] })
    router.push(`/Products/${product.sku}`)
  }

  // ── Full search → /Products?q= ──────────────────────────────
  const commitSearch = () => {
    const q = query.trim()
    if (!q) return
    setShowDropdown(false)
    router.push(`/Pages/products?q=${encodeURIComponent(q)}`)
  }

  // ── Category change → store filter + navigate ───────────────
  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value)
    storeCategoryFilter(value)
    if (value !== "all") {
      router.push(`/Products?category=${encodeURIComponent(value)}`)
    }
  }

  // ── Derived location ────────────────────────────────────────
  const locationTop = city || pincode ? "Delivering to" : "Delivering to you"
  const locationBottom = city ? city : pincode ? pincode : "Update location"

  return (
    <div>
      <div className="w-full h-16 bg-[#4040df] text-white flex items-center px-2 py-2 gap-2">

        {/* LOGO */}
        <div className="flex items-center border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer">
          <Link href="/home">
            <img src={logoImage} alt="Omsons Logo" className="h-12" />
          </Link>
        </div>

        {/* LOCATION */}
        <div className="flex items-start gap-1 border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer min-w-[120px]">
          <GoLocation className="text-xl mt-3 text-white" />
          <div className="flex flex-col">
            <span className="text-xs text-gray-300">{locationTop}</span>
            <span
              className="text-sm font-bold truncate max-w-[110px]"
              title={[city, pincode].filter(Boolean).join(", ")}
            >
              {locationBottom}
            </span>
            {city && pincode && (
              <span className="text-[10px] text-gray-400 font-normal leading-tight">{pincode}</span>
            )}
          </div>
        </div>

        {/* ── SEARCH BAR ─────────────────────────────────── */}
        <div ref={searchRef} className="flex flex-1 h-10 rounded-md overflow-visible relative">

          {/* Category selector */}
          <select
            className={`bg-[#f3f3f3] text-black text-sm px-2 border-r border-gray-300 rounded-l-md focus:ring-1 focus:ring-yellow-400 focus:border-yellow-400 ${selectedCategory === "all" ? "w-16" : "w-32"}`}
            value={selectedCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            suppressHydrationWarning
          >
            {categories.map((cat) => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>

          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            placeholder="Search products..."
            className="flex-1 px-3 text-black text-sm outline-none bg-white"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
            autoComplete="off"
            suppressHydrationWarning
          />

          {/* Search button */}
          <button
            onClick={commitSearch}
            className="bg-[#E5E7EB] hover:bg-[#bbbcbe] px-4 flex items-center justify-center rounded-r-md duration-300"
            suppressHydrationWarning
          >
            <FaMagnifyingGlass className="text-black font-bold" />
          </button>

          {/* ── SUGGESTIONS DROPDOWN ──────────────────────── */}
          {showDropdown && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
              background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6,
              boxShadow: "0 8px 32px rgba(0,0,0,0.14)", zIndex: 9999, overflow: "hidden",
            }}>
              {suggestions.map((product, idx) => (
                <div
                  key={product.sku}
                  onMouseDown={() => goToProduct(product)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", cursor: "pointer",
                    background: activeIndex === idx ? "#fef9ef" : "#fff",
                    borderBottom: idx < suggestions.length - 1 ? "1px solid #f1f5f9" : "none",
                    transition: "background .1s",
                  }}
                >
                  <FaMagnifyingGlass style={{ color: "#94a3b8", flexShrink: 0, fontSize: 12 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <HighlightMatch text={product.name} sku={product.sku} query={query} category={product.category} />
                  </div>
                  <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600, flexShrink: 0 }}>
                    View →
                  </span>
                </div>
              ))}
              <div
                onMouseDown={commitSearch}
                style={{
                  padding: "10px 14px", background: "#f8fafc",
                  borderTop: "1px solid #e2e8f0", cursor: "pointer",
                  fontSize: 13, color: "#1e3a5f", fontWeight: 600, textAlign: "center",
                }}
              >
                See all results for &ldquo;{query}&rdquo;
              </div>
            </div>
          )}
        </div>

        {/* LANG */}
        <div className="flex items-center gap-1 border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer">
          <span className="text-sm font-bold">EN</span>
        </div>

        {/* ACCOUNT */}
        <div className="flex flex-col border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer relative group">
          <div className="flex flex-col">
            <span className="text-xs text-gray-300 flex">Hello, <UserName /></span>
            <span className="text-sm font-bold">Account &amp; Lists</span>
          </div>
          <div className="absolute right-0 top-full mt-1 w-106 hidden group-hover:block z-60 bg-white shadow-lg border border-gray-200 rounded p-3 transition-all">
            <AccountList />
          </div>
        </div>

        {/* ORDERS */}
        <div className="flex flex-col border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer">
          <span className="text-xs text-gray-300">Returns</span>
          <Link href="/orders" className="text-sm font-bold">&amp; Orders</Link>
        </div>

        {/* CART */}
        <div className="flex items-center gap-1 border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer relative group">
          <Link href="/Pages/Cart" className="relative" suppressHydrationWarning>
            <IoCartOutline className="text-3xl text-white" />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#54499d] text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {itemCount}
              </span>
            )}
          </Link>
          <div className="absolute right-0 top-full mt-1 w-[440px] hidden group-hover:block z-[60] bg-white shadow-2xl border border-gray-200 rounded-xl text-black overflow-hidden">
            <Cart />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// HIGHLIGHT MATCH
// Highlights the matched portion in both name and SKU.
// SKU row is bold/dark when the query matched the SKU.
// Category badge shown for context.
// ─────────────────────────────────────────────────────────────
function HighlightMatch({ text, sku, query, category }: { text: string; sku: string; query: string; category?: string }) {
  const q = query.trim()

  const highlight = (str: string) => {
    if (!q) return <span>{str}</span>
    const idx = str.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) return <span>{str}</span>
    return (
      <span>
        {str.slice(0, idx)}
        <strong style={{ color: "#1e3a5f" }}>{str.slice(idx, idx + q.length)}</strong>
        {str.slice(idx + q.length)}
      </span>
    )
  }

  const skuMatched = q ? sku.toLowerCase().includes(q.toLowerCase()) : false

  return (
    <div style={{ overflow: "hidden" }}>
      {/* Product name row */}
      <div style={{
        fontSize: 13,
        color: "#0f172a",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
      }}>
        {highlight(text)}
      </div>
      {/* SKU + category row */}
      <div style={{
        fontSize: 11,
        marginTop: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}>
        <span style={{ color: skuMatched ? "#1e3a5f" : "#94a3b8" }}>SKU: </span>
        <span style={{
          color: skuMatched ? "#1e3a5f" : "#94a3b8",
          fontWeight: skuMatched ? 700 : 400,
        }}>
          {highlight(sku)}
        </span>
        {category && (
          <span style={{
            fontSize: 10,
            color: "#6366f1",
            background: "#eef2ff",
            padding: "1px 6px",
            borderRadius: 4,
            fontWeight: 500,
            flexShrink: 0,
          }}>
            {category}
          </span>
        )}
      </div>
    </div>
  )
}

export default Header
