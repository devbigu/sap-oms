'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import moment from 'moment'
import { useRouter } from 'next/navigation'
import { AlertCircle, ChevronDown, Search, ShieldAlert, Store } from 'lucide-react'
import dealerCategoryReport from '@/lib/dealerCategoryReport'

const BACKEND_URL = 'https://mirisoft.co.in/sas/dealerapi/api'

type Dealer = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_City?: string
  Dealer_Number?: string
  Dealer_Dealercode?: string
  status?: string
}

type DealerResponse = {
  data: Dealer[]
  total?: number
  last_page?: number
  count?: number
}

type OrderHeader = Record<string, unknown> & {
  order_id: string
  order_date?: string
  orderDate?: string
  order_dealer?: string
  Dealer_Name?: string
  accept_order?: string
  del_status?: string
  order_status?: string
  mtstatus?: string
  reason?: string
}

type OrderItem = Record<string, unknown> & {
  orderdata_id: string
  orderdata_orderid: string
  orderdata_cat_no: string
  orderdata_item_quantity: string
  orderdata_price: string
  orderdata_discount: string
  orderdata_afterDisPrice: string
  orderdata_totalprice: string
  orderdata_datetime?: string
  product_name?: string
  product_discription?: string
  packSize?: number
  totalPieces?: number
}

type CatalogueProduct = Record<string, unknown> & {
  sku?: string
  id?: string
  category?: string
  categories?: string[]
  variants?: CatalogueVariant[]
}

type CatalogueVariant = Record<string, unknown> & {
  sku?: string
  id?: string
  pack?: number
}

type DealerReportSnapshot = {
  dealer: Dealer | null
  orders: OrderHeader[]
  items: OrderItem[]
}

type AllowedRole = 'admin' | 'staff'

type DealerCategoryReportProps = {
  allowedRoles?: AllowedRole[]
}

type OrderItemsResponse = {
  data?: unknown
}

const DEFAULT_FROM = moment().startOf('month').format('YYYY-MM-DD')
const DEFAULT_TO = moment().endOf('month').format('YYYY-MM-DD')
const IS_DEV = process.env.NODE_ENV !== 'production'

