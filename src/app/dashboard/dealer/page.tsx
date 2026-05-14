"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { CiSearch } from "react-icons/ci";

// ── Types ─────────────────────────────────────────────────────────────────────
type DealerData = {
  Dealer_Id: string; Dealer_Name: string; Dealer_Email: string; Dealer_Number: string;
  Dealer_City: string; Dealer_Address: string; Dealer_Pincode: string;
  Dealer_Dealercode: string; Dealer_Image: string; annualtarget: string;
  currentlimit: string; creditdays: string; discount: string;
  gst: string; status: string; assignedstaff: string; staffname: string; Dealer_shipto: string;
};

type MonthlyData = { month: string; totalorders: number; totalvalue: number };
type FunnelStage = { label: string; value: number; pct: number; color: string };

const EMPTY_DEALER: DealerData = {
  Dealer_Id: "", Dealer_Name: "", Dealer_Email: "", Dealer_Number: "",
  Dealer_City: "", Dealer_Address: "", Dealer_Pincode: "", Dealer_Dealercode: "",
  Dealer_Image: "", annualtarget: "0", currentlimit: "0", creditdays: "0",
  discount: "0", gst: "", status: "0", assignedstaff: "", staffname: "", Dealer_shipto: "",
};

const logoImage = "http://sapoms.com/images/Omsons%20-%20White.png";

