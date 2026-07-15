'use client'

import Link from "next/link"
import { useMemo, useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueries,
} from "@tanstack/react-query"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts"
import {
  LayoutDashboard, UserRoundPlus, ClipboardList,
  BookOpen, LogOut, ChevronUp, ChevronDown, Search, AlertCircle, Eye, Receipt,
} from "lucide-react"
import { formatRupee, resolveCurrentMonthTotal } from "@/lib/companySales"
import PendingProductsPreview from "@/components/dashboard/PendingProductsPreview"
import { clearAuthStorage } from "@/lib/roleAccess"

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api"
const year = new Date().getFullYear()

const NAV_ITEMS = [
  { label: "Dealer List",     href: "/dashboard/admin/dealer/DealerList",        icon: <LayoutDashboard size={15} /> },
  { label: "Dealer Ledger",   href: "/Pages/ledger",                             icon: <BookOpen size={15} /> },
  { label: "Add Dealer",      href: "/dashboard/admin/dealer/AddDealerForm",     icon: <UserRoundPlus size={15} /> },
  { label: "Dealer Category Report", href: "/dashboard/staff/reports/dealer-category", icon: <ClipboardList size={15} /> },
  { label: "Order List",      href: "/Pages/Ordermanagement",                    icon: <ClipboardList size={15} /> },
  { label: "Pending Orders",  href: "/Pages/Ordermanagement/outstandingorders",  icon: <ClipboardList size={15} /> },
  { label: "Discount Requests", href: "/dashboard/staff/discount-requests",      icon: <Receipt size={15} /> },
]

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
type User = {
  staff_id: string
  staff_name: string
  staff_email: string
  staff_designation: string
  staff_location: string
  staff_roletype: string
  staff_username: string
  staff_dealer: string
  status: string
}

type StaffDealer = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_City: string
  Dealer_Email: string
  Dealer_Number: string
  Dealer_Address: string
  Dealer_Pincode: string
  Dealer_Dealercode: string
  discount: string
  gst: string
  creditdays: string
  currentlimit: string
  annualtarget: string
  status: string
  assignedstaff: string
}

