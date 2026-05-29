'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import axios from 'axios'
import { Download, Search, Package } from 'lucide-react'
import { hasPriorityTag } from '@/lib/orderPriority'

type OrderItem = {
  orderdata_id: string
  orderdata_cat_no: string
  order_item_description: string
  orderdata_capacity: string
  orderdata_item_quantity: string
  orderdata_item_unit: string
  orderdata_price: string
  orderdata_discount: string
  orderdata_afterDisPrice: string
  orderdata_totalprice: string
  remark: string
  remarks?: string
  priority?: string | boolean
  isPriority?: string | boolean
  is_priority?: string | boolean
  orderdata_status: string
  orderdata_datetime: string
  orderdata_orderid: string
  orderdata_dealerid: string
}

type OrderResponse = {
  data: OrderItem[]
  count: number
  last_page: number
}

type UserData = {
  Dealer_Id: string
}

const SHIMMER = "animate-pulse bg-gray-200 rounded"
const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api"
const ITEMS_PER_PAGE = 10

function statusBadge(status: string) {
  switch (status) {
    case "0": return { bg: "bg-red-50",     text: "text-red-600",     label: "In Process" }
    case "1": return { bg: "bg-blue-50",    text: "text-blue-600",    label: "Packing" }
    case "2": return { bg: "bg-indigo-50",  text: "text-indigo-600",  label: "Dispatched" }
    case "3": return { bg: "bg-amber-50",   text: "text-amber-700",   label: "Not in Stock" }
    case "4": return { bg: "bg-emerald-50", text: "text-emerald-700", label: "Successful" }
    default:  return { bg: "bg-gray-100",   text: "text-gray-500",    label: "Unknown" }
  }
}

export default function DispatchStatusPage() {
  const [user, setUser] = useState<UserData | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")

  const queryClient = useQueryClient()

  // Load user from localStorage on client only
  useEffect(() => {
    const stored = localStorage.getItem("UserData")
    if (stored) setUser(JSON.parse(stored))
  }, [])

  const { data: response, isLoading, isError } = useQuery<OrderResponse>({
    queryKey: ['dispatchstatus', page, search, user?.Dealer_Id],
    queryFn: async () => {
      const res = await axios.get(
        `${BACKEND_URL}/Orderstspegination?page=${page}&search=${search}&id=${user?.Dealer_Id}`
      )
      return res.data
    },
    enabled: !!user?.Dealer_Id,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const data: OrderItem[] = response?.data || []
  const total = response?.count ?? 0
  const totalPages =
    response?.last_page ||
    Math.ceil(total / ITEMS_PER_PAGE) ||
    (data.length < ITEMS_PER_PAGE ? page : page + 1)

  // Prefetch next page
  useEffect(() => {
    if (!user?.Dealer_Id) return
    queryClient.prefetchQuery({
      queryKey: ['dispatchstatus', page + 1, search, user.Dealer_Id],
      queryFn: async () => {
        const res = await axios.get(
          `${BACKEND_URL}/Orderstspegination?page=${page + 1}&search=${search}&id=${user.Dealer_Id}`
        )
        return res.data
      },
    })
  }, [page, search, user])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      setSearch(searchInput)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  function pageNumbers(): (number | "…")[] {
    const pages: (number | "…")[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push("…")
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
      if (page < totalPages - 2) pages.push("…")
      pages.push(totalPages)
    }
    return pages
  }

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return
    setPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDownloadCSV = () => {
    if (!data.length) return
    const headers = [
      "S.No.", "Order ID", "Cat. No.", "Description", "Quantity",
      "Priority", "Price", "Discount", "After Discount", "Total Price", "Remark", "Status", "Date/Time"
    ]
    const rows = data.map((o, i) => [
      (page - 1) * ITEMS_PER_PAGE + i + 1,
      o.orderdata_id,
      o.orderdata_cat_no,
      o.order_item_description,
      o.orderdata_item_quantity,
      hasPriorityTag(o.priority, o.isPriority, o.is_priority, o.remark, o.remarks) ? "Priority" : "",
      o.orderdata_price,
      o.orderdata_discount,
      o.orderdata_afterDisPrice,
      o.orderdata_totalprice,
      o.remark,
      statusBadge(o.orderdata_status).label,
      o.orderdata_datetime,
    ])
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "dispatch-status.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const startIndex = (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex = Math.min(page * ITEMS_PER_PAGE, total)

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="p-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Order Status</h1>
              <p className="text-sm text-gray-500 mt-1">Track dispatch status of your order items</p>
            </div>
            <button
              onClick={handleDownloadCSV}
              disabled={!data.length}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
            >
              <Download className="w-4 h-4" />
              Export CSV ji
            </button>
          </div>

          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by catalogue number…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-10 pr-4 py-2 px-8 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition w-full"
            />
          </div>
        </div>

        {isError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            Failed to load order data. Please try again.
          </div>
        )}

        {/* Table Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">S.No.</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Order ID</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Cat. No.</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Description</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Qty</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Priority</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Price</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Discount</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">After Disc.</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Total</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Remark</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Date/Time</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {/* Shimmer */}
                {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 13 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className={`${SHIMMER} h-4 w-full`} />
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Empty */}
                {!isLoading && data.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <Package className="w-8 h-8" />
                        <span className="text-sm">No order items found</span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Rows */}
                {!isLoading && data.map((item, i) => {
                  const badge = statusBadge(item.orderdata_status)
                  const isPriority = hasPriorityTag(item.priority, item.isPriority, item.is_priority, item.remark, item.remarks)
                  return (
                    <tr key={item.orderdata_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 text-gray-400 text-xs">{startIndex + i}</td>

                      <td className="px-4 py-4">
                        <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                          #{item.orderdata_id}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                          {item.orderdata_cat_no || "—"}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-gray-700 text-xs max-w-[180px] truncate">
                        {item.order_item_description || "—"}
                      </td>

                      <td className="px-4 py-4 text-gray-600 text-xs text-center">
                        {item.orderdata_item_quantity || "—"}
                      </td>

                      <td className="px-4 py-4">
                        {isPriority ? (
                          <span className="bg-red-50 text-red-700 border border-red-200 text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap">
                            Priority
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>

                      <td className="px-4 py-4 text-gray-600 text-xs">
                        ₹{item.orderdata_price || "0"}
                      </td>

                      <td className="px-4 py-4 text-gray-600 text-xs">
                        ₹{item.orderdata_discount || "0"}
                      </td>

                      <td className="px-4 py-4 text-gray-600 text-xs">
                        ₹{item.orderdata_afterDisPrice || "0"}
                      </td>

                      <td className="px-4 py-4">
                        <span className="bg-emerald-50 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
                          ₹{item.orderdata_totalprice || "0"}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-gray-500 text-xs">
                        {item.remark || "—"}
                      </td>

                      <td className="px-4 py-4">
                        <span className={`${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap`}>
                          {badge.label}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-gray-400 text-xs whitespace-nowrap">
                        {item.orderdata_datetime?.slice(0, 16) || "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              {data.length > 0 ? `Showing ${startIndex}–${endIndex} of ${total}` : "No results"}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                ← Prev
              </button>

              {pageNumbers().map((p, idx) =>
                p === "…" ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 text-sm">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                      p === page
                        ? "bg-indigo-600 text-white border-indigo-600 font-medium"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}

              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Next →
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
