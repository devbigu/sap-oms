'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import moment from 'moment'
import { ArrowLeft, FileSpreadsheet, Printer, RefreshCw, X } from 'lucide-react'

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api"
const YEAR        = new Date().getFullYear()
const PAGE_SIZE   = 20
const TODAY       = moment().startOf("day")

type DealerInfo = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_City: string
  Dealer_Email: string
  Dealer_Number: string
  Dealer_Dealercode: string
  gst: string
  creditdays: string
  currentlimit: string
  annualtarget: string
}

type RawOrder = {
  order_id: string
  order_date: string
  order_amount: string
  order_discount: string
  Dealer_Name: string
  orderdata_item_quantity: string
  mtstatus: string
  outstandingDate: string
  reason?: string
}

type PayStatus   = "Paid" | "Partial" | "Unpaid" | "Overdue"
type InvoiceType = "All" | "Tax Invoice" | "Bill of Supply"

function getPayStatus(o: RawOrder): PayStatus {
  const ms = Number(o.mtstatus ?? 0)
  if (ms >= 2) return "Paid"
  if (
    o.outstandingDate &&
    moment(o.outstandingDate, "YYYY-MM-DD", true).isValid() &&
    moment(o.outstandingDate).isBefore(TODAY)
  ) return "Overdue"
  if (ms === 1) return "Partial"
  return "Unpaid"
}

function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function avatarInitials(name?: string) {
  return name?.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?"
}

const STATUS_STYLE: Record<PayStatus, { wrap: string; dot: string }> = {
  Paid:    { wrap: "bg-emerald-50 border-emerald-200 text-emerald-700", dot: "bg-emerald-400" },
  Partial: { wrap: "bg-blue-50 border-blue-200 text-blue-700",         dot: "bg-blue-400"    },
  Unpaid:  { wrap: "bg-amber-50 border-amber-200 text-amber-700",      dot: "bg-amber-400"   },
  Overdue: { wrap: "bg-red-50 border-red-200 text-red-700",            dot: "bg-red-500"     },
}

function StatusBadge({ status }: { status: PayStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${s.wrap}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {status}
    </span>
  )
}

function pageNumbers(current: number, total: number): (number | "…")[] {
  const pages: (number | "…")[] = []
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current > 3) pages.push("…")
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
    if (current < total - 2) pages.push("…")
    pages.push(total)
  }
  return pages
}