type OrderItem   = {
  order_id: string
  total: string
  status?: string
  order_status?: string
  order_date?: string
  orderDate?: string
  Dealer_Name?: string
  order_amount?: string | number
  outstandingDate?: string
  accept_order?: string
}
type MonthlyData = { month: string[]; total: string[] }
type TopOrder    = { order_id: string; total: string }
type TopDealer   = { Dealer_Name: string; total: string }
type SortKey     = "Dealer_Name" | "Dealer_City" | "creditdays" | "currentlimit" | "discount"
type DiscountRequest = {
  id: string
  dealerId: string
  dealerName?: string
  requestedDiscountPercent: number
  currentDiscountPercent: number
  subtotal: number
  currentDiscountAmount: number
  requestedDiscountAmount: number
  currentFinalPayable: number
  requestedFinalPayable: number
  discountScope?: "order" | "product"
  targetProduct?: {
    displayName?: string
    variantCode?: string
    productname?: string
  } | null
  status: "pending" | "approved" | "rejected"
  createdAt: string
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function getRoleLabel(rt: string) {
  if (rt === "0") return "Admin"
  if (rt === "1") return "Executive"
  if (rt === "2") return "Field Executive"
  return "Staff"
}

function fmtCurrency(n: number) {
  if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n}`
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (/^\s*</.test(text)) throw new Error("Expected JSON but received HTML")
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error("Invalid JSON response")
  }
}

// ─────────────────────────────────────────────────────────────
// QUERY CLIENT  (stable singleton per module load)
// ─────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:        60_000,   // data stays fresh for 1 min
      gcTime:           300_000,  // cache kept for 5 min
      retry:            2,
      refetchOnWindowFocus: true,
    },
  },
})

// ─────────────────────────────────────────────────────────────
// ROOT EXPORT  (wraps with provider)
// ─────────────────────────────────────────────────────────────
export default function ExecutiveDashboardPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ExecutiveDashboard />
    </QueryClientProvider>
  )
}

// ─────────────────────────────────────────────────────────────
// INNER COMPONENT
// ─────────────────────────────────────────────────────────────
function ExecutiveDashboard() {
  const router   = useRouter()
  const pathname = usePathname()

  // ── Auth (sync, no fetch) ────────────────────────────────────
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem("staffData") || localStorage.getItem("UserData")
      if (!raw) { router.push("/auth/login"); return }
      const parsed: User = JSON.parse(raw)
      if (!parsed?.staff_id) { router.push("/auth/login"); return }
      localStorage.setItem("staffData", JSON.stringify(parsed))
      setUser(parsed)
    } catch {
      router.push("/auth/login")
    } finally {
      setAuthChecked(true)
    }
  }, [router])

  // ── UI state ─────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [dealerSearch, setDealerSearch] = useState("")
  const [sortKey,  setSortKey]  = useState<SortKey>("Dealer_Name")
  const [sortAsc,  setSortAsc]  = useState(true)
  const [dealerPage, setDealerPage] = useState(1)
  const DEALER_PAGE_SIZE = 10

  // ── React Query — parallel queries ───────────────────────────
  //   useQueries fires all at once; each caches + retries independently.
  const enabled = !!user?.staff_id

  const [
    ordersQ,
    dealersQ,
    discountRequestsQ,
    monthlyOrdersQ,
    monthlyValueQ,
    topOrdersQ,
    topDealersQ,
  ] = useQueries({
    queries: [
      {
        queryKey:  ["staffOrders", user?.staff_id],
        queryFn:   () => fetchJson<{ data: OrderItem[] }>(`${BACKEND_URL}/getStaffOrders?staff_id=${user!.staff_id}`),
        enabled,
        select:    (d: { data: OrderItem[] }) => d.data ?? [],
      },
      {
        queryKey:  ["staffDealers", user?.staff_id],
        queryFn:   () => fetchJson<{ data: StaffDealer[] }>(`${BACKEND_URL}/staffDealers?id=${user!.staff_id}`),
        enabled,
        select:    (d: { data: StaffDealer[] }) => d.data ?? [],
      },
      {
        queryKey:  ["staffDiscountRequests", user?.staff_id],
        queryFn:   () => fetchJson<{ data: DiscountRequest[] }>(`/api/custom-discount-requests?staff_id=${encodeURIComponent(user!.staff_id)}&status=pending&limit=200`),
        enabled,
        select:    (d: { data: DiscountRequest[] }) => d.data ?? [],
      },
      {
        queryKey:  ["monthlyOrders"],
        queryFn:   () => fetchJson<MonthlyData>(`${BACKEND_URL}/getMonthlyreporttotalorder`),
        enabled,
        staleTime: 5 * 60_000,
      },
      {
        queryKey:  ["monthlyValue"],
        queryFn:   () => fetchJson<MonthlyData>(`${BACKEND_URL}/getMonthlyreporttotalvalue`),
        enabled,
        staleTime: 5 * 60_000,
      },
      {
        queryKey:  ["topOrders"],
        queryFn:   () => fetchJson<{ top: TopOrder[] }>(`${BACKEND_URL}/getMonthlyreporttoporder`),
        enabled,
        select:    (d: { top: TopOrder[] }) => d.top ?? [],
        staleTime: 5 * 60_000,
      },
      {
        queryKey:  ["topDealers"],
        queryFn:   () => fetchJson<{ top: TopDealer[] }>(`${BACKEND_URL}/getMonthlyreporttopdealer`),
        enabled,
        select:    (d: { top: TopDealer[] }) => d.top ?? [],
        staleTime: 5 * 60_000,
      },
    ],
  })

  // ── Derived values ────────────────────────────────────────────
  const orders  = (ordersQ.data  as OrderItem[]   | undefined) ?? []
  const dealers = (dealersQ.data as StaffDealer[] | undefined) ?? []
  const discountRequests = (discountRequestsQ.data as DiscountRequest[] | undefined) ?? []
  const totalOrders  = monthlyOrdersQ.data as MonthlyData | undefined
  const totalValue   = monthlyValueQ.data  as MonthlyData | undefined
  const topOrders    = (topOrdersQ.data  as TopOrder[]  | undefined) ?? []
  const topDealers   = (topDealersQ.data as TopDealer[] | undefined) ?? []
  const companyWideOrders = resolveCurrentMonthTotal(totalOrders)
  const companyWideSales = resolveCurrentMonthTotal(totalValue)

  const stats = useMemo(() => ({
    myOrders:      orders.length,
    totalRevenue:  orders.reduce((s, o) => s + Number(o.total || 0), 0),
    pendingOrders: orders.filter(o => o.status === "pending" || o.order_status === "0").length,
    myDealers:     dealers.length,
    pendingDiscountRequests: discountRequests.length,
  }), [orders, dealers, discountRequests])

  const activeDealers = useMemo(
    () => dealers.filter(d => Number(d.status) === 1).length,
    [dealers]
  )

  const companyMonthLoading = monthlyOrdersQ.isLoading || monthlyValueQ.isLoading

  const nearCreditLimitDealers = useMemo(
    () => dealers.filter(d => {
      const current = Number(d.currentlimit) || 0
      const target = Number(d.annualtarget) || 0
      return target > 0 && current / target > 0.8
    }),
    [dealers]
  )

  // Any query still loading the very first time
  const globalLoading = !authChecked || [ordersQ, dealersQ, discountRequestsQ].some(q => q.isLoading)
  // Any hard error
  const anyError = [ordersQ, dealersQ, discountRequestsQ, monthlyOrdersQ, monthlyValueQ, topOrdersQ, topDealersQ]
    .find(q => q.isError)

  const refetchAll = () => {
    ordersQ.refetch()
    dealersQ.refetch()
    discountRequestsQ.refetch()
    monthlyOrdersQ.refetch()
    monthlyValueQ.refetch()
    topOrdersQ.refetch()
    topDealersQ.refetch()
  }

  // ── Chart data ────────────────────────────────────────────────
  const ordersChartData     = (totalOrders?.month ?? []).map((m, i) => ({ name: m, value: Number(totalOrders?.total[i] || 0) }))
  const revenueChartData    = (totalValue?.month  ?? []).map((m, i) => ({ name: m, value: Number(totalValue?.total[i]  || 0) }))
  const topOrdersChartData  = topOrders.map(o => ({ name: `#${o.order_id}`, value: Number(o.total) }))
  const topDealersChartData = topDealers.map(d => ({ name: d.Dealer_Name.substring(0, 12), value: Number(d.total) }))

  // ── Dealer table ──────────────────────────────────────────────
  const filteredDealers = useMemo(() => {
    const q = dealerSearch.toLowerCase()
    return dealers
      .filter(d =>
        !q ||
        d.Dealer_Name?.toLowerCase().includes(q) ||
        d.Dealer_City?.toLowerCase().includes(q) ||
        d.Dealer_Dealercode?.toLowerCase().includes(q) ||
        d.Dealer_Number?.includes(q)
      )
      .sort((a, b) => {
        const av =
          sortKey === "currentlimit" || sortKey === "creditdays" || sortKey === "discount"
            ? Number(a[sortKey] || 0) - Number(b[sortKey] || 0)
            : (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "")
        return sortAsc ? av : -av
      })
  }, [dealers, dealerSearch, sortKey, sortAsc])

  useEffect(() => { setDealerPage(1) }, [dealerSearch, sortKey, sortAsc])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  const handleLogout = () => { clearAuthStorage(localStorage); window.dispatchEvent(new Event("omsons-auth-changed")); router.push("/auth/login") }

  if (!user) return null

  const initials   = user.staff_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
  const roleLabel  = getRoleLabel(user.staff_roletype)

  const STAT_CONFIG = [
    {
      label: "Company-wide Sales",
      value: formatRupee(companyWideSales),
      badge: "badge-purple",
      badgeLabel: "This month",
      href: "/dashboard/staff/sales",
      sub: "Sales across all distributors",
    },
    {
      label: "Company-wide Orders",
      value: companyWideOrders.toLocaleString("en-IN"),
      badge: "badge-blue",
      badgeLabel: "This month",
      href: "/dashboard/staff/sales",
      sub: "Orders across all distributors",
    },
    { label: "Pending Orders", value: stats.pendingOrders, badge: "badge-amber",  badgeLabel: "Action needed" },
    { label: "My Dealers",     value: stats.myDealers,     badge: "badge-green",  badgeLabel: "Assigned" },
    { label: "Discount Requests", value: stats.pendingDiscountRequests, badge: "badge-amber", badgeLabel: `${stats.pendingDiscountRequests} pending` },
    { label: "Total Orders",   value: stats.myOrders,      badge: "badge-blue",   badgeLabel: "All time" },
    { label: "Total Revenue",  value: formatRupee(stats.totalRevenue), badge: "badge-purple", badgeLabel: `₹${stats.totalRevenue.toLocaleString("en-IN")}` },
  ]

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
      : <span style={{ display: "inline-block", width: 12 }} />

  const MoneyTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: "#1e1b4b", border: "1px solid #4f46e5", borderRadius: 8, padding: "8px 14px" }}>
        <div style={{ color: "#c7d2fe", fontSize: 11, marginBottom: 3 }}>{label}</div>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>₹{Number(payload[0].value).toLocaleString("en-IN")}</div>
      </div>
    )
  }
  const CountTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: "#1e1b4b", border: "1px solid #4f46e5", borderRadius: 8, padding: "8px 14px" }}>
        <div style={{ color: "#c7d2fe", fontSize: 11, marginBottom: 3 }}>{label}</div>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{Number(payload[0].value).toLocaleString("en-IN")} orders</div>
      </div>
    )
  }

  // ── Pagination helpers ────────────────────────────────────────
  const totalDealerPages = Math.ceil(filteredDealers.length / DEALER_PAGE_SIZE)
  const pageStart        = (dealerPage - 1) * DEALER_PAGE_SIZE
  const paginated        = filteredDealers.slice(pageStart, pageStart + DEALER_PAGE_SIZE)

  const pageRange = (): (number | "...")[] => {
    const r: (number | "...")[] = [1]
    const lo = Math.max(2, dealerPage - 1)
    const hi = Math.min(totalDealerPages - 1, dealerPage + 1)
    if (lo > 2) r.push("...")
    for (let i = lo; i <= hi; i++) r.push(i)
    if (hi < totalDealerPages - 1) r.push("...")
    if (totalDealerPages > 1) r.push(totalDealerPages)
    return r
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; }

        .root { min-height: 100vh; background: #f0f2f5; color: #111827; font-family: 'DM Sans', sans-serif; }

        /* ── Sidebar ── */
        .sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 256px; z-index: 40; background: #0d0c16; display: flex; flex-direction: column; transform: translateX(-100%); transition: transform 0.28s cubic-bezier(0.4,0,0.2,1); }
        .sidebar.open { transform: translateX(0); }
        .sb-head { padding: 24px 20px 16px; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .sb-chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; background: rgba(99,102,241,0.16); color: #818cf8; font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px; }
        .sb-title { font-size: 16px; font-weight: 600; color: #fff; letter-spacing: -.3px; }
        .sb-user { margin: 14px 14px 0; padding: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; }
        .sb-avatar { width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 8px; }
        .sb-uname { font-size: 13px; font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-meta  { font-size: 10.5px; color: #475569; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-role  { margin-top: 6px; display: inline-block; font-size: 10px; font-family: 'DM Mono', monospace; background: rgba(99,102,241,0.18); color: #a5b4fc; padding: 2px 8px; border-radius: 6px; }
        .sb-nav { flex: 1; padding: 10px; margin-top: 10px; overflow-y: auto; }
        .sb-link { display: flex; align-items: center; gap: 11px; padding: 10px 13px; border-radius: 11px; font-size: 13.5px; font-weight: 500; color: #64748b; text-decoration: none; margin-bottom: 2px; transition: background .16s, color .16s; }
        .sb-link:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
        .sb-link.active { background: rgba(99,102,241,0.18); color: #a5b4fc; }
        .sb-foot { padding: 14px; border-top: 1px solid rgba(255,255,255,0.07); }
        .sb-logout { width: 100%; padding: 9px 14px; border-radius: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.09); font-size: 13px; font-weight: 500; color: #475569; cursor: pointer; font-family: inherit; transition: all .16s; display: flex; align-items: center; justify-content: center; gap: 7px; }
        .sb-logout:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.28); color: #f87171; }

        /* ── Overlay ── */
        .overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.5); backdrop-filter: blur(3px); opacity: 0; pointer-events: none; transition: opacity .28s; }
        .overlay.show { opacity: 1; pointer-events: all; }

        /* ── Content ── */
        .content { padding: 24px 22px; max-width: 1440px; margin: 0 auto; }

        /* ── Profile strip ── */
        .profile-strip { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px 22px; margin-bottom: 20px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
        .profile-avatar { width: 52px; height: 52px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 19px; font-weight: 700; color: #fff; flex-shrink: 0; }
        .profile-name  { font-size: 16px; font-weight: 600; color: #111827; }
        .profile-email { font-size: 12px; color: #6b7280; margin-top: 3px; }
        .profile-chips { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 8px; }
        .pchip { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }
        .pc-purple { background: #ede9fe; color: #7c3aed; }
        .pc-blue   { background: #dbeafe; color: #1d4ed8; }
        .pc-amber  { background: #fef3c7; color: #b45309; }
        .pc-green  { background: #d1fae5; color: #059669; font-family: 'DM Mono', monospace; }

        /* ── Refetch indicator ── */
        .refetch-bar { height: 3px; background: linear-gradient(90deg, #6366f1, #a78bfa); animation: slide 1.2s infinite; border-radius: 2px; margin-bottom: 12px; }
        @keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }

        /* ── Stat cards ── */
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px; }
        .stat-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px 20px; transition: box-shadow .2s, transform .2s; }
        .stat-card:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.07); transform: translateY(-2px); }
        .stat-link-card { display: block; text-decoration: none; color: inherit; }
        .stat-lbl { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; }
        .stat-sub { font-size: 11.5px; color: #6b7280; margin-top: 7px; }
        .stat-val { font-size: 28px; font-weight: 700; color: #111827; letter-spacing: -.03em; font-family: 'DM Mono', monospace; line-height: 1; }
        .stat-badge { display: inline-flex; align-items: center; gap: 3px; margin-top: 9px; padding: 2px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 600; }
        .badge-amber  { background: #fef3c7; color: #b45309; }
        .badge-green  { background: #d1fae5; color: #059669; }
        .badge-blue   { background: #dbeafe; color: #1d4ed8; }
        .badge-purple { background: #ede9fe; color: #7c3aed; }
        .badge-red    { background: #fee2e2; color: #b91c1c; }
        .pulse-amber { box-shadow: 0 0 0 0 rgba(245,158,11,0.7); animation: pulseAmber 1.6s infinite; }
        @keyframes pulseAmber { 0%{box-shadow:0 0 0 0 rgba(245,158,11,0.7)} 70%{box-shadow:0 0 0 8px rgba(245,158,11,0)} 100%{box-shadow:0 0 0 0 rgba(245,158,11,0)} }
        .quick-action-btn { display: inline-flex; align-items: center; justify-content: center; margin-top: 10px; padding: 6px 10px; border-radius: 8px; background: #f9fafb; border: 1px solid #e5e7eb; color: #4f46e5; font-size: 11.5px; font-weight: 700; text-decoration: none; transition: background .15s, border-color .15s; }
        .quick-action-btn:hover { background: #ede9fe; border-color: #ddd6fe; }

        /* ── Panels / Charts ── */
        .charts-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
        @media (max-width: 800px) { .charts-2 { grid-template-columns: 1fr; } }
        .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 22px; }
        .panel-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
        .panel-title { font-size: 13.5px; font-weight: 600; color: #111827; }
        .panel-sub   { font-size: 11.5px; color: #9ca3af; margin-top: 2px; }
        .chart-canvas { height: 240px; width: 100%; }
        .chart-empty  { height: 240px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 13px; }
        .legend { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #6b7280; }
        .leg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

        /* ── Reports ── */
        .reports-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        @media (max-width: 640px) { .reports-row { grid-template-columns: 1fr; } }
        .rpt-head { font-size: 11px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: .06em; background: #c8cacc; padding: 6px 10px; border-radius: 6px; margin-bottom: 12px; }
        .report-item { display: flex; justify-content: space-between; align-items: center; padding: 9px 0; border-bottom: 1px solid #f3f4f6; }
        .report-item:last-child { border-bottom: none; }
        .report-name  { font-size: 12.5px; color: #374151; font-family: 'DM Mono', monospace; }
        .report-value { font-size: 12.5px; font-weight: 600; color: #111827; font-family: 'DM Mono', monospace; }
        .report-empty { font-size: 13px; color: #9ca3af; padding: 12px 0; }

        /* ── Dealer table ── */
        .dealer-table-wrap { overflow-x: auto; }
        .dealer-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .dealer-table th { padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .08em; background: #f9fafb; border-bottom: 1px solid #e5e7eb; white-space: nowrap; cursor: pointer; user-select: none; }
        .dealer-table th:hover { color: #374151; }
        .dealer-table td { padding: 11px 14px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
        .dealer-table tr:last-child td { border-bottom: none; }
        .dealer-table tr:hover td { background: #fafafa; }
        .dt-name { font-weight: 600; color: #111827; font-size: 13px; }
        .dt-sub  { font-size: 11px; color: #9ca3af; margin-top: 2px; }
        .dt-code { font-family: 'DM Mono', monospace; font-size: 11px; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 5px; padding: 1px 7px; }
        .dt-mono { font-family: 'DM Mono', monospace; font-size: 12px; color: #374151; }
        .st-active   { background: #d1fae5; color: #065f46; font-size: 10px; font-weight: 700; padding: 2px 9px; border-radius: 20px; }
        .st-inactive { background: #fee2e2; color: #991b1b; font-size: 10px; font-weight: 700; padding: 2px 9px; border-radius: 20px; }
        .view-btn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 11px; border-radius: 7px; font-size: 11px; font-weight: 600; color: #4f46e5; background: #ede9fe; border: none; cursor: pointer; text-decoration: none; transition: background .15s; }
        .view-btn:hover { background: #ddd6fe; }

        /* ── Error banner ── */
        .err-banner { display: flex; align-items: center; gap: 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; color: #dc2626; }
        .retry-btn { margin-left: auto; font-size: 12px; font-weight: 600; color: #dc2626; background: none; border: 1px solid #fca5a5; border-radius: 6px; padding: 3px 10px; cursor: pointer; }

        /* ── Search ── */
        .search-wrap { position: relative; display: inline-flex; align-items: center; }
        .search-wrap svg { position: absolute; left: 10px; color: #9ca3af; pointer-events: none; }
        .search-input { padding: 8px 12px 8px 34px; border: 1px solid #e5e7eb; border-radius: 9px; font-size: 13px; width: 220px; outline: none; font-family: inherit; color: #111827; background: #f9fafb; transition: border-color .15s, box-shadow .15s; }
        .search-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); background: #fff; }

        /* ── Shimmer ── */
        .shimmer { background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 6px; }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        .sb-nav::-webkit-scrollbar { width: 5px; }
        .sb-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      `}</style>

      <div className="root">

        {/* ── Overlay ── */}
        <div
          className={`overlay${sidebarOpen ? " show" : ""}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />

        {/* ── Sidebar ── */}
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="sb-head">
            <div className="sb-chip">Executive Portal</div>
            <div className="sb-title">Workspace</div>
          </div>
          <div className="sb-user">
            <div className="sb-avatar">{initials}</div>
            <div className="sb-uname">{user.staff_name}</div>
            <div className="sb-meta">{user.staff_email || "—"}</div>
            <span className="sb-role">{roleLabel}</span>
          </div>
          <nav className="sb-nav">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`sb-link${pathname === item.href ? " active" : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="sb-foot">
            <button className="sb-logout" onClick={handleLogout}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <div>
          <main className="content">

            {/* Background refetch indicator — shows only when re-fetching cached data */}
            {[ordersQ, dealersQ, monthlyOrdersQ, monthlyValueQ].some(q => q.isFetching && !q.isLoading) && (
              <div className="refetch-bar" />
            )}

            {/* Error banner — per-query granular */}
            {anyError && (
              <div className="err-banner">
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                Some data failed to load. Cached results shown where available.
                <button className="retry-btn" onClick={refetchAll}>Retry all</button>
              </div>
            )}

            {/* ── Profile Strip ── */}
            <div className="profile-strip">
              <div className="profile-avatar">{initials}</div>
              <div>
                <div className="profile-name">{user.staff_name}</div>
                <div className="profile-email">{user.staff_email || "—"}</div>
                <div className="profile-chips">
                  <span className="pchip pc-purple">{roleLabel}</span>
                  {user.staff_designation?.trim() && (
                    <span className="pchip pc-blue">{user.staff_designation.trim()}</span>
                  )}
                  {user.staff_location && (
                    <span className="pchip pc-amber">📍 {user.staff_location}</span>
                  )}
                  <span className="pchip pc-green">ID: {user.staff_id}</span>
                </div>
              </div>
            </div>

            {/* ── Stat Cards ── */}
            <div className="stat-grid">
              {STAT_CONFIG.map(s => (
                s.href ? (
                  <Link key={s.label} href={s.href} className="stat-card stat-link-card">
                    <div className="stat-lbl">{s.label}</div>
                    <div className="font-sans font-bold">
                      {companyMonthLoading
                        ? <span className="shimmer" style={{ display: "inline-block", width: 72, height: 26 }} />
                        : s.value}
                    </div>
                    <div className="stat-sub">{s.sub}</div>
                    <div className={`stat-badge ${s.badge}`}>{s.badgeLabel}</div>
                  </Link>
                ) : (
                  <div key={s.label} className="stat-card">
                    <div className="stat-lbl">{s.label}</div>
                    <div className="font-sans font-bold">
                      {globalLoading
                        ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} />
                        : s.value}
                    </div>
                    <div className={`stat-badge ${s.badge}`}>{s.badgeLabel}</div>
                  </div>
                )
              ))}
            </div>

            {/* ── Sidebar Summary Widgets ── */}
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-lbl">Assigned Dealers</div>
                <div className="stat-val">
                  {dealersQ.isLoading
                    ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} />
                    : stats.myDealers}
                </div>
                <div className="panel-sub">Dealers mapped to your staff ID</div>
                <div className="font-sans font-bold badge-green">{activeDealers} active</div>
                <Link href="/dashboard/staff/dealerlist" className="quick-action-btn">+ View dealers</Link>
              </div>

              <div className="stat-card">
                <div className="stat-lbl">Pending Orders</div>
                <div className="font-sans font-bold">
                  {ordersQ.isLoading
                    ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} />
                    : stats.pendingOrders}
                </div>
                <div className="panel-sub">Orders awaiting action from assigned dealers</div>
                <div className={`stat-badge badge-amber${stats.pendingOrders > 0 ? " pulse-amber" : ""}`}>{stats.pendingOrders} pending</div>
                <Link href="/Pages/Ordermanagement/outstandingorders" className="quick-action-btn">+ Review orders</Link>
              </div>

              <div className="stat-card">
                <div className="stat-lbl">Discount Requests</div>
                <div className="font-sans font-bold">
                  {discountRequestsQ.isLoading
                    ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} />
                    : stats.pendingDiscountRequests}
                </div>
                <div className="panel-sub">Pending discount approvals linked to your staff ID</div>
                <div className={`stat-badge badge-amber${stats.pendingDiscountRequests > 0 ? " pulse-amber" : ""}`}>
                  {stats.pendingDiscountRequests} pending
                </div>
                <Link href="/dashboard/staff/discount-requests" className="quick-action-btn">+ View requests</Link>
              </div>

              <div className="stat-card">
                <div className="stat-lbl">Credit Watch</div>
                <div className="font-sans font-bold">
                  {dealersQ.isLoading
                    ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} />
                    : nearCreditLimitDealers.length}
                </div>
                <div className="panel-sub">Dealers using over 80% of annual target</div>
                <div className={`stat-badge ${nearCreditLimitDealers.length > 0 ? "badge-red" : "badge-blue"}`}>
                  {nearCreditLimitDealers.length} near limit
                </div>
                <Link href="/Pages/ledger" className="quick-action-btn">+ Open ledger</Link>
              </div>
            </div>

            {/* ── Charts Row 1 ── */}
            <PendingProductsPreview role="staff" moreHref="/dashboard/staff/pending-products" />

            <div className="charts-2">
              <ChartPanel
                title="Monthly Orders"
                sub="Total order count per month"
                legendColor="rgba(99,102,241,0.78)"
                legendLabel="Orders"
                loading={monthlyOrdersQ.isLoading}
                data={ordersChartData}
                barFill="rgba(99,102,241,0.78)"
                Tooltip={CountTooltip}
              />
              <ChartPanel
                title="Monthly Revenue"
                sub="Total value per month"
                legendColor="rgba(245,158,11,0.78)"
                legendLabel="Revenue"
                loading={monthlyValueQ.isLoading}
                data={revenueChartData}
                barFill="rgba(245,158,11,0.78)"
                Tooltip={MoneyTooltip}
              />
            </div>

            {/* ── Charts Row 2 ── */}
            <div className="charts-2">
              <ChartPanel
                title="Top Orders"
                sub="Order value distribution"
                legendColor="rgba(99,102,241,0.78)"
                legendLabel="Order Value"
                loading={topOrdersQ.isLoading}
                data={topOrdersChartData}
                barFill="rgba(99,102,241,0.78)"
                Tooltip={MoneyTooltip}
              />
              <ChartPanel
                title="Top Dealers"
                sub="Dealer performance ranking"
                legendColor="rgba(159,122,234,0.78)"
                legendLabel="Total Value"
                loading={topDealersQ.isLoading}
                data={topDealersChartData}
                barFill="rgba(159,122,234,0.78)"
                Tooltip={MoneyTooltip}
              />
            </div>

            {/* ── Reports panel ── */}
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">Reports</div>
                  <div className="panel-sub">Top performing orders and dealers</div>
                </div>
              </div>
              <div className="reports-row">
                <div>
                  <div className="rpt-head">Top Orders</div>
                  {topOrdersQ.isLoading
                    ? <div className="report-empty shimmer" style={{ height: 18, width: "60%", borderRadius: 4 }} />
                    : topOrders.length > 0
                      ? topOrders.map(item => (
                        <div key={item.order_id} className="report-item">
                          <span className="report-name">OM/{year}/{item.order_id}</span>
                          <span className="report-value">₹{Number(item.total).toLocaleString("en-IN")}</span>
                        </div>
                      ))
                      : <div className="report-empty">No data available</div>}
                </div>
                <div>
                  <div className="rpt-head">Top Dealers</div>
                  {topDealersQ.isLoading
                    ? <div className="report-empty shimmer" style={{ height: 18, width: "60%", borderRadius: 4 }} />
                    : topDealers.length > 0
                      ? topDealers.map((d, i) => (
                        <div key={i} className="report-item">
                          <span className="report-name">{d.Dealer_Name}</span>
                          <span className="report-value">₹{Number(d.total).toLocaleString("en-IN")}</span>
                        </div>
                      ))
                      : <div className="report-empty">No data available</div>}
                </div>
              </div>
            </div>

            {/* ── Assigned Dealers Table ── */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">My Assigned Dealers</div>
                  <div className="panel-sub">
                    {dealersQ.isLoading
                      ? "Loading…"
                      : `${filteredDealers.length} of ${dealers.length} dealers`}
                  </div>
                </div>
                <div className="search-wrap">
                  <Search size={14} />
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Search dealers…"
                    value={dealerSearch}
                    onChange={e => setDealerSearch(e.target.value)}
                  />
                </div>
              </div>

              {dealersQ.isLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 0" }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="shimmer" style={{ height: 44, borderRadius: 8 }} />
                  ))}
                </div>
              ) : filteredDealers.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontSize: 13 }}>
                  {dealers.length === 0 ? "No dealers assigned." : "No dealers match your search."}
                </div>
              ) : (
                <>
                  <div className="dealer-table-wrap">
                    <table className="dealer-table">
                      <thead>
                        <tr>
                          <th onClick={() => handleSort("Dealer_Name")} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            Dealer <SortIcon k="Dealer_Name" />
                          </th>
                          <th onClick={() => handleSort("Dealer_City")}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>City <SortIcon k="Dealer_City" /></span>
                          </th>
                          <th>Contact</th>
                          <th onClick={() => handleSort("discount")}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Disc% <SortIcon k="discount" /></span>
                          </th>
                          <th onClick={() => handleSort("creditdays")}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Credit Days <SortIcon k="creditdays" /></span>
                          </th>
                          <th onClick={() => handleSort("currentlimit")}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Limit <SortIcon k="currentlimit" /></span>
                          </th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.map((d, i) => (
                          <tr key={d.Dealer_Id || i}>
                            <td>
                              <div className="dt-name">{d.Dealer_Name}</div>
                              {d.Dealer_Dealercode && (
                                <div style={{ marginTop: 3 }}>
                                  <span className="dt-code">{d.Dealer_Dealercode}</span>
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="dt-mono">{d.Dealer_City || "—"}</div>
                              {d.Dealer_Pincode && <div className="dt-sub">{d.Dealer_Pincode}</div>}
                            </td>
                            <td>
                              <div className="dt-mono">{d.Dealer_Number || "—"}</div>
                              {d.Dealer_Email && (
                                <div className="dt-sub" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {d.Dealer_Email}
                                </div>
                              )}
                            </td>
                            <td className="dt-mono">{d.discount ? `${d.discount}%` : "—"}</td>
                            <td className="dt-mono">{d.creditdays || "—"}</td>
                            <td className="dt-mono">
                              {d.currentlimit ? `₹${Number(d.currentlimit).toLocaleString("en-IN")}` : "—"}
                            </td>
                            <td>
                              <span className={Number(d.status) === 1 ? "st-active" : "st-inactive"}>
                                {Number(d.status) === 1 ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td>
                              <Link href={`/dashboard/admin/dealer/${d.Dealer_Id}`} className="view-btn">
                                <Eye size={11} /> View
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalDealerPages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, flexWrap: "wrap", gap: 10 }}>
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>
                        Showing {pageStart + 1}–{Math.min(pageStart + DEALER_PAGE_SIZE, filteredDealers.length)} of {filteredDealers.length}
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => setDealerPage(p => p - 1)}
                          disabled={dealerPage === 1}
                          style={{ minWidth: 36, height: 34, padding: "0 10px", fontSize: 13, borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", color: dealerPage === 1 ? "#cbd5e1" : "#0f172a", cursor: dealerPage === 1 ? "default" : "pointer", opacity: dealerPage === 1 ? 0.4 : 1 }}
                        >‹</button>

                        {pageRange().map((item, idx) =>
                          item === "..." ? (
                            <span key={`e${idx}`} style={{ width: 36, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>…</span>
                          ) : (
                            <button
                              key={item}
                              onClick={() => setDealerPage(item as number)}
                              style={{ minWidth: 36, height: 34, padding: "0 10px", fontSize: 13, borderRadius: 7, border: "1px solid", borderColor: dealerPage === item ? "#1e3a5f" : "#e2e8f0", background: dealerPage === item ? "#1e3a5f" : "#fff", color: dealerPage === item ? "#fff" : "#0f172a", fontWeight: dealerPage === item ? 700 : 400, cursor: "pointer" }}
                            >{item}</button>
                          )
                        )}

                        <button
                          onClick={() => setDealerPage(p => p + 1)}
                          disabled={dealerPage === totalDealerPages}
                          style={{ minWidth: 36, height: 34, padding: "0 10px", fontSize: 13, borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", color: dealerPage === totalDealerPages ? "#cbd5e1" : "#0f172a", cursor: dealerPage === totalDealerPages ? "default" : "pointer", opacity: dealerPage === totalDealerPages ? 0.4 : 1 }}
                        >›</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

          </main>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// CHART PANEL — extracted to avoid repetition
// ─────────────────────────────────────────────────────────────
function ChartPanel({
  title, sub, legendColor, legendLabel,
  loading, data, barFill, Tooltip: TooltipComp,
}: {
  title: string
  sub: string
  legendColor: string
  legendLabel: string
  loading: boolean
  data: { name: string; value: number }[]
  barFill: string
  Tooltip: React.ComponentType<any>
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-sub">{sub}</div>
        </div>
        <div className="legend">
          <span className="leg-dot" style={{ background: legendColor }} />
          {legendLabel}
        </div>
      </div>
      {loading ? (
        <div className="chart-empty">
          <div className="shimmer" style={{ width: "100%", height: 200, borderRadius: 10 }} />
        </div>
      ) : data.length === 0 ? (
        <div className="chart-empty">No data available</div>
      ) : (
        <div className="chart-canvas">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<TooltipComp />} />
              <Bar dataKey="value" fill={barFill} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