function formatRupee(value: number) {
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStoredRole(raw: string | null, field: string, value?: string) {
  if (!raw) return false
  if (value === undefined) {
    return raw.includes(`"${field}"`)
  }

  return new RegExp(`"${field}"\\s*:\\s*"${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(raw)
}

const subscribeToHydration = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

function useHasHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToHydration,
    getClientSnapshot,
    getServerSnapshot,
  )
}

function dateOnly(value: unknown): string {
  if (!value) return ''
  const parsed = moment(String(value))
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : ''
}

function isCancelledOrRejected(order: OrderHeader) {
  if (String(order.del_status ?? '').trim() === '1') return true

  const haystack = [order.order_status, order.reason, order.mtstatus]
    .map(value => String(value ?? '').toLowerCase())
    .join(' ')

  return /(cancel|cancelled|canceled|reject|rejected|declin)/i.test(haystack)
}

function withinRange(value: unknown, from: string, to: string) {
  const date = moment(dateOnly(value))
  if (!date.isValid()) return false
  if (from && date.isBefore(moment(from).startOf('day'))) return false
  if (to && date.isAfter(moment(to).endOf('day'))) return false
  return true
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal })
  const responseText = await response.text()

  if (!response.ok) {
    const preview = responseText.replace(/\s+/g, ' ').slice(0, 250)
    throw new Error(
      `Request failed with HTTP ${response.status}${IS_DEV && preview ? `: ${preview}` : ''}`
    )
  }

  try {
    return JSON.parse(responseText) as T
  } catch {
    const preview = responseText.replace(/\s+/g, ' ').slice(0, 250)
    throw new Error(
      `Expected JSON but received an invalid response${IS_DEV && preview ? `: ${preview}` : ''}`
    )
  }
}

async function fetchDealers(search: string, signal?: AbortSignal): Promise<Dealer[]> {
  const params = new URLSearchParams({ page: '1', search })
  try {
    const json = await fetchJson<DealerResponse>(`${BACKEND_URL}/dealerpegination?${params.toString()}`, signal)
    return Array.isArray(json.data) ? json.data : []
  } catch (error) {
    throw new Error(`Dealer search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function fetchDealerOrders(dealerId: string, signal?: AbortSignal): Promise<OrderHeader[]> {
  const params = new URLSearchParams({ page: '1', limit: '1000', search: '', id: dealerId })
  const json = await fetchJson<{ data?: OrderHeader[]; last_page?: number; count?: number }>(
    `${BACKEND_URL}/orderhispegination?${params.toString()}`,
    signal,
  )

  const rows = Array.isArray(json.data) ? json.data : []
  const total = Number(json.count ?? rows.length)
  const lastPage = Number(json.last_page ?? (total > rows.length ? Math.ceil(total / Math.max(rows.length, 1)) : 1))

  if (lastPage <= 1 || rows.length === 0) return rows

  const rest = await Promise.all(
    Array.from({ length: lastPage - 1 }, async (_unused, idx) => {
      const page = idx + 2
      const pageParams = new URLSearchParams({ page: String(page), limit: '1000', search: '', id: dealerId })
      const pageJson = await fetchJson<{ data?: OrderHeader[] }>(`${BACKEND_URL}/orderhispegination?${pageParams.toString()}`, signal)
      return Array.isArray(pageJson.data) ? pageJson.data : []
    })
  )

  return [...rows, ...rest.flat()]
}

async function fetchOrderItems(orderId: string, signal?: AbortSignal): Promise<OrderItem[]> {
  try {
    const json = await fetchJson<OrderItemsResponse>(`${BACKEND_URL}/orderdatalist?id=${encodeURIComponent(orderId)}`, signal)
    const raw = json.data

    let items: unknown[] = []
    if (Array.isArray(raw)) {
      const first = raw[0]
      if (raw.length > 0 && isRecord(first) && (first.productId || first.productName || first.quantityPacks !== undefined)) {
        items = raw
      } else if (raw.length > 0 && isRecord(first) && Array.isArray(first.items)) {
        items = first.items
      } else {
        items = raw
      }
    } else if (isRecord(raw) && Array.isArray(raw.items)) {
      items = raw.items
    }

    return items
      .filter(isRecord)
      .map((it, idx) => {
      const packSizeValue = Number(it.packSize ?? it.pack_size)
      const totalPiecesValue = Number(it.totalPieces ?? it.total_pieces)
      const normalized: OrderItem = {
        orderdata_id: String(it.orderdata_id ?? it.id ?? it.productId ?? `item-${orderId}-${idx}`),
        orderdata_orderid: String(it.orderdata_orderid ?? it.orderId ?? orderId),
        orderdata_cat_no: String(it.orderdata_cat_no ?? it.catNo ?? it.productId ?? it.product_cat ?? ''),
        orderdata_item_quantity: String(it.quantityPacks ?? it.quantity ?? it.orderdata_item_quantity ?? 0),
        orderdata_price: String(it.unitPrice ?? it.unit_price ?? it.orderdata_price ?? 0),
        orderdata_discount: String(it.discountAmount ?? it.discount_amount ?? it.orderdata_discount ?? 0),
        orderdata_afterDisPrice: String(it.finalPrice ?? it.final_price ?? it.orderdata_afterDisPrice ?? 0),
        orderdata_totalprice: String(it.listPriceTotal ?? it.list_price_total ?? it.orderdata_totalprice ?? 0),
        orderdata_datetime: String(it.documentDate ?? it.orderdata_datetime ?? ''),
        product_name: String(it.productName ?? it.product_name ?? ''),
        product_discription: String(it.productDescription ?? it.product_discription ?? ''),
        packSize: Number.isFinite(packSizeValue) ? packSizeValue : undefined,
        totalPieces: Number.isFinite(totalPiecesValue) ? totalPiecesValue : undefined,
        category: it.category ?? it.product_category ?? it.productCategory ?? undefined,
        product_category: it.product_category ?? undefined,
        productCategory: it.productCategory ?? undefined,
        unitPrice: it.unitPrice ?? it.unit_price ?? undefined,
        discountAmount: it.discountAmount ?? it.discount_amount ?? undefined,
        finalPrice: it.finalPrice ?? it.final_price ?? undefined,
        listPriceTotal: it.listPriceTotal ?? it.list_price_total ?? undefined,
        quantityPacks: it.quantityPacks ?? undefined,
        quantity: it.quantity ?? undefined,
        productId: it.productId ?? undefined,
        catNo: it.catNo ?? undefined,
        variantCode: it.variantCode ?? undefined,
        product_cat: it.product_cat ?? undefined,
      }

      return normalized
    })
  } catch (error) {
    throw new Error(`Order items failed for order ${orderId}: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

function resolveClientRole(): AllowedRole | 'dealer' | null {
  if (typeof window === 'undefined') return null

  try {
    const staffRaw = localStorage.getItem('staffData')
    if (hasStoredRole(staffRaw, 'staff_id')) {
      return hasStoredRole(staffRaw, 'staff_roletype', '0') ? 'admin' : 'staff'
    }

    const userData = localStorage.getItem('UserData')
    if (hasStoredRole(userData, 'Dealer_Id')) return 'dealer'
    if (hasStoredRole(userData, 'staff_id')) {
      return hasStoredRole(userData, 'staff_roletype', '0') ? 'admin' : 'staff'
    }

    const adminRaw = localStorage.getItem('AdminData') || localStorage.getItem('admin')
    if (adminRaw && adminRaw.trim().length > 2) return 'admin'
  } catch {
    return null
  }

  return null
}

export default function DealerCategoryReport({ allowedRoles = ['admin', 'staff'] }: DealerCategoryReportProps) {
  const router = useRouter()
  const hasHydrated = useHasHydrated()
  const [dealerSearch, setDealerSearch] = useState('')
  const [dealerResults, setDealerResults] = useState<Dealer[]>([])
  const [selectedDealer, setSelectedDealer] = useState<Dealer | null>(null)
  const [snapshot, setSnapshot] = useState<DealerReportSnapshot>({ dealer: null, orders: [], items: [] })
  const [catalogueProducts, setCatalogueProducts] = useState<CatalogueProduct[]>([])
  const [loadingDealers, setLoadingDealers] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [fromDate, setFromDate] = useState(DEFAULT_FROM)
  const [toDate, setToDate] = useState(DEFAULT_TO)
  const currentRole = hasHydrated
    ? resolveClientRole()
    : null
  const accessChecked = hasHydrated
  const isAllowed =
    (currentRole === 'admin' || currentRole === 'staff') &&
    allowedRoles.includes(currentRole)

  useEffect(() => {
    if (!accessChecked) return

    if (!currentRole) {
      router.replace('/auth/login')
      return
    }

    if (currentRole === 'dealer') {
      router.replace('/dashboard/dealer')
      return
    }

    if (!allowedRoles.includes(currentRole)) {
      router.replace('/auth/login')
      return
    }
  }, [accessChecked, allowedRoles, currentRole, router])

  useEffect(() => {
    if (!accessChecked || !isAllowed) return
    let active = true
    fetchJson<CatalogueProduct[]>('/data/nested_omsons_products.json')
      .then((json) => {
        if (active) setCatalogueProducts(Array.isArray(json) ? json : [])
      })
      .catch((error) => {
        if (active) {
          setCatalogueProducts([])
          setError(error instanceof Error ? `Catalogue load failed: ${error.message}` : 'Catalogue load failed')
        }
      })

    return () => { active = false }
  }, [accessChecked, isAllowed])

  useEffect(() => {
    if (!accessChecked || !isAllowed) return
    const controller = new AbortController()
    const term = dealerSearch.trim()

    if (term.length === 0) {
      return () => controller.abort()
    }

    const timer = window.setTimeout(() => {
      setLoadingDealers(true)
      fetchDealers(term, controller.signal)
        .then(rows => {
          if (!controller.signal.aborted) setDealerResults(rows)
        })
        .catch((error) => {
          if (
            controller.signal.aborted ||
            (error instanceof DOMException && error.name === 'AbortError')
          ) {
            return
          }

          setDealerResults([])
          setError(
            error instanceof Error
              ? error.message
              : 'Failed to load report'
          )
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingDealers(false)
        })
    }, 300)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [dealerSearch, accessChecked, isAllowed])

  useEffect(() => {
    if (!accessChecked || !isAllowed) return
    if (!selectedDealer) return

    const controller = new AbortController()

    ;(async () => {
      try {
        const orders = await fetchDealerOrders(selectedDealer.Dealer_Id, controller.signal)
        const dealerOrders = orders.filter(order => !isCancelledOrRejected(order))

        const orderItems = await Promise.all(
          dealerOrders.map(async order => {
            const items = await fetchOrderItems(order.order_id, controller.signal)
            return items.map(item => ({
              ...item,
              Dealer_Name: order.Dealer_Name ?? selectedDealer.Dealer_Name,
              order_dealer: order.order_dealer ?? selectedDealer.Dealer_Id,
              order_id: order.order_id,
              order_date: order.order_date ?? order.orderDate,
              accept_order: order.accept_order,
              del_status: order.del_status,
              order_status: order.order_status,
              mtstatus: order.mtstatus,
              reason: order.reason,
            }))
          })
        )

        if (controller.signal.aborted) return

        setSnapshot({ dealer: selectedDealer, orders: dealerOrders, items: orderItems.flat() })
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return
        }

        setSnapshot({ dealer: selectedDealer, orders: [], items: [] })
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load report'
        )
      } finally {
        // Loading state is derived from the selected dealer and snapshot.
      }
    })()

    return () => controller.abort()
  }, [selectedDealer, accessChecked, isAllowed])

  const filteredItems = useMemo(() => {
    if (!accessChecked || !isAllowed) return []
    return snapshot.items.filter(item => {
      const orderDate = dateOnly(item.order_date ?? item.orderdata_datetime)
      if (!withinRange(orderDate, fromDate, toDate)) return false
      return true
    })
  }, [snapshot.items, fromDate, toDate, accessChecked, isAllowed])

  const report = useMemo(
    () => dealerCategoryReport.aggregateDealerCategorySales(filteredItems, catalogueProducts),
    [filteredItems, catalogueProducts],
  )
  const reportRows = report.rows
  const grandTotal = report.grandTotal
  const loadingReport = !!selectedDealer && snapshot.dealer?.Dealer_Id !== selectedDealer.Dealer_Id && !error
  const dealerSearchLoading = dealerSearch.trim().length > 0 && loadingDealers
  const hasVisibleError = Boolean(error)

  if (!accessChecked || !isAllowed) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 py-8">
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <ShieldAlert size={20} />
            </div>
            <div className="text-lg font-semibold text-slate-900">Checking access</div>
            <div className="mt-1 text-sm text-slate-500">Please wait while we verify your dashboard role.</div>
          </div>
        </div>
      </div>
    )
  }

  const selectDealer = (dealer: Dealer) => {
    setSelectedDealer(dealer)
    setSelectorOpen(false)
    setDealerSearch(dealer.Dealer_Name)
    setDealerResults([])
    setError(null)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-6 py-6 text-white shadow-2xl shadow-slate-900/10 sm:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">
                <Store size={12} /> Dealer-wise category sales
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Dealer Category Report</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
                Select one distributor, then review category totals from historical order item values. Amounts are based on stored order data, not current pricing rules.
              </p>
            </div>
            <div className="grid gap-2 text-sm text-white/75 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Dealer</div>
                <div className="mt-1 font-semibold text-white">{selectedDealer?.Dealer_Name ?? 'Not selected'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Orders</div>
                <div className="mt-1 font-semibold text-white">{hasVisibleError ? '—' : snapshot.orders.length.toLocaleString('en-IN')}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Categories</div>
                <div className="mt-1 font-semibold text-white">{hasVisibleError ? '—' : reportRows.length.toLocaleString('en-IN')}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Distributor selector</div>
                <div className="text-xs text-slate-500">Search by distributor name, city, phone, or dealer code.</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectorOpen(v => !v)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                {selectorOpen ? 'Close' : 'Select'} <ChevronDown size={14} className={selectorOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={dealerSearch}
                onChange={e => {
                  setDealerSearch(e.target.value)
                  setSelectorOpen(true)
                }}
                onFocus={() => setSelectorOpen(true)}
                placeholder="Search distributors..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />

              {selectorOpen && dealerSearch.trim() && (
                <div className="absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
                  {dealerSearchLoading ? (
                    <div className="px-3 py-4 text-sm text-slate-500">Searching distributors...</div>
                  ) : dealerResults.length > 0 ? dealerResults.map(dealer => (
                    <button
                      key={dealer.Dealer_Id}
                      type="button"
                      onClick={() => selectDealer(dealer)}
                      className="flex w-full items-start justify-between gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">{dealer.Dealer_Name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {dealer.Dealer_City || '—'} · {dealer.Dealer_Number || '—'}
                        </div>
                      </div>
                      <div className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">{dealer.Dealer_Dealercode || dealer.Dealer_Id}</div>
                    </button>
                  )) : (
                    <div className="px-3 py-4 text-sm text-slate-500">No distributors matched your search.</div>
                  )}
                </div>
              )}
            </div>

            {selectedDealer && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Selected distributor</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{selectedDealer.Dealer_Name}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {selectedDealer.Dealer_City || '—'} · {selectedDealer.Dealer_Number || '—'} · {selectedDealer.Dealer_Dealercode || selectedDealer.Dealer_Id}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDealer(null)
                      setSnapshot({ dealer: null, orders: [], items: [] })
                      setError(null)
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                <ShieldAlert size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Filters</div>
                <div className="text-xs text-slate-500">Defaults to the current month.</div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">From date</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">To date</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Quantity</div>
                <div className="mt-1 text-lg font-semibold">{hasVisibleError ? '—' : grandTotal.quantity.toLocaleString('en-IN')}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Pieces</div>
                <div className="mt-1 text-lg font-semibold">{hasVisibleError ? '—' : grandTotal.pieces.toLocaleString('en-IN')}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Net Sales</div>
                <div className="mt-1 text-lg font-semibold text-emerald-700">{hasVisibleError ? '—' : formatRupee(grandTotal.netSales)}</div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!selectedDealer && !loadingReport && (
          <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Search size={22} />
            </div>
            <div className="text-lg font-semibold text-slate-900">Choose a distributor to build the report</div>
            <div className="mt-2 text-sm text-slate-500">The table appears after orders and order items are loaded.</div>
          </div>
        )}

        {selectedDealer && loadingReport && (
          <div className="mt-4 rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
            <div className="text-lg font-semibold text-slate-900">Loading dealer report</div>
            <div className="mt-2 text-sm text-slate-500">Fetching order history and item details...</div>
          </div>
        )}

        {selectedDealer && !loadingReport && !error && reportRows.length === 0 && (
          <div className="mt-4 rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
            <AlertCircle size={28} className="mx-auto text-slate-300" />
            <div className="mt-3 text-lg font-semibold text-slate-900">No matching order items found</div>
            <div className="mt-2 text-sm text-slate-500">Try widening the date range or selecting another distributor.</div>
          </div>
        )}

        {selectedDealer && reportRows.length > 0 && !loadingReport && !error && (
          <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
              <div className="text-base font-semibold text-slate-900">Category Breakdown</div>
              <div className="mt-1 text-sm text-slate-500">
                {fromDate} to {toDate} · Historical item values only
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">Category</th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Quantity</th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Pieces</th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Gross Amount</th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Discount</th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Net Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportRows.map(row => (
                    <tr key={row.category} className="hover:bg-slate-50/60">
                      <td className="px-5 py-4 font-medium text-slate-900">{row.category}</td>
                      <td className="px-5 py-4 text-right font-mono text-slate-700">{row.quantity.toLocaleString('en-IN')}</td>
                      <td className="px-5 py-4 text-right font-mono text-slate-700">{row.pieces.toLocaleString('en-IN')}</td>
                      <td className="px-5 py-4 text-right font-mono text-slate-700">{formatRupee(row.gross)}</td>
                      <td className="px-5 py-4 text-right font-mono text-slate-700">{formatRupee(row.discount)}</td>
                      <td className="px-5 py-4 text-right font-mono font-semibold text-emerald-700">{formatRupee(row.netSales)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                  <tr>
                    <td className="px-5 py-4 font-semibold text-slate-900">Grand Total</td>
                    <td className="px-5 py-4 text-right font-mono font-bold text-slate-900">{grandTotal.quantity.toLocaleString('en-IN')}</td>
                    <td className="px-5 py-4 text-right font-mono font-bold text-slate-900">{grandTotal.pieces.toLocaleString('en-IN')}</td>
                    <td className="px-5 py-4 text-right font-mono font-bold text-slate-900">{formatRupee(grandTotal.gross)}</td>
                    <td className="px-5 py-4 text-right font-mono font-bold text-slate-900">{formatRupee(grandTotal.discount)}</td>
                    <td className="px-5 py-4 text-right font-mono font-bold text-emerald-700">{formatRupee(grandTotal.netSales)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
