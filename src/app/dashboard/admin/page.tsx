"use client";

import { LayoutDashboard, UserRoundPlus, Users, SquareUser, Plus, ClipboardList } from 'lucide-react';

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const year = new Date().getFullYear();

type Item = {
  order_id: string;
  total: string;
};

type Dealer = {
  Dealer_Name: string;
  total: string;
};

type AdminStats = {
  dealerCount: number;
  staffCount: number;
  orderCount: number;
  PorderCount: number;
};

type AdminUser = {
  username?: string;
  email?: string;
  role?: string;
  name?: string;
};

const logoImage = "https://omsonsapp.vercel.app/headicon.png";


const NAV_ITEMS = [
  {
    label: "Dealer List",
    href: "/Dashboard/admin/dealer/DealerList",
    icon: <LayoutDashboard />
  },
  {
    label: "Add Dealer",
    href: "/Dashboard/admin/dealer/AddDealerForm",
    icon: <UserRoundPlus />
  },
  {
    label: "Staff List",
    href: "/Dashboard/admin/staff/stafflist",
    icon: <Users />
  },
  {
    label: "Add Staff",
    href: "/Dashboard/admin/staff/addstaff",
    icon: <SquareUser />
  },
  {
    label: "Products  ",
    href: "/Pages/products",
    icon: <SquareUser />
  },
  {
    label: "Add products",
    href: "/Pages/products/addproducts",
    icon: <SquareUser />
  },
  { label: "Order List",
     href: "/Pages/Ordermanagement", 
     icon: <ClipboardList size={15} /> 
  },
  { label: "Pending Orders",
     href: "/Pages/Ordermanagement/outstandingorders",
    icon: <ClipboardList size={15} /> 
  },
];

const STAT_CONFIG = [
  { key: "PorderCount", label: "Pending Orders", color: "#f59e0b" },
  { key: "dealerCount", label: "Total Dealers", color: "#10b981" },
  { key: "orderCount", label: "Total Orders", color: "#3b82f6" },
  { key: "staffCount", label: "Total Staff", color: "#8b5cf6" },
];