export default function DealerLedgerPage() {
  const router   = useRouter()
  const params   = useParams()
  const dealerId = params.id as string

  const [dealer,  setDealer]  = useState<DealerInfo | null>(null)
  const [orders,  setOrders]  = useState<RawOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [page,    setPage]    = useState(1)

  const [filters, setFilters] = useState<{
    from: string; to: string
    invoiceType: InvoiceType
    payStatus: "All" | PayStatus
  }>({ from: "", to: "", invoiceType: "All", payStatus: "All" })

  // Fetch dealer info
  useEffect(() => {
    if (!dealerId) return
    fetch(`${BACKEND_URL}/getdealer?id=${dealerId}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "type" }),
    })
      .then(r => r.json())
      .then(json => { if (json.status) setDealer(json.data) })
      .catch(() => {})
  }, [dealerId])

  // Fetch all orders (same pattern as order-book)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`${BACKEND_URL}/orderpegination?page=1&limit=1000&search=`)
      const json = await res.json()
      setOrders(Array.isArray(json.data) ? json.data : [])
    } catch {
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // All orders belonging to this dealer (matched by name, case-insensitive)
  const dealerOrders = useMemo(() => {
    if (!dealer) return []
    const name = dealer.Dealer_Name?.toLowerCase() ?? ""
    return orders.filter(o => o.Dealer_Name?.toLowerCase() === name)
  }, [orders, dealer])

  // Apply user filters and sort newest first
  const filtered = useMemo(() => {
    return dealerOrders
      .filter(o => {
        const date = moment(o.order_date)
        if (filters.from && date.isBefore(moment(filters.from), "day")) return false
        if (filters.to   && date.isAfter(moment(filters.to),   "day")) return false
        if (filters.payStatus !== "All" && getPayStatus(o) !== filters.payStatus) return false
        return true
      })
      .sort((a, b) => moment(b.order_date).valueOf() - moment(a.order_date).valueOf())
  }, [dealerOrders, filters])

  // Summary cards — always based on all dealer orders (unfiltered)
  const summary = useMemo(() => {
    let totalValue = 0, totalPaid = 0, totalPending = 0
    for (const o of dealerOrders) {
      const net = Number(o.order_amount) - Number(o.order_discount)
      totalValue += net
      if (Number(o.mtstatus) >= 2) totalPaid   += net
      else                         totalPending += net
    }
    return { count: dealerOrders.length, totalValue, totalPaid, totalPending }
  }, [dealerOrders])

  // Totals row — based on filtered rows only
  const totals = useMemo(() => {
    let grand = 0, paid = 0, balance = 0
    for (const o of filtered) {
      const net = Number(o.order_amount) - Number(o.order_discount)
      grand += net
      if (Number(o.mtstatus) >= 2) paid    += net
      else                         balance += net
    }
    return { grand, paid, balance }
  }, [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const slice      = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const hasFilters = !!(filters.from || filters.to || filters.invoiceType !== "All" || filters.payStatus !== "All")

  const setFilter = <K extends keyof typeof filters>(key: K, val: typeof filters[K]) => {
    setFilters(f => ({ ...f, [key]: val }))
    setPage(1)
  }

  const resetFilters = () => { setFilters({ from: "", to: "", invoiceType: "All", payStatus: "All" }); setPage(1) }

  // Invoice type label shown per row (global, not per-order)
  const invTypeLabel = filters.invoiceType === "All" ? "Tax Invoice" : filters.invoiceType
  const isBOS        = filters.invoiceType === "Bill of Supply"

  // ─── Excel export ──────────────────────────────────────────────────────────
  const exportExcel = async () => {
    const XLSX = await import("xlsx")
    const rows = filtered.map((o, i) => {
      const net = Number(o.order_amount) - Number(o.order_discount)
      const ms  = Number(o.mtstatus ?? 0)
      return {
        'S.No.':           i + 1,
        'Date':            (o.order_date || "").slice(0, 10),
        'Order ID':        `OM/${YEAR}/${o.order_id}`,
        'Invoice Type':    invTypeLabel,
        'Products':        `${o.orderdata_item_quantity || 0} items`,
        'Grand Total (₹)': net,
        'Amount Paid (₹)': ms >= 2 ? net : ms === 1 ? "Partial" : 0,
        'Balance Due (₹)': ms >= 2 ? 0   : ms === 1 ? "Partial" : net,
        'Status':          getPayStatus(o),
      }
    })

    const ws = XLSX.utils.json_to_sheet(rows)
    // Column widths
    ws['!cols'] = [
      { wch: 6 }, { wch: 12 }, { wch: 18 }, { wch: 15 },
      { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 10 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Ledger")
    const dateStr = moment().format("YYYY-MM-DD")
    const name    = dealer?.Dealer_Name?.replace(/[^a-z0-9]/gi, "-") ?? "dealer"
    XLSX.writeFile(wb, `ledger-${name}-${dateStr}.xlsx`)
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .print-card { box-shadow: none !important; border: 1px solid #e5e7eb !important; }
        }
        @media screen { .print-date { display: none; } }
      `}</style>

      <div className="p-6 max-w-7xl mx-auto">

        {/* Back */}
        <div className="no-print mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dealer List
          </button>
        </div>

        {/* Dealer header card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-5 print-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-4 mb-3">
                <div className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xl font-bold flex-shrink-0">
                  {dealer ? avatarInitials(dealer.Dealer_Name) : "…"}
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                    {dealer?.Dealer_Name ?? "Loading…"}
                  </h1>
                  <p className="text-sm text-gray-400 mt-0.5">Dealer Ledger Statement</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                {dealer?.Dealer_Email   && <span className="flex items-center gap-1"><span>📧</span>{dealer.Dealer_Email}</span>}
                {dealer?.Dealer_Number  && <span className="flex items-center gap-1"><span>📞</span>{dealer.Dealer_Number}</span>}
                {dealer?.Dealer_City    && <span className="flex items-center gap-1"><span>📍</span>{dealer.Dealer_City}</span>}
                {dealer?.Dealer_Dealercode && (
                  <span className="font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    Code: {dealer.Dealer_Dealercode}
                  </span>
                )}
                {dealer?.gst && (
                  <span className="font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    GST: {dealer.gst}
                  </span>
                )}
                {dealer?.creditdays && (
                  <span className="font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    Credit: {dealer.creditdays} days
                  </span>
                )}
              </div>
            </div>

            <div className="print-date text-xs text-gray-400">
              Printed on {moment().format("DD MMM YYYY")}
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 print-card">
            <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider mb-2">Total Orders</p>
            <p className="text-2xl font-bold text-indigo-600">{loading ? "…" : summary.count}</p>
            <p className="text-xs text-gray-400 mt-0.5">all time</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 print-card">
            <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider mb-2">Total Purchased</p>
            <p className="text-xl font-bold text-purple-600 leading-tight">{loading ? "…" : fmt(summary.totalValue)}</p>
            <p className="text-xs text-gray-400 mt-0.5">gross value</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 print-card">
            <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider mb-2">Total Paid</p>
            <p className="text-xl font-bold text-emerald-600 leading-tight">{loading ? "…" : fmt(summary.totalPaid)}</p>
            <p className="text-xs text-gray-400 mt-0.5">settled</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 print-card">
            <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider mb-2">Outstanding</p>
            <p className="text-xl font-bold text-amber-600 leading-tight">{loading ? "…" : fmt(summary.totalPending)}</p>
            <p className="text-xs text-gray-400 mt-0.5">pending / overdue</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4 no-print">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 font-medium whitespace-nowrap">From</label>
              <input
                type="date" value={filters.from}
                onChange={e => setFilter("from", e.target.value)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 font-medium whitespace-nowrap">To</label>
              <input
                type="date" value={filters.to}
                onChange={e => setFilter("to", e.target.value)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
            </div>

            <select
              value={filters.invoiceType}
              onChange={e => setFilter("invoiceType", e.target.value as InvoiceType)}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
            >
              <option value="All">All Invoice Types</option>
              <option value="Tax Invoice">Tax Invoice</option>
              <option value="Bill of Supply">Bill of Supply</option>
            </select>

            <select
              value={filters.payStatus}
              onChange={e => setFilter("payStatus", e.target.value as "All" | PayStatus)}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
            >
              <option value="All">All Statuses</option>
              <option value="Paid">Paid</option>
              <option value="Partial">Partial</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Overdue">Overdue</option>
            </select>

            {hasFilters && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
              >
                <X className="w-3 h-3" />
                Reset
              </button>
            )}

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={load}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
              >
                <RefreshCw className="w-3 h-3" />
                Refresh
              </button>
              <button
                onClick={exportExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium"
              >
                <FileSpreadsheet className="w-3 h-3" />
                Excel
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition font-medium"
              >
                <Printer className="w-3 h-3" />
                PDF
              </button>
            </div>
          </div>
        </div>

        {/* Row count + page info */}
        <div className="flex items-center justify-between mb-3 px-1 no-print">
          <p className="text-xs text-gray-400">
            {loading
              ? "Loading orders…"
              : `${filtered.length} order${filtered.length !== 1 ? "s" : ""}${hasFilters ? " (filtered)" : ""}`
            }
          </p>
          {totalPages > 1 && (
            <p className="text-xs text-gray-400">Page {page} of {totalPages}</p>
          )}
        </div>

        {/* Ledger table */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-4 print-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {["#", "Date", "Order ID", "Invoice Type", "Products", "Grand Total", "Amount Paid", "Balance Due", "Status"].map(h => (
                    <th key={h} className={`px-4 py-3.5 text-[10.5px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap ${
                      ["Grand Total", "Amount Paid", "Balance Due"].includes(h) ? "text-right" : "text-left"
                    }`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-50">
                {/* Loading skeleton */}
                {loading && Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-gray-100 rounded animate-pulse" style={{ width: j === 2 ? 100 : j === 0 ? 20 : 60 }} />
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Empty state */}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-20 text-center text-sm text-gray-400">
                      {dealerOrders.length === 0
                        ? "No orders found for this dealer"
                        : "No orders match the current filters"
                      }
                    </td>
                  </tr>
                )}

                {/* Data rows */}
                {!loading && slice.map((o, i) => {
                  const net      = Number(o.order_amount) - Number(o.order_discount)
                  const ms       = Number(o.mtstatus ?? 0)
                  const status   = getPayStatus(o)
                  const isPaid   = ms >= 2
                  const isPartial = ms === 1
                  const amtPaid  = isPaid ? net : isPartial ? null : 0
                  const balDue   = isPaid ? 0  : isPartial ? null : net

                  return (
                    <tr key={o.order_id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {(page - 1) * PAGE_SIZE + i + 1}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                        {o.order_date ? moment(o.order_date).format("DD MMM YYYY") : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-indigo-700 whitespace-nowrap">
                        OM/{YEAR}/{o.order_id}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${
                          isBOS
                            ? "bg-purple-50 text-purple-700"
                            : "bg-blue-50 text-blue-700"
                        }`}>
                          {invTypeLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {o.orderdata_item_quantity
                          ? `${o.orderdata_item_quantity} item${Number(o.orderdata_item_quantity) !== 1 ? "s" : ""}`
                          : "—"
                        }
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-gray-800">
                        {fmt(net)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {amtPaid === null
                          ? <span className="text-blue-600 font-semibold">Partial</span>
                          : <span className="text-emerald-700">{fmt(amtPaid)}</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {balDue === null
                          ? <span className="text-blue-600 font-semibold">Partial</span>
                          : balDue > 0
                            ? <span className="text-red-600 font-bold">{fmt(balDue)}</span>
                            : <span className="text-gray-400">₹0.00</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Pinned totals footer */}
              {!loading && filtered.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td colSpan={5} className="px-4 py-3 text-[10.5px] font-bold text-gray-500 uppercase tracking-wider">
                      Total · {filtered.length} order{filtered.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-bold text-gray-900">
                      {fmt(totals.grand)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-bold text-emerald-700">
                      {fmt(totals.paid)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-bold text-red-600">
                      {fmt(totals.balance)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between no-print">
            <span className="text-xs text-gray-400">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                ← Prev
              </button>

              {pageNumbers(page, totalPages).map((p, idx) =>
                p === "…" ? (
                  <span key={`e-${idx}`} className="px-2 text-gray-400 text-sm">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
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
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Next →
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
