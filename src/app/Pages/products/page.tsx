'use client'

import { Suspense, useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'
import { Pencil, Trash2, Download, Search, Package, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'

type ProductData = {
  product_id: string
  product_name: string
  product_image: string
  product_price: string
  product_discription: string
  product_unit: string
  product_quantity: string
  product_cat: string
}

type ProductResponse = {
  data: ProductData[]
  count: number
  last_page: number
}

const BACKEND_URL    = "https://mirisoft.co.in/sas/dealerapi/api"
const ITEMS_PER_PAGE = 10

function normalizeCategory(value: unknown): string {
  return String(value ?? "").trim().toLowerCase()
}

function productMatchesCategory(product: ProductData, selectedCategory: string): boolean {
  if (selectedCategory === "all") return true

  const target = normalizeCategory(selectedCategory)
  const productValues = [
    product.product_cat,
    product.product_name,
    product.product_discription,
    product.product_unit,
  ]
    .map(normalizeCategory)
    .filter(Boolean)

  return productValues.some((value) =>
    value === target ||
    value.includes(target) ||
    target.includes(value)
  )
}

function ProductListContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlQuery = searchParams.get("q") ?? ""
  const urlCategory = searchParams.get("cat") ?? "all"

  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState("")
  const [searchInput,   setSearchInput]   = useState("")
  const [selectedCategory, setSelectedCategory] = useState(urlCategory)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [toastMsg,      setToastMsg]      = useState<{ text: string; ok: boolean } | null>(null)

  const queryClient = useQueryClient()

  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3200)
    return () => clearTimeout(t)
  }, [toastMsg])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchInput(urlQuery)
      setSearch(urlQuery)
      setPage(1)
      setSelectedCategory(urlCategory)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [urlQuery, urlCategory])

  const { data: response, isLoading, isError, refetch } = useQuery<ProductResponse>({
    queryKey: ['products', page, search, selectedCategory],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), search })
      if (selectedCategory !== "all") {
        params.set("cat", selectedCategory)
      }
      const res = await axios.get(`${BACKEND_URL}/pegination?${params.toString()}`)
      return res.data
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const data: ProductData[] = useMemo(() => response?.data ?? [], [response?.data])
  const filteredData = useMemo(
    () => data.filter((product) => productMatchesCategory(product, selectedCategory)),
    [data, selectedCategory]
  )
  const total      = response?.count ?? 0
  const totalPages = response?.last_page || Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))

  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ['products', page + 1, search, selectedCategory],
      queryFn: async () => {
        const params = new URLSearchParams({ page: String(page + 1), search })
        if (selectedCategory !== "all") {
          params.set("cat", selectedCategory)
        }
        const res = await axios.get(`${BACKEND_URL}/pegination?${params.toString()}`)
        return res.data
      },
    })
  }, [page, search, selectedCategory, queryClient])

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setSearch(searchInput) }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const handleDelete = async (id: string) => {
    try {
      const fd = new FormData()
      fd.append("id", id)
      fd.append("tbl", "product_tbl")
      fd.append("field", "product_id")
      const res = await axios.post(`${BACKEND_URL}/delete`, fd)
      setToastMsg({ text: res.data.msg || "Deleted successfully", ok: true })
      refetch()
    } catch {
      setToastMsg({ text: "Failed to delete product", ok: false })
    } finally {
      setDeleteConfirm(null)
    }
  }

  const handleDownloadExcel = () => {
    if (!filteredData.length) return
    const headers = ["S.No.", "Catalogue No.", "Product Name", "Price", "Quantity", "Unit"]
    const rows = filteredData.map((p, i) => [
      (page - 1) * ITEMS_PER_PAGE + i + 1,
      p.product_cat, p.product_name, p.product_price, p.product_quantity, p.product_unit,
    ])
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n")
    const a   = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: "products.csv",
    })
    a.click()
  }

  function pageNumbers(): (number | "…")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages: (number | "…")[] = [1]
    if (page > 3)              pages.push("…")
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push("…")
    pages.push(totalPages)
    return pages
  }

  const handlePageChange = (p: number) => {
    if (p < 1 || p > totalPages) return
    setPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startIndex = (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex   = Math.min(page * ITEMS_PER_PAGE, total)

  return (
    <div className="min-h-screen bg-[#f4f5f9] text-[#111827]" style={{ fontFamily: "'Outfit', sans-serif" }}>

      {/* ── Toast ── */}
      {toastMsg && (
        <div className={`fixed bottom-6 right-6 z-[100] flex items-center gap-2 px-[18px] py-3 rounded-xl text-[13px] font-medium shadow-[0_6px_24px_rgba(0,0,0,0.14)] animate-[toastIn_0.22s_ease] ${
          toastMsg.ok
            ? "bg-[#ecfdf5] text-[#065f46] border border-[#a7f3d0]"
            : "bg-[#fff1f2] text-[#be123c] border border-[#fecdd3]"
        }`}
          style={{ animation: "toastIn 0.22s ease" }}
        >
          <style>{`@keyframes toastIn{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
          {toastMsg.ok
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
          }
          {toastMsg.text}
        </div>
      )}

      {/* ── Delete modal ── */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[4px]"
          style={{ animation: "fadeIn 0.18s ease" }}
          onClick={() => setDeleteConfirm(null)}
        >
          <style>{`
            @keyframes fadeIn{from{opacity:0}to{opacity:1}}
            @keyframes popIn{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}
          `}</style>
          <div
            className="bg-white rounded-[18px] shadow-[0_24px_60px_rgba(0,0,0,0.18)] p-7 w-[360px] border border-[#f1f5f9]"
            style={{ animation: "popIn 0.2s ease" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-11 h-11 rounded-xl bg-[#fff1f2] flex items-center justify-center mb-4">
              <AlertTriangle size={20} color="#ef4444" />
            </div>
            <div className="text-[16px] font-bold text-[#0f172a] mb-2">Delete Product</div>
            <div className="text-[13px] text-[#64748b] leading-relaxed mb-[22px]">
              Are you sure you want to permanently delete this product?
              This action cannot be undone and will remove all associated data.
            </div>
            <div className="flex gap-2.5 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-[18px] py-[9px] rounded-[9px] border-[1.5px] border-[#e2e8f0] bg-white text-[13px] font-medium text-[#374151] cursor-pointer transition-all hover:bg-[#f8fafc] hover:border-[#cbd5e1]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-[18px] py-[9px] rounded-[9px] border-none bg-[#ef4444] text-[13px] font-semibold text-white cursor-pointer transition-colors hover:bg-[#dc2626]"
              >
                Delete Product
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Topbar ── */}
      <div className="bg-white text-black px-8 h-16 flex items-center justify-between gap-4 sticky top-0 z-20 shadow-[0_2px_16px_rgba(0,0,0,0.08)] border-b border-[#e5e7eb]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] text-[12.5px] font-medium text-[#374151] cursor-pointer transition-all hover:bg-[#f1f5f9] hover:-translate-x-px"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            Back
          </button>
          <div className="w-px h-6 bg-[#e2e8f0]" />
          <div>
            <div className="text-[15px] font-semibold text-[#0f172a]">Product Catalogue</div>
            {!isLoading && total > 0 && (
              <div className="text-[11.5px] text-[#64748b] mt-px">{total.toLocaleString()} products</div>
            )}
          </div>
        </div>
        <button
          onClick={handleDownloadExcel}
          disabled={!filteredData.length}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[9px] border border-[#e2e8f0] bg-[#f8fafc] text-[12.5px] font-medium text-[#374151] cursor-pointer transition-all whitespace-nowrap hover:bg-[#eff6ff] hover:border-[#bfdbfe] hover:text-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      <div className="px-8 py-7 max-w-[1440px] mx-auto">

        {/* ── Page header ── */}
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="text-[28px] font-bold tracking-tight text-[#0f172a]">Products</div>
            <div className="text-[13px] text-[#64748b] mt-1">Browse and manage your product catalogue</div>
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] pointer-events-none" />
            <input
              type="text"
              placeholder="Search by catalogue number or name…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-[38px] pr-[14px] py-[9px] border-[1.5px] border-[#e2e8f0] rounded-[10px] text-[13px] bg-white text-[#0f172a] w-[300px] outline-none transition-all placeholder:text-[#94a3b8] focus:border-[#3b5bdb] focus:shadow-[0_0_0_3px_rgba(59,91,219,0.1)]"
              style={{ fontFamily: "inherit" }}
            />
          </div>
        </div>

        {/* ── Stats row ── */}
        {!isLoading && (
          <div className="flex gap-3 mb-[22px] flex-wrap">
            {[
              { dot: "#3b5bdb", label: "Total Products", value: total.toLocaleString() },
              { dot: "#10b981", label: "This Page",      value: filteredData.length },
              { dot: "#f59e0b", label: "Page",           value: `${page} / ${totalPages}` },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2 px-4 py-[9px] bg-white border border-[#e8edf5] rounded-[10px] text-[12.5px] text-[#374151] font-medium shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.dot }} />
                {s.label}
                <span className="font-semibold text-[13px] text-[#0f172a]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Error ── */}
        {isError && (
          <div className="flex items-center gap-2 mb-4 px-4 py-3 bg-[#fff5f5] border border-[#fecaca] rounded-[10px] text-[13px] text-[#dc2626]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
            Failed to load products. Please try again.
          </div>
        )}

        {/* ── Table card ── */}
        <div className="bg-white border border-[#e8edf5] rounded-[18px] overflow-hidden shadow-[0_2px_16px_rgba(0,0,0,0.05)]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-[#f8faff] border-b-[1.5px] border-[#e8edf5]">
                <tr>
                  {["#", "Catalogue No.", "Product", "Price", "Qty", "Unit", "Actions"].map(h => (
                    <th
                      key={h}
                      className="px-4 py-[13px] text-left text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#64748b] whitespace-nowrap first:pl-[22px] last:pr-[22px]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>

                {/* Shimmer rows */}
                {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i} className="border-b border-[#f1f5fb]">
                    {[40, 80, 180, 70, 50, 60, 100].map((w, j) => (
                      <td key={j} className="px-4 py-[14px] first:pl-[22px] last:pr-[22px]">
                        <div
                          className="h-[14px] rounded-[6px]"
                          style={{
                            width: w,
                            background: "linear-gradient(90deg,#f1f5fb 25%,#e8edf5 50%,#f1f5fb 75%)",
                            backgroundSize: "200% 100%",
                            animation: "sh 1.5s infinite",
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                <style>{`@keyframes sh{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

                {/* Empty state */}
                {!isLoading && filteredData.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-[60px] text-center">
                      <Package size={36} className="mx-auto mb-3 text-[#cbd5e1]" />
                      <div className="text-[13.5px] text-[#94a3b8] font-medium">No products found</div>
                      <div className="text-[12px] text-[#cbd5e1] mt-1">
                        {search ? `No results for "${search}"` : "Your catalogue is empty"}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Data rows */}
                {!isLoading && filteredData.map((product, i) => (
                  <tr key={product.product_id} className="border-b border-[#f1f5fb] last:border-b-0 transition-colors hover:bg-[#f8faff]">

                    <td className="pl-[22px] pr-4 py-[14px]">
                      <span className="text-[11px] text-[#94a3b8]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        {startIndex + i}
                      </span>
                    </td>

                    <td className="px-4 py-[14px]">
                      <span className="text-[11px] font-medium bg-[#f1f5fb] text-[#334155] px-[9px] py-[3px] rounded-[6px] border border-[#e2e8f0] whitespace-nowrap" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        {product.product_cat || "—"}
                      </span>
                    </td>

                    <td className="px-4 py-[14px]">
                      <div className="text-[13px] font-semibold text-[#0f172a]">{product.product_name || "—"}</div>
                      {product.product_discription && (
                        <div className="text-[11px] text-[#94a3b8] mt-0.5 truncate max-w-[220px]">{product.product_discription}</div>
                      )}
                    </td>

                    <td className="px-4 py-[14px]">
                      <span className="text-[12px] font-bold text-[#065f46] bg-[#ecfdf5] border border-[#a7f3d0] px-[10px] py-1 rounded-full whitespace-nowrap" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        ₹{Number(product.product_price || 0).toLocaleString("en-IN")}
                      </span>
                    </td>

                    <td className="px-4 py-[14px]">
                      <span className="text-[12px] font-semibold text-[#374151]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                        {product.product_quantity
                          ? `${product.product_quantity} pcs`
                          : "—"}
                      </span>
                    </td>

                    <td className="px-4 py-[14px]">
                      <span className="text-[11px] font-semibold bg-[#eff6ff] text-[#1d4ed8] border border-[#bfdbfe] px-[9px] py-[3px] rounded-full whitespace-nowrap">
                        {product.product_unit || "—"}
                      </span>
                    </td>

                    <td className="pr-[22px] pl-4 py-[14px]">
                      <div className="flex items-center gap-1.5">
                        <button className="inline-flex items-center gap-1 px-[11px] py-1.5 rounded-lg text-[12px] font-medium bg-[#f8faff] text-[#475569] border-[1.5px] border-[#e2e8f0] cursor-pointer transition-all hover:bg-[#eff6ff] hover:border-[#bfdbfe] hover:text-[#1d4ed8]">
                          <Pencil size={12} />
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(product.product_id)}
                          className="inline-flex items-center gap-1 px-[11px] py-1.5 rounded-lg text-[12px] font-medium bg-white text-[#64748b] border-[1.5px] border-[#e2e8f0] cursor-pointer transition-all hover:bg-[#fff1f2] hover:border-[#fecdd3] hover:text-[#be123c]"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    </td>

                  </tr>
                ))}

              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          <div className="flex items-center justify-between px-[22px] py-[14px] border-t border-[#f1f5fb] flex-wrap gap-3">
            <div className="text-[12px] text-[#94a3b8]">
              {filteredData.length > 0 ? (
                <>Showing <strong className="text-[#374151] font-semibold">{startIndex}–{Math.min(endIndex, filteredData.length)}</strong> of <strong className="text-[#374151] font-semibold">{filteredData.length.toLocaleString()}</strong> products</>
              ) : "No results"}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className="min-w-[34px] h-[34px] px-2 rounded-[9px] border-[1.5px] border-[#e2e8f0] bg-white text-[13px] font-medium text-[#374151] cursor-pointer inline-flex items-center justify-center gap-1 transition-all hover:bg-[#f8faff] hover:border-[#c7d2e8] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={14} /> Prev
              </button>

              {pageNumbers().map((p, idx) =>
                p === "…"
                  ? <span key={`e${idx}`} className="px-1 text-[#94a3b8] text-[14px]">…</span>
                  : <button
                      key={p}
                      onClick={() => handlePageChange(p as number)}
                      className={`min-w-[34px] h-[34px] px-2 rounded-[9px] border-[1.5px] text-[13px] font-medium inline-flex items-center justify-center transition-all cursor-pointer ${
                        p === page
                          ? "bg-[#1e3a8a] border-[#1e3a8a] text-white font-bold"
                          : "bg-white border-[#e2e8f0] text-[#374151] hover:bg-[#f8faff] hover:border-[#c7d2e8]"
                      }`}
                    >
                      {p}
                    </button>
              )}

              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages}
                className="min-w-[34px] h-[34px] px-2 rounded-[9px] border-[1.5px] border-[#e2e8f0] bg-white text-[13px] font-medium text-[#374151] cursor-pointer inline-flex items-center justify-center gap-1 transition-all hover:bg-[#f8faff] hover:border-[#c7d2e8] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

export default function ProductListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f4f5f9]" />}>
      <ProductListContent />
    </Suspense>
  )
}