const NAV_ITEMS = [
  { label: "Home",      href: "/home",               icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
  { label: "Add Order", href: "/dashboard/dealer/AddOrderForm",  icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg> },
];

function fmtCurrency(n: number) {
  if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n}`;
}
function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

async function safeFetch(url: string, options: RequestInit = {}) {
  const res  = await fetch(url, options);
  const text = await res.text();
  try { return JSON.parse(text); } catch (_) {}
  const cleaned = text.replace(/^[\s\S]*?(\{|\[)/, (_, ch) => ch);
  try { return JSON.parse(cleaned); } catch (_) {}
  const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])(?=[^}\]]*$)/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
  throw new Error(`Could not parse response from ${url}`);
}

// ── Normalise the { month: [...], total: [...] } shape the API returns ────────
function normaliseMonthlyResponse(data: any, valueKey: "orders" | "value"): MonthlyData[] {
  if (!data) return [];

  const months: any[] = Array.isArray(data.month)
    ? data.month
    : Array.isArray(data.months)
    ? data.months
    : Object.values(data.month ?? data.months ?? {});

  const totals: any[] = Array.isArray(data.total)
    ? data.total
    : Array.isArray(data.totals)
    ? data.totals
    : Object.values(data.total ?? data.totals ?? {});

  if (!months.length || !totals.length) return [];

  return months.map((m: any, idx: number) => {
    const raw = parseFloat(String(totals[idx] ?? 0));
    const val = isNaN(raw) ? 0 : raw;
    return {
      month:       String(m).trim(),
      totalorders: valueKey === "orders" ? val : 0,
      totalvalue:  valueKey === "value"  ? val : 0,
    };
  });
}

export default function DealerDashboard() {
  const router   = useRouter();
  const pathname = usePathname();

  // Chart refs — one per canvas, one per Chart.js instance
  const barRef   = useRef<HTMLCanvasElement | null>(null);
  const barChart = useRef<any>(null);
  const lineRef  = useRef<HTMLCanvasElement | null>(null);
  const lineChart = useRef<any>(null);

  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [dealer,        setDealer]        = useState<DealerData>(EMPTY_DEALER);
  const [monthlyOrders, setMonthlyOrders] = useState<MonthlyData[]>([]);
  const [monthlyValues, setMonthlyValues] = useState<MonthlyData[]>([]);
  const [funnel,        setFunnel]        = useState<FunnelStage[]>([]);

  // ── Data fetch ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    (async () => {
      try {
        const raw    = localStorage.getItem("UserData") || localStorage.getItem("user") || "{}";
        const parsed: DealerData = JSON.parse(raw);
        setDealer({ ...EMPTY_DEALER, ...parsed });

        const dealerId = parsed.Dealer_Id;
        if (!dealerId) { setLoading(false); return; }

        const fd = new FormData();
        fd.append("id", dealerId);  // ← was "dealer_id", endpoints expect "id"

        const API = "https://mirisoft.co.in/sas/dealerapi/api";
        const [ordersData, valuesData] = await Promise.allSettled([
          safeFetch(`${API}/getMonthlyreporttotalorderdealer`, { method: "POST", body: fd }),
          safeFetch(`${API}/getMonthlyreporttotalvaluedealer`, { method: "POST", body: fd }),
        ]);

        if (ordersData.status === "fulfilled") {
          const rows = normaliseMonthlyResponse(ordersData.value, "orders");
          
          setMonthlyOrders(rows);
        } else {
          console.error("[orders] fetch failed:", ordersData.reason);
        }

        if (valuesData.status === "fulfilled") {
          const rows = normaliseMonthlyResponse(valuesData.value, "value");
         
          setMonthlyValues(rows);
        } else {
          console.error("[values] fetch failed:", valuesData.reason);
        }

        // Funnel from dealer data
        const annual  = Number(parsed.annualtarget) || 0;
        const current = Number(parsed.currentlimit)  || 0;
        setFunnel([
          { label: "Annual Target", value: annual,  pct: 100, color: "#4f46e5" },
          { label: "Current Limit", value: current, pct: annual > 0 ? Math.round((current / annual) * 100) : 0, color: "#6366f1" },
        ]);
      } catch (err) {
        console.error("[DealerDashboard] top-level error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (loading || monthlyOrders.length === 0) return;

    // rAF ensures the canvas element is painted into the DOM before Chart.js accesses it
    const raf = requestAnimationFrame(async () => {
      if (!barRef.current) return;
      const { default: Chart } = await import("chart.js/auto");

      if (barChart.current) {
        barChart.current.data.labels = monthlyOrders.map(m => m.month);
        barChart.current.data.datasets[0].data = monthlyOrders.map(m => m.totalorders);
        barChart.current.update("active");
        return;
      }

      barChart.current = new Chart(barRef.current, {
        type: "bar",
        data: {
          labels:   monthlyOrders.map(m => m.month),
          datasets: [{
            label: "Total Orders",
            data:  monthlyOrders.map(m => m.totalorders),
            backgroundColor:      "rgba(99,102,241,0.78)",
            hoverBackgroundColor: "#4f46e5",
            borderRadius: 7,
            borderSkipped: false,
            barPercentage: 0.58,
            categoryPercentage: 0.68,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#1e1b4b", titleColor: "#c7d2fe", bodyColor: "#e0e7ff",
              padding: 10, cornerRadius: 8,
              callbacks: { label: ctx => ` Orders: ${ctx.raw}` },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#9ca3af", font: { size: 11 } }, border: { display: false } },
            y: { grid: { color: "rgba(156,163,175,0.13)" }, border: { display: false }, ticks: { color: "#9ca3af", font: { size: 11 } } },
          },
        },
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, monthlyOrders]);

  // Destroy bar chart only on unmount
  useEffect(() => () => { barChart.current?.destroy(); }, []);

  useEffect(() => {
    if (loading || monthlyValues.length === 0) return;

    const raf = requestAnimationFrame(async () => {
      if (!lineRef.current) return;
      const { default: Chart } = await import("chart.js/auto");

      if (lineChart.current) {
        lineChart.current.data.labels = monthlyValues.map(m => m.month);
        lineChart.current.data.datasets[0].data = monthlyValues.map(m => m.totalvalue);
        lineChart.current.update("active");
        return;
      }

      lineChart.current = new Chart(lineRef.current, {
        type: "line",
        data: {
          labels:   monthlyValues.map(m => m.month),
          datasets: [{
            label: "Total Value (₹)",
            data:  monthlyValues.map(m => m.totalvalue),
            borderColor:          "#f59e0b",
            backgroundColor:      "rgba(245,158,11,0.17)",
            tension:              0.44,
            fill:                 true,
            pointRadius:          3,
            pointBackgroundColor: "#f59e0b",
            pointBorderColor:     "#fff",
            pointBorderWidth:     2,
            borderWidth:          2.5,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: "top" },
            tooltip: {
              backgroundColor: "#0f0e17", titleColor: "#e0e7ff", bodyColor: "#c7d2fe",
              padding: 12, cornerRadius: 10,
              callbacks: { label: ctx => ` ₹${(ctx.raw as number).toLocaleString("en-IN")}` },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#9ca3af", font: { size: 10 } }, border: { display: false } },
            y: {
              grid: { color: "rgba(156,163,175,0.13)" }, border: { display: false },
              ticks: { color: "#9ca3af", font: { size: 11 }, callback: v => `₹${Number(v).toLocaleString("en-IN")}` },
            },
          },
        },
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, monthlyValues]);

  // Destroy line chart only on unmount
  useEffect(() => () => { lineChart.current?.destroy(); }, []);

  const annualTarget = Number(dealer.annualtarget) || 0;
  const currentLimit = Number(dealer.currentlimit)  || 0;
  const creditDays   = Number(dealer.creditdays)    || 0;
  const discountPct  = Number(dealer.discount)      || 0;
  const outstanding  = currentLimit;
  const usagePct     = annualTarget > 0 ? Math.min(100, Math.round((currentLimit / annualTarget) * 100)) : 0;
  const initials     = dealer.Dealer_Name?.trim()?.charAt(0)?.toUpperCase() || dealer.Dealer_Email?.trim()?.charAt(0)?.toUpperCase() || "D";

  const handleLogout = () => { localStorage.clear(); router.push("/auth/login"); };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; }
        .root { min-height: 100vh; background: #f0f2f5; color: #111827; font-family: 'DM Sans', sans-serif; }

        .sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 256px; z-index: 40; background: #0d0c16; display: flex; flex-direction: column; transform: translateX(-100%); transition: transform 0.28s cubic-bezier(0.4,0,0.2,1); will-change: transform; }
        .sidebar.open { transform: translateX(0); }
        .sb-user { margin: 18px 14px 0; padding: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; }
        .sb-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 8px; }
        .sb-uname { font-size: 13px; font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-meta  { font-size: 10.5px; color: #475569; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-code  { margin-top: 6px; display: inline-block; font-size: 10px; font-family: 'DM Mono', monospace; background: rgba(99,102,241,0.18); color: #a5b4fc; padding: 2px 8px; border-radius: 6px; }
        .sb-nav   { flex: 1; padding: 10px; margin-top: 10px; overflow-y: auto; }
        .sb-link  { display: flex; align-items: center; gap: 11px; padding: 10px 13px; border-radius: 11px; font-size: 13.5px; font-weight: 500; color: #64748b; text-decoration: none; margin-bottom: 2px; transition: background .16s, color .16s; }
        .sb-link:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
        .sb-link.active { background: rgba(99,102,241,0.18); color: #a5b4fc; }
        .sb-foot { padding: 14px; border-top: 1px solid rgba(255,255,255,0.07); }
        .sb-logout { width: 100%; padding: 9px 14px; border-radius: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.09); font-size: 13px; font-weight: 500; color: #475569; cursor: pointer; font-family: inherit; transition: all .16s; }
        .sb-logout:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.28); color: #f87171; }

        .overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.5); backdrop-filter: blur(3px); opacity: 0; pointer-events: none; transition: opacity .28s; }
        .overlay.show { opacity: 1; pointer-events: all; }

        .topbar { position: sticky; top: 0; z-index: 20; height: 62px; padding: 0 22px; background: linear-gradient(to right,#1f4b8d,#0d0c16); border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; gap: 12px; }
        .hamburger { flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; transition: background .15s; }
        .hamburger:hover { background: rgba(255,255,255,0.12); }
        .topbar-title { font-size: 15px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .topbar-sub   { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 1px; }
        .search-wrap { flex: 1; max-width: 480px; margin: 0 16px; display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.09); border: 1px solid rgba(255,255,255,0.13); border-radius: 10px; padding: 0 12px; height: 38px; }
        .search-wrap svg { color: rgba(255,255,255,0.45); flex-shrink: 0; }
        .search-input { background: transparent; border: none; outline: none; font-size: 13.5px; color: #fff; flex: 1; font-family: 'DM Sans', sans-serif; }
        .search-input::placeholder { color: rgba(255,255,255,0.35); }

        .content { padding: 24px 22px; max-width: 1440px; margin: 0 auto; }
        .page-heading { font-size: 20px; font-weight: 600; color: #111827; padding: 18px 22px 0; }

        .info-cards { display: grid; grid-template-columns: repeat(auto-fill,minmax(200px,1fr)); gap: 14px; margin-bottom: 20px; }
        .icard { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px 20px; transition: box-shadow .2s, transform .2s; }
        .icard:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.07); transform: translateY(-2px); }
        .icard-lbl   { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; }
        .icard-val   { font-size: 22px; font-weight: 600; color: #111827; letter-spacing: -.03em; font-family: 'DM Mono', monospace; line-height: 1.1; }
        .icard-sub   { font-size: 11.5px; color: #6b7280; margin-top: 5px; }
        .icard-badge { display: inline-flex; align-items: center; gap: 3px; margin-top: 9px; padding: 2px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 600; }
        .badge-purple { background: #ede9fe; color: #7c3aed; }
        .badge-green  { background: #d1fae5; color: #059669; }
        .badge-amber  { background: #fef3c7; color: #b45309; }
        .badge-blue   { background: #dbeafe; color: #1d4ed8; }

        .charts-row { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 16px; }
        @media (min-width: 900px) { .charts-row { grid-template-columns: 1fr 1fr; } }
        .bottom-row { display: grid; grid-template-columns: 1fr; gap: 16px; }
        @media (min-width: 900px) { .bottom-row { grid-template-columns: 1fr 1fr; } }

        .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 22px; }
        .panel-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
        .panel-title  { font-size: 13.5px; font-weight: 600; color: #111827; }
        .panel-sub    { font-size: 11.5px; color: #9ca3af; margin-top: 2px; }

        /* CRITICAL — chart canvas wrapper must be position:relative with explicit height */
        .chart-wrap { position: relative; width: 100%; height: 260px; }

        .legend { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .leg     { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6b7280; }
        .leg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .chart-empty { display: flex; align-items: center; justify-content: center; height: 260px; color: #9ca3af; font-size: 13px; }

        .outstanding-block   { padding: 10px 0; }
        .outstanding-amount  { font-size: 42px; font-weight: 700; color: #111827; font-family: 'DM Mono', monospace; letter-spacing: -.05em; line-height: 1; }
        .outstanding-sub     { font-size: 13px; color: #6b7280; margin-top: 8px; }
        .progress-bar-wrap   { margin-top: 18px; }
        .progress-label      { display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; margin-bottom: 6px; }
        .progress-track      { height: 8px; background: #f3f4f6; border-radius: 99px; overflow: hidden; }
        .progress-fill       { height: 100%; border-radius: 99px; background: linear-gradient(90deg,#6366f1,#a78bfa); transition: width .6s ease; }
        .credit-meta         { margin-top: 14px; display: flex; gap: 12px; flex-wrap: wrap; }
        .credit-chip         { padding: 4px 11px; border-radius: 20px; font-size: 11px; font-weight: 500; }

        .funnel-body { display: flex; flex-direction: column; gap: 7px; align-items: center; }
        .funnel-row  { display: flex; align-items: center; gap: 10px; width: 100%; }
        .funnel-lbl  { font-size: 11.5px; font-weight: 500; color: #374151; width: 90px; text-align: right; flex-shrink: 0; }
        .funnel-bar-wrap { flex: 1; display: flex; justify-content: center; }
        .funnel-bar  { height: 34px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #fff; clip-path: polygon(3% 0%,97% 0%,100% 100%,0% 100%); transition: filter .15s; }
        .funnel-bar:hover { filter: brightness(1.1); }
        .funnel-val  { font-size: 11px; color: #6b7280; width: 56px; font-family: 'DM Mono', monospace; flex-shrink: 0; }
        .annual-target { margin-top: 18px; padding: 13px 16px; background: linear-gradient(135deg,#f5f3ff,#ede9fe); border: 1px solid #ddd6fe; border-radius: 14px; display: flex; align-items: center; justify-content: space-between; }
        .at-lbl { font-size: 11px; font-weight: 500; color: #7c3aed; }
        .at-val { font-size: 22px; font-weight: 700; color: #6d28d9; font-family: 'DM Mono', monospace; letter-spacing: -.04em; }

        .loading-pulse { animation: pulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
      `}</style>

      <div className="root">
        <div className={`overlay${sidebarOpen ? " show" : ""}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />

        {/* Sidebar */}
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="sb-user">
            <div className="sb-avatar">{loading ? "…" : initials}</div>
            <div className="sb-uname">{loading ? "Loading…" : (dealer.Dealer_Name || "Dealer")}</div>
            <div className="sb-meta">{dealer.Dealer_Email || dealer.Dealer_Number || "—"}</div>
            {dealer.Dealer_Dealercode && <span className="sb-code">{dealer.Dealer_Dealercode}</span>}
          </div>
          <nav className="sb-nav">
            {NAV_ITEMS.map(item => (
              <Link key={item.href} href={item.href} className={`sb-link${pathname === item.href ? " active" : ""}`} onClick={() => setSidebarOpen(false)}>
                {item.icon}{item.label}
              </Link>
            ))}
          </nav>
          <div className="sb-foot">
            <button className="sb-logout" onClick={handleLogout}>Sign out</button>
          </div>
        </aside>

        <div className="main">
          <div className="page-heading">Dealer Dashboard</div>

          <main className="content">

            {/* Info Cards */}
            <div className="info-cards">
              <div className="icard">
                <div className="icard-lbl">Annual Target</div>
                <div className="icard-val">{fmtCurrency(annualTarget)}</div>
                <div className="icard-sub">Full year goal</div>
                <div className="icard-badge badge-purple">₹{annualTarget.toLocaleString("en-IN")}</div>
              </div>
              <div className="icard">
                <div className="icard-lbl">Current Limit</div>
                <div className="icard-val">{fmtCurrency(currentLimit)}</div>
                <div className="icard-sub">Credit ceiling</div>
                <div className="icard-badge badge-blue">{usagePct}% of target</div>
              </div>
              <div className="icard">
                <div className="icard-lbl">Credit Days</div>
                <div className="icard-val">{creditDays}</div>
                <div className="icard-sub">Payment window</div>
                <div className="icard-badge badge-amber">{creditDays} days</div>
              </div>
              <div className="icard">
                <div className="icard-lbl">Discount</div>
                <div className="icard-val">{discountPct}%</div>
                <div className="icard-sub">Dealer discount rate</div>
                <div className="icard-badge badge-green">Active</div>
              </div>
            </div>

            {/* Charts */}
            <div className="charts-row">

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Order Details</div>
                    <div className="panel-sub">Monthly order count</div>
                  </div>
                  <div className="legend">
                    <span className="leg"><span className="leg-dot" style={{ background: "rgba(99,102,241,0.78)" }} />Total Orders</span>
                  </div>
                </div>
                {loading ? (
                  <div className="chart-empty loading-pulse">Loading chart…</div>
                ) : monthlyOrders.length === 0 ? (
                  <div className="chart-empty">No order data available</div>
                ) : (
                  <div className="chart-wrap">
                    <canvas ref={barRef} />
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Sales Analysis — {new Date().getFullYear()}</div>
                    <div className="panel-sub">Monthly revenue trends</div>
                  </div>
                  <div className="legend">
                    <span className="leg"><span className="leg-dot" style={{ background: "#f59e0b" }} />Revenue</span>
                  </div>
                </div>
                {loading ? (
                  <div className="chart-empty loading-pulse">Loading chart…</div>
                ) : monthlyValues.length === 0 ? (
                  <div className="chart-empty">No sales data available</div>
                ) : (
                  <div className="chart-wrap">
                    <canvas ref={lineRef} />
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Row */}
            <div className="bottom-row">

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Outstanding</div>
                    <div className="panel-sub">Current credit limit utilisation</div>
                  </div>
                </div>
                <div className="outstanding-block">
                  <div className="outstanding-amount">₹{outstanding.toLocaleString("en-IN")}</div>
                  <div className="outstanding-sub">of ₹{annualTarget.toLocaleString("en-IN")} annual target</div>
                  <div className="progress-bar-wrap">
                    <div className="progress-label"><span>Used</span><span>{usagePct}%</span></div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${usagePct}%` }} />
                    </div>
                  </div>
                  <div className="credit-meta">
                    <span className="credit-chip badge-amber">Credit: {creditDays} days</span>
                    <span className="credit-chip badge-blue">Discount: {discountPct}%</span>
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Sales Funnel</div>
                    <div className="panel-sub">Pipeline vs annual target</div>
                  </div>
                </div>
                <div className="funnel-body">
                  {funnel.length > 0 ? funnel.map(stage => (
                    <div className="funnel-row" key={stage.label}>
                      <div className="funnel-lbl">{stage.label}</div>
                      <div className="funnel-bar-wrap">
                        <div className="funnel-bar" style={{ width: `${Math.max(stage.pct, 14)}%`, minWidth: 60, background: stage.color }}>
                          {stage.pct}%
                        </div>
                      </div>
                      <div className="funnel-val">{fmtNum(stage.value)}</div>
                    </div>
                  )) : (
                    <div style={{ color: "#9ca3af", textAlign: "center", padding: "20px" }}>
                      {loading ? "Loading funnel…" : "No funnel data"}
                    </div>
                  )}
                </div>
                <div className="annual-target">
                  <div className="at-lbl">Annual Target</div>
                  <div className="at-val">₹{annualTarget.toLocaleString("en-IN")}</div>
                </div>
              </div>
            </div>

          </main>
        </div>
      </div>
    </>
  );
}