export default function AdminDashboard() {
  const router = useRouter();
  const pathname = usePathname();

  const [data, setData] = useState<Item[]>([]);
  const [dealerData, setDealerData] = useState<Dealer[]>([]);
  const [adminData, setAdminData] = useState<AdminStats>({
    dealerCount: 0,
    staffCount: 0,
    orderCount: 0,
    PorderCount: 0,
  });
  const [adminUser, setAdminUser] = useState<AdminUser>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load admin user from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const adminRaw = localStorage.getItem("AdminData") || localStorage.getItem("admin") || "{}";
      const adminParsed: AdminUser = JSON.parse(adminRaw);
      setAdminUser(adminParsed);
    } catch (err) {
      console.error("Error loading admin data from localStorage:", err);
    }
  }, []);

  // Fetch dashboard data
  useEffect(() => {
    async function fetchData() {
      try {
        const [orderRes, dealerRes, staffRes] = await Promise.all([
          fetch(`${BACKEND_URL}/getMonthlyreporttoporder`),
          fetch(`${BACKEND_URL}/getMonthlyreporttopdealer`),
          fetch(`${BACKEND_URL}/dealercount`),
        ]);

        const orderJson = await orderRes.json();
        const dealerJson = await dealerRes.json();
        const staffJson = await staffRes.json();

        setData(orderJson.top || []);
        setDealerData(dealerJson.top || []);

        // Handle staffJson.data - could be array or object
        const statsData = Array.isArray(staffJson.data) ? staffJson.data[0] : staffJson.data;
        setAdminData(statsData || {
          dealerCount: 0,
          staffCount: 0,
          orderCount: 0,
          PorderCount: 0,
        });
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const chartData = data.map((item) => ({
    name: `${item.order_id}`,
    value: Number(item.total),
  }));

  const dealerChartData = dealerData.map((dealer) => ({
    name: dealer.Dealer_Name.substring(0, 12),
    value: Number(dealer.total),
  }));

  const handleLogout = () => {
    localStorage.clear();
    router.push("/auth/login");
  };

  const initials = (adminUser.name || adminUser.username || "Admin")
    .split(" ")
    .map((n: string) => n.charAt(0))
    .join("")
    .toUpperCase()
    .substring(0, 2) || "AD";

  
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; }
        .root { min-height: 100vh; background: #f0f2f5; color: #111827; font-family: 'DM Sans', sans-serif; }

        /* ── Sidebar ─────────────────────────────── */
        .sidebar {
          position: fixed;
          top: 0; left: 0; bottom: 0;
          width: 256px;
          z-index: 40;
          background: #0d0c16;
          display: flex;
          flex-direction: column;
          transform: translateX(-100%);
          transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform;
        }
        .sidebar.open { transform: translateX(0); }

        .sb-head { padding: 26px 22px 18px; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .sb-chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; background: rgba(99,102,241,0.16); color: #818cf8; font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px; }
        .sb-title { font-size: 17px; font-weight: 600; color: #fff; letter-spacing: -.3px; }

        .sb-user { margin: 14px 14px 0; padding: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; }
        .sb-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 8px; }
        .sb-uname { font-size: 13px; font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-meta  { font-size: 10.5px; color: #475569; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-role  { margin-top: 6px; display: inline-block; font-size: 10px; font-family: 'DM Mono', monospace; background: rgba(99,102,241,0.18); color: #a5b4fc; padding: 2px 8px; border-radius: 6px; }

        .sb-nav { flex: 1; padding: 10px; margin-top: 10px; overflow-y: auto; }
        .sb-link { display: flex; align-items: center; gap: 11px; padding: 10px 13px; border-radius: 11px; font-size: 13.5px; font-weight: 500; color: #64748b; text-decoration: none; margin-bottom: 2px; transition: background .16s, color .16s; }
        .sb-link:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
        .sb-link.active { background: rgba(99,102,241,0.18); color: #a5b4fc; }

        .sb-foot { padding: 14px; border-top: 1px solid rgba(255,255,255,0.07); }
        .sb-logout { width: 100%; padding: 9px 14px; border-radius: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.09); font-size: 13px; font-weight: 500; color: #475569; cursor: pointer; font-family: inherit; transition: all .16s; }
        .sb-logout:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.28); color: #f87171; }

        /* ── Overlay ─────────────────────────────── */
        .overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.5); backdrop-filter: blur(3px); opacity: 0; pointer-events: none; transition: opacity .28s; }
        .overlay.show { opacity: 1; pointer-events: all; }

        /* ── Main ────────────────────────────────── */
        .main { transition: padding-left .28s cubic-bezier(.4,0,.2,1); }

        /* ── Topbar ──────────────────────────────── */
        .topbar { position: sticky; top: 0; z-index: 20; height: 62px; padding: 0 22px; background: linear-gradient(to right, #1f4b8dff, #0d0c16); backdrop-filter: blur(18px); border-bottom: 1px solid #e0e3e8; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .topbar-l { display: flex; align-items: center; gap: 13px; min-width: 0; }
        .hamburger { flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px; border: 1px solid #dde1e8; background: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #374151; transition: background .15s; }
        .hamburger:hover { background: #f3f4f6; }
        .topbar-title { font-size: 15px; font-weight: 600; color: #ffffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .topbar-sub   { font-size: 11px; color: #ffffffff; letter-spacing: .04em; margin-top: 1px; }
        .btn-add { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 22px; background: #0d0c16; color: #fff; font-size: 13px; font-weight: 500; text-decoration: none; transition: opacity .16s, transform .16s; white-space: nowrap; }
        .btn-add:hover { opacity: .82; transform: translateY(-1px); }

        /* ── Content ─────────────────────────────── */
        .content { padding: 24px 22px; max-width: 1440px; margin: 0 auto; }

        /* ── Stat Cards ──────────────────────────── */
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px; }
        .stat-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px 20px; transition: box-shadow .2s, transform .2s; }
        .stat-card:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.07); transform: translateY(-2px); }
        .stat-lbl { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; }
        .stat-val { font-size: 28px; font-weight: 700; color: #111827; letter-spacing: -.03em; font-family: 'DM Mono', monospace; line-height: 1; }
        .stat-badge { display: inline-flex; align-items: center; gap: 3px; margin-top: 9px; padding: 2px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 600; }
        .badge-amber  { background: #fef3c7; color: #b45309; }
        .badge-green  { background: #d1fae5; color: #059669; }
        .badge-blue   { background: #dbeafe; color: #1d4ed8; }
        .badge-purple { background: #ede9fe; color: #7c3aed; }

        /* ── Charts row ──────────────────────────── */
        .charts-row { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 16px; }
        @media (min-width: 900px) { .charts-row { grid-template-columns: 1fr 1fr; } }

        /* ── Panel ───────────────────────────────── */
        .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 22px; }
        .panel-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
        .panel-title  { font-size: 13.5px; font-weight: 600; color: #111827; }
        .panel-sub    { font-size: 11.5px; color: #9ca3af; margin-top: 2px; }
        .chart-canvas { height: 260px; width: 100%; }

        /* Legend */
        .legend { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .leg { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6b7280; }
        .leg-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

        /* ── Reports row ─────────────────────────── */
        .reports-row { display: grid; grid-template-columns: 1fr; gap: 16px; }
        @media (min-width: 900px) { .reports-row { grid-template-columns: 1fr 1fr; } }

        .report-section h3 { font-size: 11.5px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 12px; }
        .report-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
        .report-item:last-child { border-bottom: none; }
        .report-name { color: #374151; font-weight: 500; }
        .report-value { color: #111827; font-weight: 600; font-family: 'DM Mono', monospace; }
        .report-loading { padding: 20px; text-align: center; color: #9ca3af; }

        /* Scrollbar */
        .sb-nav::-webkit-scrollbar { width: 6px; }
        .sb-nav::-webkit-scrollbar-track { background: transparent; }
        .sb-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      `}</style>

      <div className="root">
        {/* Overlay */}
        <div
          className={`overlay${sidebarOpen ? " show" : ""}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />

        {/* ── Sidebar ── */}
        {/* <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="sb-head">
            <div className="sb-chip">Admin Portal</div>
            <div className="sb-title">Workspace</div>
          </div>

          <div className="sb-user">
            <div className="sb-avatar">{loading ? "…" : initials}</div>
            <div className="sb-uname">{loading ? "Loading…" : (adminUser.name || adminUser.username || "Administrator")}</div>
            <div className="sb-meta">{adminUser.email || "admin@omsons.com"}</div>
            {adminUser.role && (
              <span className="sb-role">{adminUser.role}</span>
            )}
          </div>

          <nav className="sb-nav">
            {NAV_ITEMS.map((item) => (
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
            <button className="sb-logout" onClick={handleLogout}>Sign out</button>
          </div>
        </aside> */}

        {/* ── Main ── */}
        <div className="main">
          {/* <header className="topbar bg-linear from-bg-blue-500 to-bg-blue-600">
            <div className="topbar-l">
              <button
                className="hamburger"
                onClick={() => setSidebarOpen(v => !v)}
                aria-label="Toggle sidebar"
              >
                {sidebarOpen
                  ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
                }
              </button>
              <img src={logoImage} alt="amazonLogo" className="h-12" />
              <div style={{ minWidth: 0 }}>
                <div className="topbar-title">
                  {loading ? "Dashboard" : `Welcome, ${adminUser.name || adminUser.username || 'Admin'}`}
                </div>
                <div className="topbar-sub">System administration dashboard</div>
              </div>
            </div>
          </header> */}

          <main className="content">

            {/* ── Stat Cards ── */}
            <div className="stat-grid">
              {STAT_CONFIG.map((stat) => {
                const value = adminData[stat.key as keyof AdminStats] || 0;
                const badgeClass = stat.key === "PorderCount" ? "badge-amber" :
                  stat.key === "dealerCount" ? "badge-green" :
                    stat.key === "orderCount" ? "badge-blue" : "badge-purple";

                return (

                  <div key={stat.key} className="stat-card">
                    <div className="stat-lbl">{stat.label}</div>
                    <div className="stat-val">{loading ? "—" : value}</div>
                    <div className={`stat-badge ${badgeClass}`}>{value.toLocaleString("en-IN")}</div>
                  </div>

                );
              })}
              <div className="stat-card"><div className="stat-lbl">Today's Sale</div>
                <div className="stat-val">₹0</div>
                <div className="stat-badge badge-green">0</div></div>
            </div>

            {/* ── Charts ── */}
            <div className="charts-row">

              {/* Chart 1 — Top Orders */}
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Top Orders</div>
                    <div className="panel-sub">Order value distribution</div>
                  </div>
                  <div className="legend">
                    <span className="leg">
                      <span className="leg-dot" style={{ background: "rgba(99,102,241,0.78)" }} />
                      Order Value
                    </span>
                  </div>
                </div>
                <div className="chart-canvas">
                  {loading ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
                      Loading chart...
                    </div>
                  ) : data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e1b4b", border: "1px solid #4f46e5", borderRadius: "8px" }}
                          labelStyle={{ color: "#c7d2fe" }}
                          formatter={(value) => `₹${Number(value).toLocaleString("en-IN")}`}
                        />
                        <Bar dataKey="value" fill="rgba(99,102,241,0.78)" radius={[7, 7, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
                      No data available
                    </div>
                  )}
                </div>
              </div>

              {/* Chart 2 — Top Dealers */}
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Top Dealers</div>
                    <div className="panel-sub">Dealer performance ranking</div>
                  </div>
                  <div className="legend">
                    <span className="leg">
                      <span className="leg-dot" style={{ background: "rgba(159,122,234,0.78)" }} />
                      Total Value
                    </span>
                  </div>
                </div>
                <div className="chart-canvas">
                  {loading ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
                      Loading chart...
                    </div>
                  ) : dealerData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dealerChartData}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e1b4b", border: "1px solid #4f46e5", borderRadius: "8px" }}
                          labelStyle={{ color: "#c7d2fe" }}
                          formatter={(value) => `₹${Number(value).toLocaleString("en-IN")}`}
                        />
                        <Bar dataKey="value" fill="rgba(159,122,234,0.78)" radius={[7, 7, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
                      No data available
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Reports ── */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Reports</div>
                  <div className="panel-sub">Top performing orders and dealers</div>
                </div>
              </div>

              <div className="reports-row">
                {/* Top Orders */}
                <div>
                  <h3 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffffff", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "12px", background: "#d0d0d0ff", padding: "7px", borderRadius: "5px" }}>
                    Top Orders
                  </h3>
                  {loading ? (
                    <div className="report-loading">Loading...</div>
                  ) : data.length > 0 ? (
                    data.map((item) => (
                      <div key={item.order_id} className="report-item">
                        <span className="report-name">OM/{year}/{item.order_id}</span>
                        <span className="report-value">
                          ₹{Number(item.total).toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="report-loading">No data available</div>
                  )}
                </div>

                {/* Top Dealers */}
                <div className="">
                  <h3 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffffff", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "12px", background: "#d0d0d0ff", padding: "7px", borderRadius: "5px" }}>
                    Top Dealers
                  </h3>
                  {loading ? (
                    <div className="report-loading">Loading...</div>
                  ) : dealerData.length > 0 ? (
                    dealerData.map((dealer, index) => (
                      <div key={index} className="report-item">
                        <span className="report-name">{dealer.Dealer_Name}</span>
                        <span className="report-value">
                          ₹{Number(dealer.total).toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="report-loading">No data available</div>
                  )}
                </div>
              </div>
            </div>

          </main>
        </div>
      </div>
    </>
  );
}