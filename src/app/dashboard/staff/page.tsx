'use client'

import Link from "next/link"
import { useEffect, useRef, useState, useMemo } from "react"
import { useRouter, usePathname } from "next/navigation"
import { LayoutDashboard, ClipboardList, LogOut, UserRoundPlus, Eye, ChevronUp, ChevronDown, Search, AlertCircle } from "lucide-react"

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api"
const year        = new Date().getFullYear()

// ── Types ──────────────────────────────────────────────────
type User = {
  staff_id:          string
  staff_name:        string
  staff_email:       string
  staff_designation: string
  staff_location:    string
  staff_roletype:    string
  staff_username:    string
  staff_dealer:      string
  status:            string
}

type StaffDealer = {
  Dealer_Id:          string
  Dealer_Name:        string
  Dealer_City:        string
  Dealer_Email:       string
  Dealer_Number:      string
  Dealer_Address:     string
  Dealer_Pincode:     string
  Dealer_Dealercode:  string
  discount:           string
  gst:                string
  creditdays:         string
  annualtarget:       string
  currentlimit:       string
  status:             string
  assignedstaff:      string
}

type OrderItem   = { order_id: string; total: string; status?: string; order_status?: string }
type MonthlyData = { month: string[]; total: string[] }
type TopOrder    = { order_id: string; total: string }
type TopDealer   = { Dealer_Name: string; total: string }

type StaffStats = {
  myOrders:      number
  myDealers:     number
  totalRevenue:  number
  pendingOrders: number
}

type SortKey = "Dealer_Name" | "Dealer_City" | "creditdays" | "currentlimit" | "discount"

