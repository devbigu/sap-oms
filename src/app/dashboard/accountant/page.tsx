"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useQueries,
} from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import moment from "moment";
import {
  DollarSign, ShoppingCart, Clock, AlertCircle,
  TrendingUp, Receipt, FileSpreadsheet, Download,
  ChevronDown, X,
} from "lucide-react";
import { isAuthenticated, clearAccountantSession } from "@/lib/accountantauth";
import { downloadOrderInvoice } from "@/lib/invoicegenerator";
import { OrderAmountSource, withDisplayOrderAmounts } from "@/lib/orderAmounts";

// ─── Constants ────────────────────────────────────────────────────────────────
const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const YEAR = new Date().getFullYear();

// ─── Types ────────────────────────────────────────────────────────────────────
type Order = {
  order_id: string; order_date: string; order_amount: string | number;
  order_discount: string | number; Dealer_Name: string;
  orderdata_item_quantity: string; mtstatus: string;
  outstandingDate: string; reason?: string;
  product_name?: string;
  order_dealer?: string | number;
  order_discount_amount?: string | number;
  order_net_amount?: string | number;
  grossAmount?: string | number;
  discountAmount?: string | number;
  netPayableAmount?: string | number;
};

type PendingOrder = {
  order_id: string; order_date: string; orderDate: string;
  order_dealer: string; order_amount: string | number; order_discount: string | number;
  order_status: string; accept_order: string; outstandingDate: string;
  Dealer_Name: string; orderdata_item_quantity: string;
  order_discount_amount?: string | number;
  order_net_amount?: string | number;
  grossAmount?: string | number;
  discountAmount?: string | number;
  netPayableAmount?: string | number;
};

type Stats = { dealerCount: number; staffCount: number; orderCount: number; PorderCount: number };
type ChartOrder  = { order_id: string; total: string };
type ChartDealer = { Dealer_Name: string; total: string };
type LedgerSummary = { netBalance: number };
type LedgerResponse = { data: LedgerSummary[] };
type OrderSummaryOverride = OrderAmountSource & { orderId?: string; order_id?: string };

// ─── CSV Export ───────────────────────────────────────────────────────────────
function downloadCSV(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `${filename}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function ordersToRows(orders: Order[]) {
  return orders.map(o => ({
    "Order No":        `OM/${YEAR}/${o.order_id}`,
    "Date":            moment(o.order_date).format("DD MMM YYYY"),
    "Dealer":          o.Dealer_Name,
    "Gross (₹)":       Number(o.order_amount),
    "Discount (₹)":    Number(o.order_discount),
    "Net (₹)":         Number(o.order_amount) - Number(o.order_discount),
    "Units":           o.orderdata_item_quantity,
    "Outstanding":     o.outstandingDate || "—",
  }));
}

function pendingToRows(orders: PendingOrder[]) {
  return orders.map(o => ({
    "Order No":     `OM/${YEAR}/${o.order_id}`,
    "Date":         (o.orderDate || o.order_date || "").slice(0, 10),
    "Dealer":       o.Dealer_Name,
    "Amount (₹)":   Number(o.order_amount),
    "Discount (₹)": Number(o.order_discount),
    "Net (₹)":      Number(o.order_amount) - Number(o.order_discount),
    "Units":        o.orderdata_item_quantity,
    "Due Date":     o.outstandingDate || "—",
    "Status":       o.order_status === "1" ? "Approved" : "Pending",
    "Acceptance":   o.accept_order === "1" ? "Accepted" : "Not Accepted",
  }));
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ type, text, onClose }: { type: "success"|"error"; text: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl text-[12.5px] font-semibold shadow-xl border ${
      type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
    }`}>
      {type === "success"
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>}
      {text}
      <button onClick={onClose}><X size={11} className="opacity-50 hover:opacity-100" /></button>
    </div>
  );
}

