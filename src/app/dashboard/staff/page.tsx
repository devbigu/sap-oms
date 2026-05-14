'use client'

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { LayoutDashboard, ClipboardList, LogOut, UserRoundPlus } from "lucide-react"

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api"
const logoImage   = "http://sapoms.com/images/Omsons%20-%20White.png"
const year        = new Date().getFullYear()

// ── Types ──────────────────────────────────────────────────
type User = {
  staff_id:          string
  staff_name:        string
  staff_email:       string
  staff_designation: string
  staff_location:    string
  staff_roletype:    string   // "0" = Admin, "1" = Executive, "2" = Field Executive
  staff_username:    string
  staff_dealer:      string
  status:            string
}

type OrderItem   = { order_id: string; total: string; status?: string; order_status?: string }
type DealerItem  = { Dealer_Name: string; total: string }
type MonthlyData = { month: string[]; total: string[] }
type TopOrder    = { order_id: string; total: string }
type TopDealer   = { Dealer_Name: string; total: string }

type StaffStats = {
  myOrders:      number
  myDealers:     number
  totalRevenue:  number
  pendingOrders: number
}

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

  const barRef1  = useRef<HTMLCanvasElement | null>(null)
  const barInst1 = useRef<any>(null)
  const barRef2  = useRef<HTMLCanvasElement | null>(null)
  const barInst2 = useRef<any>(null)

  const [sidebarOpen,    setSidebarOpen]    = useState(false)
  const [loading,        setLoading]        = useState(true)
  const [user,           setUser]           = useState<User | null>(null)
  const [monthlyOrders,  setMonthlyOrders]  = useState<MonthlyData>({ month: [], total: [] })
  const [monthlyDealers, setMonthlyDealers] = useState<MonthlyData>({ month: [], total: [] })
  const [topOrders,      setTopOrders]      = useState<TopOrder[]>([])
  const [topDealers,     setTopDealers]     = useState<TopDealer[]>([])
  const [stats, setStats] = useState<StaffStats>({
    myOrders: 0, myDealers: 0, totalRevenue: 0, pendingOrders: 0,
  })

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
  const safeJson = async (res: Response) => {
    try { return res.ok ? await res.json() : null } catch { return null }
  }

  try {
    const [staffOrdersRes, staffDealersRes, monthlyOrdersRes, monthlyDealersRes] = await Promise.allSettled([
      fetch(`${BACKEND_URL}/getStaffOrders?staff_id=${u.staff_id}`),
      fetch(`${BACKEND_URL}/getStaffDealers?staff_id=${u.staff_id}`),
      fetch(`${BACKEND_URL}/getMonthlyreporttoporder`),
      fetch(`${BACKEND_URL}/getMonthlyreporttopdealer`),
    ])

    const staffOrdersJson  = staffOrdersRes.status  === "fulfilled" ? await safeJson(staffOrdersRes.value)  : null
    const staffDealersJson = staffDealersRes.status === "fulfilled" ? await safeJson(staffDealersRes.value) : null
    const monthlyOrdersJson  = monthlyOrdersRes.status  === "fulfilled" ? await safeJson(monthlyOrdersRes.value)  : null
    const monthlyDealersJson = monthlyDealersRes.status === "fulfilled" ? await safeJson(monthlyDealersRes.value) : null

    const orders:  OrderItem[]  = staffOrdersJson?.data  || []
    const dealers: DealerItem[] = staffDealersJson?.data || []

    setStats({
      myOrders:      orders.length,
      totalRevenue:  orders.reduce((s, o) => s + Number(o.total || 0), 0),
      pendingOrders: orders.filter(o => o.status === "pending" || o.order_status === "0").length,
      myDealers:     dealers.length,
    })

    if (monthlyOrdersJson && Array.isArray(monthlyOrdersJson.month)) {
      setMonthlyOrders({ month: monthlyOrdersJson.month, total: monthlyOrdersJson.total })
    }
    if (monthlyDealersJson && Array.isArray(monthlyDealersJson.month)) {
      setMonthlyDealers({ month: monthlyDealersJson.month, total: monthlyDealersJson.total })
    }
    if (Array.isArray(monthlyOrdersJson?.top))  setTopOrders(monthlyOrdersJson.top)
    if (Array.isArray(monthlyDealersJson?.top))  setTopDealers(monthlyDealersJson.top)

  } catch (err) {
    console.error("Dashboard fetch error:", err)
  } finally {
    setLoading(false)
  }
}

  const handleLogout = () => { localStorage.clear(); router.push("/auth/login") }

  // ── Chart 1 — Monthly Orders ─────────────────────────────
  useEffect(() => {
    if (loading || monthlyOrders.month.length === 0) return
    let alive = true
    ;(async () => {
      const { default: Chart } = await import("chart.js/auto")
      if (!alive || !barRef1.current) return
      barInst1.current?.destroy()
      barInst1.current = new Chart(barRef1.current, {
        type: "bar",
        data: {
          labels: monthlyOrders.month,
          datasets: [{
            label: "Orders",
            data: monthlyOrders.total.map(Number),
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
  }, [loading, monthlyOrders])

  // ── Chart 2 — Monthly Revenue ────────────────────────────
  useEffect(() => {
    if (loading || monthlyDealers.month.length === 0) return
    let alive = true
    ;(async () => {
      const { default: Chart } = await import("chart.js/auto")
      if (!alive || !barRef2.current) return
      barInst2.current?.destroy()
      barInst2.current = new Chart(barRef2.current, {
        type: "bar",
        data: {
          labels: monthlyDealers.month,
          datasets: [{
            label: "Revenue",
            data: monthlyDealers.total.map(Number),
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
  }, [loading, monthlyDealers])

  // ── Guard — nothing renders until user resolves ───────────
  if (!user) return null

  // ── Derived display values (safe — user guaranteed here) ─
  const initials  = user.staff_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
  const roleLabel = getRoleLabel(user.staff_roletype)
  const roleCls   = getRoleBadgeCls(user.staff_roletype)

  const STAT_CARDS = [
    { label: "Total Orders",   fmt: String(stats.myOrders),          badge: "badge-purple", badgeLabel: "All time" },
    { label: "Pending Orders", fmt: String(stats.pendingOrders),     badge: "badge-amber",  badgeLabel: "Action needed" },
    { label: "My Dealers",     fmt: String(stats.myDealers),         badge: "badge-blue",   badgeLabel: "Assigned" },
    { label: "Total Revenue",  fmt: fmtCurrency(stats.totalRevenue), badge: "badge-green",  badgeLabel: "₹" + stats.totalRevenue.toLocaleString("en-IN") },
  ]

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; }
        .root { min-height: 100vh; background: #f0f2f5; color: #111827; font-family: 'DM Sans', sans-serif; }

        /* ── Sidebar ── */
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

        /* ── Overlay ── */
        .overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.5); backdrop-filter: blur(3px); opacity: 0; pointer-events: none; transition: opacity .28s; }
        .overlay.show { opacity: 1; pointer-events: all; }

        /* ── Topbar ── */
        .topbar { position: sticky; top: 0; z-index: 20; height: 62px; padding: 0 22px; background: linear-gradient(to right,#1f4b8d,#0d0c16); border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; gap: 12px; }
        .hamburger { flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; transition: background .15s; }
        .hamburger:hover { background: rgba(255,255,255,0.12); }
        .topbar-title { font-size: 15px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .topbar-sub   { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 1px; }

        /* ── Content ── */
        .content { padding: 24px 22px; max-width: 1440px; margin: 0 auto; }
        .page-heading { font-size: 20px; font-weight: 600; color: #111827; padding: 18px 22px 0; }

        /* ── Profile card ── */
        .profile-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 22px; margin-bottom: 16px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
        .profile-avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; color: #fff; flex-shrink: 0; }
        .profile-name  { font-size: 17px; font-weight: 600; color: #111827; }
        .profile-email { font-size: 12px; color: #6b7280; margin-top: 3px; }
        .profile-chips { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 8px; }
        .chip { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }

        /* ── Badge colours ── */
        .badge-purple { background: #ede9fe; color: #7c3aed; }
        .badge-green  { background: #d1fae5; color: #059669; }
        .badge-amber  { background: #fef3c7; color: #b45309; }
        .badge-blue   { background: #dbeafe; color: #1d4ed8; }
        .badge-red    { background: #fee2e2; color: #dc2626; }

        /* ── Stat Cards ── */
        .info-cards { display: grid; grid-template-columns: repeat(auto-fill,minmax(200px,1fr)); gap: 14px; margin-bottom: 20px; }
        .icard { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px 20px; transition: box-shadow .2s, transform .2s; }
        .icard:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.07); transform: translateY(-2px); }
        .icard-lbl   { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; }
        .icard-val   { font-size: 22px; font-weight: 600; color: #111827; letter-spacing: -.03em; font-family: 'DM Mono', monospace; line-height: 1.1; }
        .icard-badge { display: inline-flex; align-items: center; gap: 3px; margin-top: 9px; padding: 2px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 600; }

        /* ── Charts ── */
        .charts-row { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 16px; }
        @media (min-width: 900px) { .charts-row { grid-template-columns: 1fr 1fr; } }

        .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 22px; margin-bottom: 16px; }
        .panel-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
        .panel-title  { font-size: 13.5px; font-weight: 600; color: #111827; }
        .panel-sub    { font-size: 11.5px; color: #9ca3af; margin-top: 2px; }
        .chart-wrap   { position: relative; width: 100%; height: 260px; }
        .chart-empty  { display: flex; align-items: center; justify-content: center; height: 260px; color: #9ca3af; font-size: 13px; }
        .legend { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .leg    { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6b7280; }
        .leg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

        /* ── Reports ── */
        .reports-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        @media (max-width: 640px) { .reports-row { grid-template-columns: 1fr; } }
        .report-item  { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
        .report-item:last-child { border-bottom: none; }
        .report-name  { font-size: 12.5px; color: #374151; font-family: 'DM Mono', monospace; }
        .report-value { font-size: 12.5px; font-weight: 600; color: #111827; font-family: 'DM Mono', monospace; }
        .report-empty { font-size: 13px; color: #9ca3af; padding: 12px 0; }
        .section-head { font-size: 11px; font-weight: 600; color: #fff; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 12px; background: #c8cacc; padding: 7px 10px; border-radius: 6px; }

        .loading-pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .sb-nav::-webkit-scrollbar { width: 5px; }
        .sb-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      `}</style>

      <div className="root">
        <div className={`overlay${sidebarOpen ? " show" : ""}`} onClick={() => setSidebarOpen(false)} />

        {/* ── Sidebar ── */}
        {/* <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="sb-user">
            <div className="sb-avatar-row">
              <div className="sb-avatar">{initials}</div>
              <div style={{ minWidth: 0 }}>
                <div className="sb-uname">{user.staff_name}</div>
                <div className="sb-meta">{user.staff_email || "—"}</div>
              </div>
            </div>
            <div className="sb-chips">
              <span className="sb-chip sc-role">{roleLabel}</span>
              {user.staff_designation?.trim() && (
                <span className="sb-chip sc-desg">{user.staff_designation.trim()}</span>
              )}
              {user.staff_location && (
                <span className="sb-chip sc-loc">📍 {user.staff_location}</span>
              )}
            </div>
          </div>

          <nav className="sb-nav">
            {STAFF_NAV.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`sb-link${pathname === item.href ? " active" : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                {item.icon}{item.label}
              </Link>
            ))}
          </nav>

          <div className="sb-foot">
            <button className="sb-logout" onClick={handleLogout}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </aside> */}

        {/* ── Main ── */}
        <div>
          {/* <header className="topbar">
            <button className="hamburger" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar">
              {sidebarOpen
                ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
              }
            </button>
            <img src={logoImage} alt="Logo" style={{ height: 44, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div className="topbar-title">
                Welcome, {user.staff_name.split(" ")[0]}
              </div>
              <div className="topbar-sub">
                {[user.staff_location, roleLabel, `ID: ${user.staff_id}`].filter(Boolean).join(" · ")}
              </div>
            </div>
          </header> */}

          <div className="page-heading">Staff Dashboard</div>

          <main className="content">

            {/* ── Profile Card ── */}
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

            {/* ── Stat Cards ── */}
            <div className="info-cards">
              {STAT_CARDS.map(card => (
                <div className="icard" key={card.label}>
                  <div className="icard-lbl">{card.label}</div>
                  <div className="icard-val">{card.fmt}</div>
                  <div className={`icard-badge ${card.badge}`}>{card.badgeLabel}</div>
                </div>
              ))}
            </div>

            {/* ── Charts ── */}
            <div className="charts-row">
              <div className="panel" style={{ marginBottom: 0 }}>
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Monthly Orders</div>
                    <div className="panel-sub">Order count per month</div>
                  </div>
                  <div className="legend">
                    <span className="leg">
                      <span className="leg-dot" style={{ background: "rgba(99,102,241,0.78)" }} />Orders
                    </span>
                  </div>
                </div>
                {loading ? (
                  <div className="chart-empty loading-pulse">Loading chart…</div>
                ) : monthlyOrders.month.length === 0 ? (
                  <div className="chart-empty">No order data available</div>
                ) : (
                  <div className="chart-wrap"><canvas ref={barRef1} /></div>
                )}
              </div>

              <div className="panel" style={{ marginBottom: 0 }}>
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Monthly Revenue</div>
                    <div className="panel-sub">Revenue per month</div>
                  </div>
                  <div className="legend">
                    <span className="leg">
                      <span className="leg-dot" style={{ background: "rgba(245,158,11,0.78)" }} />Revenue
                    </span>
                  </div>
                </div>
                {loading ? (
                  <div className="chart-empty loading-pulse">Loading chart…</div>
                ) : monthlyDealers.month.length === 0 ? (
                  <div className="chart-empty">No revenue data available</div>
                ) : (
                  <div className="chart-wrap"><canvas ref={barRef2} /></div>
                )}
              </div>
            </div>

            {/* ── Reports ── */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Reports</div>
                  <div className="panel-sub">Top performing orders and dealers this period</div>
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
                  ) : topDealers.length > 0 ? topDealers.map((dealer, i) => (
                    <div key={i} className="report-item">
                      <span className="report-name">{dealer.Dealer_Name}</span>
                      <span className="report-value">₹{Number(dealer.total).toLocaleString("en-IN")}</span>
                    </div>
                  )) : <div className="report-empty">No data available</div>}
                </div>
              </div>
            </div>

          </main>
        </div>
      </div>
    </>
  )
}