// ── Helpers ────────────────────────────────────────────────
function getRoleLabel(rt: string) {
  if (rt === "0") return "Admin"
  if (rt === "1") return "Executive"
  if (rt === "2") return "Field Executive"
  return "Staff"
}
function getRoleBadgeCls(rt: string) {
  if (rt === "0") return "badge-red"
  if (rt === "1") return "badge-purple"
  return "badge-blue"
}
function fmtCurrency(n: number) {
  if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n}`
}
function fmtINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// ── Nav ────────────────────────────────────────────────────
const STAFF_NAV = [
  { label: "Dealer List",    href: "/Dashboard/admin/dealer/DealerList",       icon: <LayoutDashboard size={15} /> },
  { label: "Add Dealer",     href: "/Dashboard/admin/dealer/AddDealerForm",    icon: <UserRoundPlus  size={15} /> },
  { label: "Order List",     href: "/Pages/Ordermanagement",                   icon: <ClipboardList  size={15} /> },
  { label: "Pending Orders", href: "/Pages/Ordermanagement/outstandingorders", icon: <ClipboardList  size={15} /> },
]

// ──────────────────────────────────────────────────────────
export default function StaffDashboard() {
  const router   = useRouter()
  const pathname = usePathname()

  // Chart refs
  const barRef1    = useRef<HTMLCanvasElement | null>(null)
  const barInst1   = useRef<any>(null)
  const barRef2    = useRef<HTMLCanvasElement | null>(null)
  const barInst2   = useRef<any>(null)
  const donutRef   = useRef<HTMLCanvasElement | null>(null)
  const donutInst  = useRef<any>(null)

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [fetchError,  setFetchError]  = useState<string | null>(null)
  const [user,        setUser]        = useState<User | null>(null)

  // Data state
  const [dealers,      setDealers]      = useState<StaffDealer[]>([])
  const [totalOrders,  setTotalOrders]  = useState<MonthlyData>({ month: [], total: [] })
  const [totalValue,   setTotalValue]   = useState<MonthlyData>({ month: [], total: [] })
  const [topOrders,    setTopOrders]    = useState<TopOrder[]>([])
  const [topDealers,   setTopDealers]   = useState<TopDealer[]>([])
  const [stats,        setStats]        = useState<StaffStats>({
    myOrders: 0, myDealers: 0, totalRevenue: 0, pendingOrders: 0,
  })

  // Dealer table state
  const [dealerSearch, setDealerSearch] = useState("")
  const [sortKey,      setSortKey]      = useState<SortKey>("Dealer_Name")
  const [sortAsc,      setSortAsc]      = useState(true)

  // ── Auth ─────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem("staffData") || localStorage.getItem("UserData")
      if (!raw) { router.push("/auth/login"); return }
      const parsed: User = JSON.parse(raw)
      if (!parsed?.staff_id) { router.push("/auth/login"); return }
      localStorage.setItem("staffData", JSON.stringify(parsed))
      setUser(parsed)
      fetchDashboard(parsed)
    } catch {
      router.push("/auth/login")
    }
  }, [])

  // ── Fetch ────────────────────────────────────────────────
  const fetchDashboard = async (u: User) => {
    setFetchError(null)
    const safeJson = async (res: Response) => {
      try { return res.ok ? await res.json() : null } catch { return null }
    }
    try {
      const [
        staffOrdersRes,
        staffDealersRes,
        totalOrderRes,
        totalValueRes,
        topOrderRes,
        topDealerRes,
      ] = await Promise.allSettled([
        fetch(`${BACKEND_URL}/getStaffOrders?staff_id=${u.staff_id}`),
        fetch(`${BACKEND_URL}/staffDealers?id=${u.staff_id}`),
        fetch(`${BACKEND_URL}/getMonthlyreporttotalorder`),
        fetch(`${BACKEND_URL}/getMonthlyreporttotalvalue`),
        fetch(`${BACKEND_URL}/getMonthlyreporttoporder`),
        fetch(`${BACKEND_URL}/getMonthlyreporttopdealer`),
      ])

      const ordersJson      = staffOrdersRes.status  === "fulfilled" ? await safeJson(staffOrdersRes.value)  : null
      const dealersJson     = staffDealersRes.status === "fulfilled" ? await safeJson(staffDealersRes.value) : null
      const totalOrderJson  = totalOrderRes.status   === "fulfilled" ? await safeJson(totalOrderRes.value)   : null
      const totalValueJson  = totalValueRes.status   === "fulfilled" ? await safeJson(totalValueRes.value)   : null
      const topOrderJson    = topOrderRes.status     === "fulfilled" ? await safeJson(topOrderRes.value)     : null
      const topDealerJson   = topDealerRes.status    === "fulfilled" ? await safeJson(topDealerRes.value)    : null

      const orders:   OrderItem[]   = ordersJson?.data  || []
      const dlrList:  StaffDealer[] = dealersJson?.data || []

      setDealers(dlrList)

      setStats({
        myOrders:      orders.length,
        totalRevenue:  orders.reduce((s, o) => s + Number(o.total || 0), 0),
        pendingOrders: orders.filter(o => o.status === "pending" || o.order_status === "0").length,
        myDealers:     dlrList.length,
      })

      if (totalOrderJson?.month) setTotalOrders({ month: totalOrderJson.month, total: totalOrderJson.total })
      if (totalValueJson?.month) setTotalValue({ month: totalValueJson.month, total: totalValueJson.total })
      if (Array.isArray(topOrderJson?.top))  setTopOrders(topOrderJson.top)
      if (Array.isArray(topDealerJson?.top)) setTopDealers(topDealerJson.top)

    } catch (err) {
      console.error("Dashboard fetch error:", err)
      setFetchError("Failed to load dashboard data. Please refresh.")
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => { localStorage.clear(); router.push("/auth/login") }

  // ── Chart 1 — Monthly Orders ─────────────────────────────
  useEffect(() => {
    if (loading || totalOrders.month.length === 0) return
    let alive = true
    ;(async () => {
      const { default: Chart } = await import("chart.js/auto")
      if (!alive || !barRef1.current) return
      barInst1.current?.destroy()
      barInst1.current = new Chart(barRef1.current, {
        type: "bar",
        data: {
          labels: totalOrders.month,
          datasets: [{
            label: "Orders",
            data: totalOrders.total.map(Number),
            backgroundColor: "rgba(99,102,241,0.78)",
            hoverBackgroundColor: "#4f46e5",
            borderRadius: 7, borderSkipped: false,
            barPercentage: 0.58, categoryPercentage: 0.68,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#1e1b4b", titleColor: "#c7d2fe", bodyColor: "#e0e7ff",
              padding: 10, cornerRadius: 8,
              callbacks: { label: ctx => ` ${Number(ctx.raw).toLocaleString("en-IN")} orders` },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#9ca3af", font: { size: 11 } }, border: { display: false } },
            y: { grid: { color: "rgba(156,163,175,0.13)" }, border: { display: false }, ticks: { color: "#9ca3af", font: { size: 11 } } },
          },
        },
      })
    })()
    return () => { alive = false; barInst1.current?.destroy() }
  }, [loading, totalOrders])

  // ── Chart 2 — Monthly Revenue ────────────────────────────
  useEffect(() => {
    if (loading || totalValue.month.length === 0) return
    let alive = true
    ;(async () => {
      const { default: Chart } = await import("chart.js/auto")
      if (!alive || !barRef2.current) return
      barInst2.current?.destroy()
      barInst2.current = new Chart(barRef2.current, {
        type: "bar",
        data: {
          labels: totalValue.month,
          datasets: [{
            label: "Revenue",
            data: totalValue.total.map(Number),
            backgroundColor: "rgba(245,158,11,0.78)",
            hoverBackgroundColor: "#d97706",
            borderRadius: 7, borderSkipped: false,
            barPercentage: 0.58, categoryPercentage: 0.68,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#0f0e17", titleColor: "#e0e7ff", bodyColor: "#c7d2fe",
              padding: 10, cornerRadius: 8,
              callbacks: { label: ctx => ` ₹${Number(ctx.raw).toLocaleString("en-IN")}` },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#9ca3af", font: { size: 11 } }, border: { display: false } },
            y: { grid: { color: "rgba(156,163,175,0.13)" }, border: { display: false }, ticks: { color: "#9ca3af", font: { size: 11 } } },
          },
        },
      })
    })()
    return () => { alive = false; barInst2.current?.destroy() }
  }, [loading, totalValue])

  // ── Chart 3 — City Distribution donut ────────────────────
  useEffect(() => {
    if (loading || dealers.length === 0) return
    const cityMap: Record<string, number> = {}
    dealers.forEach(d => {
      const c = d.Dealer_City?.trim() || "Unknown"
      cityMap[c] = (cityMap[c] || 0) + 1
    })
    const labels = Object.keys(cityMap)
    const data   = Object.values(cityMap)
    const COLORS  = ["#6366f1","#f59e0b","#10b981","#ef4444","#3b82f6","#8b5cf6","#ec4899","#14b8a6"]

    let alive = true
    ;(async () => {
      const { default: Chart } = await import("chart.js/auto")
      if (!alive || !donutRef.current) return
      donutInst.current?.destroy()
      donutInst.current = new Chart(donutRef.current, {
        type: "doughnut",
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: COLORS.slice(0, labels.length),
            borderWidth: 2,
            borderColor: "#fff",
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          cutout: "62%",
          plugins: {
            legend: { position: "right", labels: { font: { size: 11 }, color: "#6b7280", boxWidth: 10, padding: 12 } },
            tooltip: {
              backgroundColor: "#1f2937", titleColor: "#f9fafb", bodyColor: "#d1d5db",
              callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} dealer${Number(ctx.raw) !== 1 ? "s" : ""}` },
            },
          },
        },
      })
    })()
    return () => { alive = false; donutInst.current?.destroy() }
  }, [loading, dealers])

  // ── Dealer table filtering + sorting ─────────────────────
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
        const av = sortKey === "currentlimit" || sortKey === "creditdays" || sortKey === "discount"
          ? Number(a[sortKey] || 0) - Number(b[sortKey] || 0)
          : (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "")
        return sortAsc ? av : -av
      })
  }, [dealers, dealerSearch, sortKey, sortAsc])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  // ── Guard ─────────────────────────────────────────────────
  if (!user) return null

  const initials  = user.staff_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
  const roleLabel = getRoleLabel(user.staff_roletype)
  const roleCls   = getRoleBadgeCls(user.staff_roletype)

  const STAT_CARDS = [
    { label: "Total Orders",   fmt: String(stats.myOrders),          badge: "badge-purple", badgeLabel: "All time" },
    { label: "Pending Orders", fmt: String(stats.pendingOrders),     badge: "badge-amber",  badgeLabel: "Action needed" },
    { label: "My Dealers",     fmt: String(stats.myDealers),         badge: "badge-blue",   badgeLabel: "Assigned" },
    { label: "Total Revenue",  fmt: fmtCurrency(stats.totalRevenue), badge: "badge-green",  badgeLabel: "₹" + stats.totalRevenue.toLocaleString("en-IN") },
  ]

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
      : <span style={{ display: "inline-block", width: 12 }} />

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; }
        .root { min-height: 100vh; background: #f0f2f5; color: #111827; font-family: 'DM Sans', sans-serif; }

        .sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 256px; z-index: 40; background: #0d0c16; display: flex; flex-direction: column; transform: translateX(-100%); transition: transform 0.28s cubic-bezier(0.4,0,0.2,1); }
        .sidebar.open { transform: translateX(0); }
        .sb-user { margin: 20px 14px 0; padding: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; }
        .sb-avatar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .sb-avatar { width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; flex-shrink: 0; }
        .sb-uname  { font-size: 13px; font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-meta   { font-size: 10.5px; color: #475569; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-chips  { display: flex; gap: 5px; flex-wrap: wrap; }
        .sb-chip   { font-size: 10px; font-family: 'DM Mono', monospace; padding: 2px 8px; border-radius: 6px; }
        .sc-role   { background: rgba(99,102,241,0.18); color: #a5b4fc; }
        .sc-desg   { background: rgba(16,185,129,0.12); color: #34d399; }
        .sc-loc    { background: rgba(245,158,11,0.12); color: #fbbf24; }
        .sb-nav  { flex: 1; padding: 10px; margin-top: 10px; overflow-y: auto; }
        .sb-link { display: flex; align-items: center; gap: 11px; padding: 10px 13px; border-radius: 11px; font-size: 13.5px; font-weight: 500; color: #64748b; text-decoration: none; margin-bottom: 2px; transition: background .16s, color .16s; }
        .sb-link:hover  { background: rgba(255,255,255,0.05); color: #e2e8f0; }
        .sb-link.active { background: rgba(99,102,241,0.18); color: #a5b4fc; }
        .sb-foot   { padding: 14px; border-top: 1px solid rgba(255,255,255,0.07); }
        .sb-logout { width: 100%; padding: 9px 14px; border-radius: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.09); font-size: 13px; font-weight: 500; color: #475569; cursor: pointer; font-family: inherit; transition: all .16s; display: flex; align-items: center; justify-content: center; gap: 7px; }
        .sb-logout:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.28); color: #f87171; }

        .overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.5); backdrop-filter: blur(3px); opacity: 0; pointer-events: none; transition: opacity .28s; }
        .overlay.show { opacity: 1; pointer-events: all; }

        .topbar { position: sticky; top: 0; z-index: 20; height: 62px; padding: 0 22px; background: linear-gradient(to right,#1f4b8d,#0d0c16); border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; gap: 12px; }
        .hamburger { flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; transition: background .15s; }
        .hamburger:hover { background: rgba(255,255,255,0.12); }
        .topbar-title { font-size: 15px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .topbar-sub   { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 1px; }

        .content { padding: 24px 22px; max-width: 1440px; margin: 0 auto; }
        .page-heading { font-size: 20px; font-weight: 600; color: #111827; padding: 18px 22px 0; }

        .profile-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 22px; margin-bottom: 16px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
        .profile-avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; color: #fff; flex-shrink: 0; }
        .profile-name  { font-size: 17px; font-weight: 600; color: #111827; }
        .profile-email { font-size: 12px; color: #6b7280; margin-top: 3px; }
        .profile-chips { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 8px; }
        .chip { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }

        .badge-purple { background: #ede9fe; color: #7c3aed; }
        .badge-green  { background: #d1fae5; color: #059669; }
        .badge-amber  { background: #fef3c7; color: #b45309; }
        .badge-blue   { background: #dbeafe; color: #1d4ed8; }
        .badge-red    { background: #fee2e2; color: #dc2626; }

        .info-cards { display: grid; grid-template-columns: repeat(auto-fill,minmax(200px,1fr)); gap: 14px; margin-bottom: 20px; }
        .icard { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px 20px; transition: box-shadow .2s, transform .2s; }
        .icard:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.07); transform: translateY(-2px); }
        .icard-lbl   { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; }
        .icard-val   { font-size: 22px; font-weight: 600; color: #111827; letter-spacing: -.03em; font-family: 'DM Mono', monospace; line-height: 1.1; }
        .icard-badge { display: inline-flex; align-items: center; gap: 3px; margin-top: 9px; padding: 2px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 600; }

        .charts-row { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 16px; }
        @media (min-width: 900px) { .charts-row { grid-template-columns: 1fr 1fr; } }
        .charts-row3 { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 16px; }
        @media (min-width: 900px) { .charts-row3 { grid-template-columns: 1fr 1fr 1fr; } }

        .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 22px; margin-bottom: 16px; }
        .panel-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
        .panel-title  { font-size: 13.5px; font-weight: 600; color: #111827; }
        .panel-sub    { font-size: 11.5px; color: #9ca3af; margin-top: 2px; }
        .chart-wrap   { position: relative; width: 100%; height: 260px; }
        .chart-empty  { display: flex; align-items: center; justify-content: center; height: 260px; color: #9ca3af; font-size: 13px; }
        .legend { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .leg    { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6b7280; }
        .leg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

        .reports-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        @media (max-width: 640px) { .reports-row { grid-template-columns: 1fr; } }
        .report-item  { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
        .report-item:last-child { border-bottom: none; }
        .report-name  { font-size: 12.5px; color: #374151; font-family: 'DM Mono', monospace; }
        .report-value { font-size: 12.5px; font-weight: 600; color: #111827; font-family: 'DM Mono', monospace; }
        .report-empty { font-size: 13px; color: #9ca3af; padding: 12px 0; }
        .section-head { font-size: 11px; font-weight: 600; color: #fff; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 12px; background: #c8cacc; padding: 7px 10px; border-radius: 6px; }

        /* Dealer table */
        .dealer-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .dealer-table th { padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: .08em; background: #f9fafb; border-bottom: 1px solid #e5e7eb; white-space: nowrap; cursor: pointer; user-select: none; }
        .dealer-table th:hover { color: #374151; }
        .dealer-table th.th-right { text-align: right; }
        .dealer-table td { padding: 11px 14px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
        .dealer-table tr:last-child td { border-bottom: none; }
        .dealer-table tr:hover td { background: #fafafa; }
        .dt-name { font-weight: 600; color: #111827; font-size: 13px; }
        .dt-sub  { font-size: 11px; color: #9ca3af; margin-top: 2px; }
        .dt-code { font-family: 'DM Mono', monospace; font-size: 11px; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 5px; padding: 1px 7px; }
        .dt-mono { font-family: 'DM Mono', monospace; font-size: 12px; color: #374151; }
        .dt-right { text-align: right; }
        .st-active   { background: #d1fae5; color: #065f46; font-size: 10px; font-weight: 700; padding: 2px 9px; border-radius: 20px; }
        .st-inactive { background: #fee2e2; color: #991b1b; font-size: 10px; font-weight: 700; padding: 2px 9px; border-radius: 20px; }
        .view-btn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 11px; border-radius: 7px; font-size: 11px; font-weight: 600; color: #4f46e5; background: #ede9fe; border: none; cursor: pointer; text-decoration: none; transition: background .15s; }
        .view-btn:hover { background: #ddd6fe; }

        .search-wrap { position: relative; }
        .search-wrap svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #9ca3af; pointer-events: none; }
        .search-input { padding: 8px 12px 8px 34px; border: 1px solid #e5e7eb; border-radius: 9px; font-size: 13px; width: 240px; outline: none; font-family: inherit; color: #111827; background: #f9fafb; transition: border-color .15s, box-shadow .15s; }
        .search-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); background: #fff; }
        .dealer-count { font-size: 11.5px; color: #9ca3af; }

        .loading-pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .shimmer-row td { padding: 14px; }
        .shimmer-block { height: 13px; border-radius: 6px; background: linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
        @keyframes shimmer { 0%{background-position:200%} 100%{background-position:-200%} }
        .sb-nav::-webkit-scrollbar { width: 5px; }
        .sb-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        .table-scroll { overflow-x: auto; }
      `}</style>

      <div className="root">
        <div className={`overlay${sidebarOpen ? " show" : ""}`} onClick={() => setSidebarOpen(false)} />

        <div className="page-heading">Staff Dashboard</div>

        <main className="content">

          {/* Error banner */}
          {fetchError && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              {fetchError}
              <button onClick={() => user && fetchDashboard(user)} style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "#dc2626", background: "none", border: "1px solid #fca5a5", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                Retry
              </button>
            </div>
          )}

          {/* Profile Card */}
          <div className="profile-card">
            <div className="profile-avatar">{initials}</div>
            <div>
              <div className="profile-name">{user.staff_name}</div>
              <div className="profile-email">{user.staff_email || "—"}</div>
              <div className="profile-chips">
                <span className={`chip ${roleCls}`}>{roleLabel}</span>
                {user.staff_designation?.trim() && (
                  <span className="chip badge-blue">{user.staff_designation.trim()}</span>
                )}
                {user.staff_location && (
                  <span className="chip badge-amber">📍 {user.staff_location}</span>
                )}
                <span className="chip badge-green" style={{ fontFamily: "'DM Mono', monospace" }}>
                  ID: {user.staff_id}
                </span>
              </div>
            </div>
          </div>

          {/* Stat Cards */}
          <div className="info-cards">
            {STAT_CARDS.map(card => (
              <div className="icard" key={card.label}>
                <div className="icard-lbl">{card.label}</div>
                <div className="icard-val">
                  {loading ? <span className="loading-pulse" style={{ display: "inline-block", width: 60, height: 22, background: "#f3f4f6", borderRadius: 6 }} /> : card.fmt}
                </div>
                <div className={`icard-badge ${card.badge}`}>{card.badgeLabel}</div>
              </div>
            ))}
          </div>

          {/* Charts row — Orders + Revenue */}
          <div className="charts-row">
            <div className="panel" style={{ marginBottom: 0 }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">Monthly Orders</div>
                  <div className="panel-sub">Total order count per month</div>
                </div>
                <div className="legend">
                  <span className="leg">
                    <span className="leg-dot" style={{ background: "rgba(99,102,241,0.78)" }} />Orders
                  </span>
                </div>
              </div>
              {loading ? (
                <div className="chart-empty loading-pulse">Loading chart…</div>
              ) : totalOrders.month.length === 0 ? (
                <div className="chart-empty">No order data available</div>
              ) : (
                <div className="chart-wrap"><canvas ref={barRef1} /></div>
              )}
            </div>

            <div className="panel" style={{ marginBottom: 0 }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">Monthly Revenue</div>
                  <div className="panel-sub">Total value per month</div>
                </div>
                <div className="legend">
                  <span className="leg">
                    <span className="leg-dot" style={{ background: "rgba(245,158,11,0.78)" }} />Revenue
                  </span>
                </div>
              </div>
              {loading ? (
                <div className="chart-empty loading-pulse">Loading chart…</div>
              ) : totalValue.month.length === 0 ? (
                <div className="chart-empty">No revenue data available</div>
              ) : (
                <div className="chart-wrap"><canvas ref={barRef2} /></div>
              )}
            </div>
          </div>

          {/* City distribution + Reports */}
          <div className="charts-row">
            {/* <div className="panel" style={{ marginBottom: 0 }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">Dealer Distribution</div>
                  <div className="panel-sub">By city</div>
                </div>
              </div>
              {loading ? (
                <div className="chart-empty loading-pulse">Loading chart…</div>
              ) : dealers.length === 0 ? (
                <div className="chart-empty">No dealer data available</div>
              ) : (
                <div className="chart-wrap"><canvas ref={donutRef} /></div>
              )}
            </div> */}

            <div className="panel" style={{ marginBottom: 0 }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">Reports</div>
                  <div className="panel-sub">Top performing orders and dealers</div>
                </div>
              </div>
              <div className="reports-row">
                <div>
                  <div className="section-head">Top Orders</div>
                  {loading ? (
                    <div className="report-empty loading-pulse">Loading...</div>
                  ) : topOrders.length > 0 ? topOrders.map(item => (
                    <div key={item.order_id} className="report-item">
                      <span className="report-name">OM/{year}/{item.order_id}</span>
                      <span className="report-value">₹{Number(item.total).toLocaleString("en-IN")}</span>
                    </div>
                  )) : <div className="report-empty">No data available</div>}
                </div>
                <div>
                  <div className="section-head">Top Dealers</div>
                  {loading ? (
                    <div className="report-empty loading-pulse">Loading...</div>
                  ) : topDealers.length > 0 ? topDealers.map((d, i) => (
                    <div key={i} className="report-item">
                      <span className="report-name">{d.Dealer_Name}</span>
                      <span className="report-value">₹{Number(d.total).toLocaleString("en-IN")}</span>
                    </div>
                  )) : <div className="report-empty">No data available</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Assigned Dealers table */}
          
        </main>
      </div>
    </>
  )
}