// ─── Row Invoice Button ───────────────────────────────────────────────────────
function InvoiceBtn({ order }: { order: Order | PendingOrder }) {
  const [loading, setLoading] = useState(false);
  const [toast,   setToast]   = useState<{type:"success"|"error"; text:string}|null>(null);

  const handle = async () => {
    setLoading(true);
    const res = await downloadOrderInvoice(order as any);
    setLoading(false);
    setToast({ type: res.success ? "success" : "error", text: res.success ? "Invoice downloaded" : res.error || "Failed" });
  };

  return (
    <div className="relative">
      <button onClick={handle} disabled={loading}
        className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 rounded-lg transition-all shadow-sm disabled:opacity-50">
        {loading
          ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"/>
          : <Receipt size={10}/>}
        PDF
      </button>
      {toast && <Toast type={toast.type} text={toast.text} onClose={() => setToast(null)}/>}
    </div>
  );
}

// ─── Table Export Menu ────────────────────────────────────────────────────────
function ExportMenu({
  orders, pendingOrders, type,
}: {
  orders?: Order[]; pendingOrders?: PendingOrder[]; type: "orders"|"pending";
}) {
  const [open,  setOpen]  = useState(false);
  const [busy,  setBusy]  = useState(false);
  const [toast, setToast] = useState<{type:"success"|"error"; text:string}|null>(null);

  const handleCSV = () => {
    setOpen(false);
    if (type === "orders" && orders)           downloadCSV(ordersToRows(orders),  `orders_${moment().format("YYYY-MM-DD")}`);
    else if (type === "pending" && pendingOrders) downloadCSV(pendingToRows(pendingOrders), `pending_${moment().format("YYYY-MM-DD")}`);
    setToast({ type: "success", text: "CSV downloaded" });
  };

  const handleAllPDF = async () => {
    setOpen(false); setBusy(true);
    const list = (type === "orders" ? orders : pendingOrders) ?? [];
    for (const o of list.slice(0, 10)) {
      await downloadOrderInvoice(o as any);
      await new Promise(r => setTimeout(r, 400));
    }
    setBusy(false);
    setToast({ type: "success", text: `${Math.min(list.length, 10)} invoices downloaded` });
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-60">
        {busy ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/> : <Download size={12}/>}
        Export
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`}/>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)}/>
          <div className="absolute right-0 mt-1.5 w-52 bg-white border border-gray-200 rounded-xl shadow-xl z-40 overflow-hidden">
            <div className="px-3.5 pt-3 pb-1 text-[9.5px] font-bold text-gray-400 uppercase tracking-widest">Invoice PDF</div>
            <button onClick={handleAllPDF} className="w-full text-left px-3.5 py-2.5 text-[12px] text-gray-700 hover:bg-indigo-50 flex items-center gap-2.5 border-b border-gray-100 transition-colors">
              <Receipt size={12} className="text-indigo-500"/>
              <div><p className="font-semibold">Download All PDFs</p><p className="text-[10px] text-gray-400 mt-0.5">One per order (up to 10)</p></div>
            </button>
            <div className="px-3.5 pt-3 pb-1 text-[9.5px] font-bold text-gray-400 uppercase tracking-widest">Excel / CSV</div>
            <button onClick={handleCSV} className="w-full text-left px-3.5 py-2.5 text-[12px] text-gray-700 hover:bg-emerald-50 flex items-center gap-2.5 transition-colors">
              <FileSpreadsheet size={12} className="text-emerald-500"/>
              <div><p className="font-semibold">Download as Excel</p><p className="text-[10px] text-gray-400 mt-0.5">CSV — opens in Excel</p></div>
            </button>
          </div>
        </>
      )}
      {toast && <Toast type={toast.type} text={toast.text} onClose={() => setToast(null)}/>}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ cols }: { cols: number }) {
  return (
    <>{Array.from({length: 4}).map((_, i) => (
      <tr key={i} className="border-b border-gray-50">
        {Array.from({length: cols}).map((_, j) => (
          <td key={j} className="px-4 py-3">
            <div className="h-3 bg-gray-100 rounded animate-pulse" style={{width: j===2?110:j===0?30:70}}/>
          </td>
        ))}
      </tr>
    ))}</>
  );
}

const dashboardQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 2,
    },
  },
});

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AccountantDashboard() {
  return (
    <QueryClientProvider client={dashboardQueryClient}>
      <AccountantDashboardInner />
    </QueryClientProvider>
  );
}

function AccountantDashboardInner() {
  const router = useRouter();

  const [chartOrders,   setChartOrders]   = useState<ChartOrder[]>([]);
  const [chartDealers,  setChartDealers]  = useState<ChartDealer[]>([]);
  const [recentOrders,  setRecentOrders]  = useState<Order[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [summaryOverrides, setSummaryOverrides] = useState<Record<string, OrderSummaryOverride>>({});
  const [stats,         setStats]         = useState<Stats>({ dealerCount:0, staffCount:0, orderCount:0, PorderCount:0 });
  const [loading,       setLoading]       = useState(true);

  // Guard: redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/auth/accountant-login");
    }
  }, [router]);

  useEffect(() => {
    async function load() {
      try {
        const [cDealRes, statsRes, pendingRes, ordersRes] = await Promise.all([
          fetch(`${BACKEND_URL}/getMonthlyreporttopdealer`),
          fetch(`${BACKEND_URL}/dealercount`),
          fetch(`/api/orders-data?source=orderpeginationnew&role=accountant&page=1&limit=10&search=`),
          fetch(`/api/orders-data?source=orderpegination&role=accountant&page=1&limit=10&search=`),
        ]);

        const [cDeal, statsJson, pendingJson, ordersJson] = await Promise.all([
          cDealRes.json(), statsRes.json(), pendingRes.json(), ordersRes.json(),
        ]);

        const activeRecent = ((ordersJson.data || []) as Order[]).slice(0, 10);
        setChartOrders(activeRecent
          .map((order) => ({ order_id: order.order_id, total: String(order.order_net_amount ?? order.order_discount ?? order.order_amount ?? 0) }))
          .sort((left, right) => Number(right.total) - Number(left.total)));
        setChartDealers(cDeal.top || []);

        const sd = Array.isArray(statsJson.data) ? statsJson.data[0] : statsJson.data;
        setStats(sd || { dealerCount:0, staffCount:0, orderCount:0, PorderCount:0 });

        const activePending = ((pendingJson.data || []) as PendingOrder[]).slice(0, 10);
        setPendingOrders(activePending);
        setRecentOrders(activeRecent);
        setStats((current) => ({
          ...current,
          orderCount: Number(ordersJson.total ?? activeRecent.length),
          PorderCount: Number(pendingJson.total ?? activePending.length),
        }));
      } catch (e) {
        console.error("Dashboard load error:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    const orderIds = Array.from(new Set(
      [...recentOrders, ...pendingOrders].map(o => String(o.order_id || "").trim()).filter(Boolean)
    ));
    if (orderIds.length === 0) {
      setSummaryOverrides({});
      return;
    }

    let active = true;
    fetch(`/api/order-summary-overrides?order_ids=${encodeURIComponent(orderIds.join(","))}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(json => {
        if (!active) return;
        const map: Record<string, OrderSummaryOverride> = {};
        for (const row of Array.isArray(json.data) ? json.data : []) {
          const id = String(row.orderId || row.order_id || "").trim();
          if (id) map[id] = row;
        }
        setSummaryOverrides(map);
      })
      .catch(() => {
        if (active) setSummaryOverrides({});
      });

    return () => { active = false; };
  }, [recentOrders, pendingOrders]);

  const [
    pendingVerificationQ,
    ledgerQ,
  ] = useQueries({
    queries: [
      {
        queryKey: ["accountantSidebarSummary", "pendingVerification"],
        queryFn: async () => {
          const result = await fetchJson<{ data: PendingOrder[] }>(`/api/orders-data?source=orderpeginationnew&role=accountant&page=1&limit=1000&search=`);
          return result;
        },
      },
      {
        queryKey: ["accountantSidebarSummary", "ledger"],
        queryFn: () => fetchJson<LedgerResponse>("/api/ledger"),
      },
    ],
  });

  const summaryLoading = [pendingVerificationQ, ledgerQ].some(q => q.isLoading);
  const summaryError = [pendingVerificationQ, ledgerQ].find(q => q.isError);
  const retrySummary = () => {
    pendingVerificationQ.refetch();
    ledgerQ.refetch();
  };

  const pricedRecentOrders = recentOrders.map(order =>
    withDisplayOrderAmounts(order, summaryOverrides[order.order_id])
  );
  const pricedPendingOrders = pendingOrders.map(order =>
    withDisplayOrderAmounts(order, summaryOverrides[order.order_id])
  );

  // Derived
  const totalSale         = chartOrders.reduce((s, o) => s + Number(o.total), 0);
  const pendingPayment    = pricedPendingOrders.reduce((s, o) => s + (Number(o.order_amount) - Number(o.order_discount)), 0);
  const pendingPayCount   = pendingOrders.filter(o => o.accept_order === "0" || o.order_status !== "1").length;
  const pendingVerification = (pendingVerificationQ.data?.data ?? pendingOrders).filter(o => o.order_status === "0").length;
  const ledgerRows = ledgerQ.data?.data ?? [];
  const totalOutstandingValue = ledgerRows.reduce((sum, row) => sum + Math.max(0, Number(row.netBalance) || 0), 0);
  const pendingInvoicesCount = ledgerRows.filter(row => Number(row.netBalance) > 0).length;

  const statCards = [
    { label: "Total Sale",       value: `₹${totalSale.toLocaleString("en-IN")}`,     icon: <DollarSign size={15}/>,   bg: "bg-emerald-50", text: "text-emerald-600", border: "border-l-emerald-400" },
    { label: "Total Orders",     value: stats.orderCount,                              icon: <ShoppingCart size={15}/>, bg: "bg-blue-50",    text: "text-blue-600",    border: "border-l-blue-400"    },
    { label: "Pending Orders",   value: stats.PorderCount,                             icon: <Clock size={15}/>,        bg: "bg-amber-50",   text: "text-amber-600",   border: "border-l-amber-400"   },
    { label: "Pending Payments", value: pendingPayCount,                               icon: <AlertCircle size={15}/>,  bg: "bg-red-50",     text: "text-red-500",     border: "border-l-red-400"     },
    { label: "Payment Exposure", value: `₹${pendingPayment.toLocaleString("en-IN")}`, icon: <TrendingUp size={15}/>,   bg: "bg-violet-50",  text: "text-violet-600",  border: "border-l-violet-400"  },
  ];

  const cOrdData  = chartOrders.map(o  => ({ name: `#${o.order_id}`,                  value: Number(o.total) }));
  const cDealData = chartDealers.map(d => ({ name: d.Dealer_Name.substring(0, 11),    value: Number(d.total) }));

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin-bottom: 24px; }
        .icard { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px 20px; transition: box-shadow .2s, transform .2s; }
        .icard:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.07); transform: translateY(-2px); }
        .icard-lbl { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; }
        .icard-val { font-size: 26px; font-weight: 700; color: #111827; font-family: 'DM Mono', monospace; line-height: 1; }
        .icard-sub { font-size: 11.5px; color: #6b7280; margin-top: 7px; }
        .icard-badge { display: inline-flex; align-items: center; gap: 3px; margin-top: 9px; padding: 2px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 600; }
        .badge-amber { background: #fef3c7; color: #b45309; }
        .badge-green { background: #d1fae5; color: #059669; }
        .badge-blue { background: #dbeafe; color: #1d4ed8; }
        .badge-purple { background: #ede9fe; color: #7c3aed; }
        .badge-red { background: #fee2e2; color: #b91c1c; }
        .pulse-amber { box-shadow: 0 0 0 0 rgba(245,158,11,0.7); animation: pulseAmber 1.6s infinite; }
        @keyframes pulseAmber { 0%{box-shadow:0 0 0 0 rgba(245,158,11,0.7)} 70%{box-shadow:0 0 0 8px rgba(245,158,11,0)} 100%{box-shadow:0 0 0 0 rgba(245,158,11,0)} }
        .shimmer { background: linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 6px; }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .quick-action-btn { display: inline-flex; align-items: center; justify-content: center; margin-top: 10px; padding: 6px 10px; border-radius: 8px; background: #f9fafb; border: 1px solid #e5e7eb; color: #4f46e5; font-size: 11.5px; font-weight: 700; text-decoration: none; transition: background .15s, border-color .15s; }
        .quick-action-btn:hover { background: #ede9fe; border-color: #ddd6fe; }
      `}</style>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        {statCards.map(card => (
          <div key={card.label} className={`bg-white border border-gray-200 border-l-4 ${card.border} rounded-2xl p-5 hover:shadow-md hover:-translate-y-0.5 transition-all`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${card.bg} ${card.text}`}>
                {card.icon}
              </div>
            </div>
            <div className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">{card.label}</div>
            <div className="text-[26px] font-bold text-gray-900 leading-none" style={{ fontFamily: "'DM Mono', monospace" }}>
              {loading ? <div className="h-7 w-20 bg-gray-100 rounded animate-pulse"/> : card.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Sidebar Summary Widgets ── */}
      {summaryError && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-600">
          Some accountant summary data failed to load.
          <button className="quick-action-btn" style={{ marginTop: 0, marginLeft: "auto", color: "#dc2626" }} onClick={retrySummary}>Retry</button>
        </div>
      )}
      <div className="summary-grid">
        <div className="icard">
          <div className="icard-lbl">Pending Verification</div>
          <div className="icard-val">{summaryLoading ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} /> : pendingVerification}</div>
          <div className="icard-sub">Orders waiting for verification</div>
          <div className={`icard-badge badge-amber${pendingVerification > 0 ? " pulse-amber" : ""}`}>{pendingVerification} pending</div>
          <Link href="/Pages/Ordermanagement/outstandingorders" className="quick-action-btn">+ Review orders</Link>
        </div>
        <div className="icard">
          <div className="icard-lbl">Outstanding Value</div>
          <div className="icard-val">{summaryLoading ? <span className="shimmer" style={{ display: "inline-block", width: 90, height: 26 }} /> : `₹${totalOutstandingValue.toLocaleString("en-IN")}`}</div>
          <div className="icard-sub">Net open balance across dealers</div>
          <div className="icard-badge badge-blue">{ledgerRows.length} ledgers</div>
          <Link href="/dashboard/admin/ledger" className="quick-action-btn">+ Open ledger</Link>
        </div>
        <div className="icard">
          <div className="icard-lbl">Pending Invoices</div>
          <div className="icard-val">{summaryLoading ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} /> : pendingInvoicesCount}</div>
          <div className="icard-sub">Dealer balances needing invoice follow-up</div>
          <div className={`icard-badge ${pendingInvoicesCount > 0 ? "badge-red" : "badge-green"}`}>{pendingInvoicesCount} open</div>
          <Link href="/dashboard/accountant/order-book" className="quick-action-btn">+ Open order book</Link>
        </div>
      </div>

      {/* ── Recent Orders Table ── */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-5 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <div className="text-[14px] font-semibold text-gray-900 flex items-center gap-2">
              <ShoppingCart size={14} className="text-indigo-500"/>
              Recent Orders
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold">Last 10</span>
            </div>
            <div className="text-[11.5px] text-gray-400 mt-0.5">Latest entries across all dealers</div>
          </div>
          <ExportMenu type="orders" orders={pricedRecentOrders}/>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {["#","Order No.","Date","Dealer","Gross","Discount","Net","Units","Action"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading
                ? <Skeleton cols={9}/>
                : pricedRecentOrders.length === 0
                  ? <tr><td colSpan={9} className="py-12 text-center text-[13px] text-gray-400">No orders found</td></tr>
                  : pricedRecentOrders.map((order, idx) => {
                    const net     = Number(order.order_amount) - Number(order.order_discount);
                    const deleted = !!order.reason;
                    return (
                      <tr key={order.order_id} className={`hover:bg-slate-50 transition-colors ${deleted ? "opacity-50" : ""}`}>
                        <td className="px-4 py-3 text-[11.5px] text-gray-400 font-mono">{String(idx+1).padStart(2,"0")}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[12px] font-bold text-indigo-700">OM/{YEAR}/{order.order_id}</span>
                            {deleted && <span className="px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-600 rounded text-[9px] font-bold">DEL</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[12px] text-gray-800 font-medium">{moment(order.order_date).format("DD MMM YYYY")}</div>
                          <div className="text-[10.5px] text-gray-400 font-mono">{moment(order.order_date).format("hh:mm A")}</div>
                        </td>
                        <td className="px-4 py-3 text-[12.5px] text-gray-700 font-medium max-w-[120px] truncate">{order.Dealer_Name || "—"}</td>
                        <td className="px-4 py-3 font-mono text-[12px] text-gray-400 line-through">₹{Number(order.order_amount).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 font-mono text-[12px] text-amber-600">−₹{Number(order.order_discount).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 font-mono text-[13px] font-bold text-gray-900">₹{net.toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[11px] font-mono">{order.orderdata_item_quantity}u</span></td>
                        <td className="px-4 py-3"><InvoiceBtn order={order}/></td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
          <span className="text-[11.5px] text-gray-400">Showing up to 10 recent orders</span>
          <Link href="/Pages/Ordermanagement" className="text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-800">View all →</Link>
        </div>
      </div>

      {/* ── Pending Orders Table ── */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-6 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100 bg-amber-50/50">
          <div>
            <div className="text-[14px] font-semibold text-gray-900 flex items-center gap-2">
              <Clock size={14} className="text-amber-500"/>
              Pending Orders
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold">Needs Action</span>
            </div>
            <div className="text-[11.5px] text-gray-400 mt-0.5">Orders awaiting approval or payment</div>
          </div>
          <ExportMenu type="pending" pendingOrders={pricedPendingOrders}/>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-amber-50/60 border-b border-amber-100">
                {["#","Order No.","Dealer","Date","Due","Amount","Net","Qty","Status","Accept"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-wider text-amber-800 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading
                ? <Skeleton cols={10}/>
                : pricedPendingOrders.length === 0
                  ? <tr><td colSpan={10} className="py-12 text-center text-[13px] text-gray-400">All caught up 🎉</td></tr>
                  : pricedPendingOrders.map((order, idx) => {
                    const net      = Number(order.order_amount) - Number(order.order_discount);
                    const approved = order.order_status === "1";
                    const accepted = order.accept_order === "1";
                    return (
                      <tr key={order.order_id} className="hover:bg-amber-50/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-[11.5px] text-gray-400">{String(idx+1).padStart(2,"0")}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-[11.5px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                            OM/{YEAR}/{order.order_id}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[12.5px] font-medium text-gray-800">{order.Dealer_Name || "—"}</div>
                          <div className="text-[10px] text-gray-400">ID: {order.order_dealer}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11.5px] text-gray-600">{(order.orderDate||order.order_date||"—").slice(0,10)}</td>
                        <td className="px-4 py-3">
                          {order.outstandingDate
                            ? <span className="font-mono text-[11.5px] font-semibold text-amber-700">{order.outstandingDate}</span>
                            : <span className="text-gray-300 text-[11.5px]">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-gray-400 line-through">₹{Number(order.order_amount).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 font-mono text-[13px] font-bold text-gray-900">₹{net.toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-center font-mono text-[12px] font-semibold text-gray-600">{order.orderdata_item_quantity||"—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${
                            approved ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${approved ? "bg-emerald-400" : "bg-amber-400"}`}/>
                            {approved ? "Approved" : "Pending"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${
                            accepted ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-red-50 border-red-200 text-red-600"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${accepted ? "bg-blue-400" : "bg-red-400"}`}/>
                            {accepted ? "Accepted" : "Pending"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-amber-100 bg-amber-50/40 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-4 text-[11.5px]">
            <span className="text-gray-500">Not Accepted: <strong className="text-red-600">{pendingOrders.filter(o => o.accept_order==="0").length}</strong></span>
            <span className="text-gray-500">Exposure: <strong className="text-amber-700 font-mono">₹{pendingPayment.toLocaleString("en-IN")}</strong></span>
          </div>
          <Link href="/Pages/Ordermanagement/outstandingorders" className="text-[11.5px] font-semibold text-amber-700 hover:text-amber-900">View all pending →</Link>
        </div>
      </div>

      {/* ── Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {[
          { title: "Top Orders by Value",    sub: "Highest order amounts",         data: cOrdData,  fill: "rgba(99,102,241,0.75)"  },
          { title: "Top Dealers by Revenue", sub: "Best performing dealer accounts", data: cDealData, fill: "rgba(139,92,246,0.75)" },
        ].map(chart => (
          <div key={chart.title} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-[13.5px] font-semibold text-gray-900">{chart.title}</div>
              <div className="text-[11.5px] text-gray-400 mt-0.5">{chart.sub}</div>
            </div>
            <div className="h-60 p-4">
              {loading
                ? <div className="flex items-center justify-center h-full text-[13px] text-gray-300">Loading…</div>
                : chart.data.length > 0
                  ? <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chart.data}>
                        <XAxis dataKey="name" tick={{fontSize:10}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:10}} axisLine={false} tickLine={false}/>
                        <Tooltip
                          contentStyle={{backgroundColor:"#1e1b4b",border:"1px solid #4f46e5",borderRadius:"10px",fontSize:11}}
                          labelStyle={{color:"#c7d2fe"}}
                          formatter={(v: any) => `₹${Number(v).toLocaleString("en-IN")}`}
                        />
                        <Bar dataKey="value" fill={chart.fill} radius={[6,6,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  : <div className="flex items-center justify-center h-full text-[13px] text-gray-300">No data</div>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Reports ── */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="text-[13.5px] font-semibold text-gray-900 flex items-center gap-2">
            <TrendingUp size={14} className="text-indigo-500"/> Reports
          </div>
          <button
            onClick={() => downloadCSV([
              ...chartOrders.map(o  => ({ Type:"Order",  Ref:`OM/${YEAR}/${o.order_id}`, Value:Number(o.total) })),
              ...chartDealers.map(d => ({ Type:"Dealer", Ref:d.Dealer_Name,              Value:Number(d.total) })),
            ], `report_${moment().format("YYYY-MM-DD")}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            <FileSpreadsheet size={12}/> Export Report
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
          {[
            { heading: "Top Orders",  items: chartOrders.map(o  => ({ label:`OM/${YEAR}/${o.order_id}`, value:o.total  })) },
            { heading: "Top Dealers", items: chartDealers.map(d => ({ label:d.Dealer_Name,               value:d.total  })) },
          ].map(col => (
            <div key={col.heading} className="p-5">
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3 bg-gray-100 px-3 py-1.5 rounded-lg">{col.heading}</div>
              {loading
                ? <div className="text-[12px] text-gray-300 py-4">Loading…</div>
                : col.items.length === 0
                  ? <div className="text-[12px] text-gray-300 py-4 text-center">No data</div>
                  : col.items.map((item, i) => (
                    <div key={i} className="flex justify-between items-center py-2.5 border-b border-gray-50 last:border-0">
                      <span className="text-[12.5px] text-gray-700 font-medium">{item.label}</span>
                      <span className="text-[12.5px] font-bold text-gray-900 font-mono">₹{Number(item.value).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 text-center text-[11px] text-gray-400">
        © {YEAR} Omsons · Accountant Dashboard
      </div>
    </div>
  );
}
