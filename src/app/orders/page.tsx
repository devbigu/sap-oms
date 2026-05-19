"use client";

import { useState, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import moment from "moment";
import { exportOrdersToSupabase, downloadPDFDirectly } from "@/lib/Exporttopdf";
import { InvoiceModal } from "@/components/InvoiceModel";
import { downloadOrderInvoice, uploadOrderInvoiceToSupabase, generateOrderInvoicePDF } from "@/lib/invoicegenerator";

// ─── Types ────────────────────────────────────────────────────────────────────
type Order = {
  order_id: string;
  order_date: string;
  order_amount: string;
  order_discount: string;
  Dealer_Name: string;
  orderdata_item_quantity: string;
  mtstatus: string;
  outstandingDate: string;
  reason?: string;
};
type ApiResponse = { msg: string; count: number; status: boolean; data: Order[] };

const PAGE_SIZE = 10;
const BACKEND = "https://mirisoft.co.in/sas/dealerapi/api";

const getDealerId = () => {
  try { return JSON.parse(localStorage.getItem("UserData") ?? "{}")?.Dealer_Id ?? "225"; }
  catch { return "225"; }
};

async function fetchOrders(page: number, search: string, id: string): Promise<ApiResponse> {
  const r = await fetch(`${BACKEND}/orderhispegination?page=${page}&search=${search}&id=${id}`);
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

const statusConf: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  inprocess:  { label: "In Process", dot: "bg-amber-400",   text: "text-amber-800",   bg: "bg-amber-50 border-amber-200"   },
  processing: { label: "Processing", dot: "bg-blue-400",    text: "text-blue-800",    bg: "bg-blue-50 border-blue-200"     },
  dispatched: { label: "Dispatched", dot: "bg-indigo-400",  text: "text-indigo-800",  bg: "bg-indigo-50 border-indigo-200" },
  successful: { label: "Successful", dot: "bg-emerald-400", text: "text-emerald-800", bg: "bg-emerald-50 border-emerald-200"},
  cancelled:  { label: "Cancelled",  dot: "bg-red-400",     text: "text-red-800",     bg: "bg-red-50 border-red-200"       },
};

function MtStatusBadge({ status }: { status: string }) {
  const key = status?.toLowerCase().replace(/\s/g, "") ?? "";
  const s = statusConf[key] ?? { label: status || "—", dot: "bg-gray-300", text: "text-gray-700", bg: "bg-gray-50 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[60, 120, 90, 80, 80, 90, 80, 100, 80, 160].map((w, i) => (
        <td key={i} className="px-4 py-4">
          <div className="h-3.5 bg-gray-100 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Per-row Invoice Button — always visible ──────────────────────────────────
function InvoiceRowButton({ order }: { order: Order }) {
  const [loading,  setLoading ] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [toast,    setToast   ] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDownload = async () => {
    setLoading(true); setShowMenu(false);
    const res = await downloadOrderInvoice(order);
    setLoading(false);
    showToast(res.success ? "success" : "error", res.success ? "PDF downloaded" : (res.error || "Download failed"));
  };

  const handleUpload = async () => {
    setLoading(true); setShowMenu(false);
    try {
      const blob = await generateOrderInvoicePDF(order);
      const res  = await uploadOrderInvoiceToSupabase(blob, order);
      showToast(res.success ? "success" : "error", res.success ? "Invoice saved to cloud" : (res.error || "Upload failed"));
    } catch (e: any) {
      showToast("error", e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(v => !v)}
        disabled={loading}
        title="Invoice PDF"
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded-lg text-[11px] font-semibold transition-all shadow-sm disabled:opacity-50"
      >
        {loading
          ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
        }
        Invoice
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />
          <div className="absolute right-0 mt-1.5 w-52 bg-white rounded-xl shadow-xl border border-gray-200 z-40 overflow-hidden">
            <button
              onClick={handleDownload}
              className="w-full text-left px-4 py-3 text-[12px] text-gray-700 hover:bg-blue-50 flex items-center gap-3 border-b border-gray-100 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <div>
                <p className="font-semibold">Download PDF</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Save to device</p>
              </div>
            </button>
            <button
              onClick={handleUpload}
              className="w-full text-left px-4 py-3 text-[12px] text-gray-700 hover:bg-emerald-50 flex items-center gap-3 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 14 12 9 17 14"/>
                <line x1="12" y1="9" x2="12" y2="21"/>
              </svg>
              <div>
                <p className="font-semibold">Save to Cloud</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Upload to Supabase</p>
              </div>
            </button>
          </div>
        </>
      )}

      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-medium shadow-lg border ${
          toast.type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
        }`}>
          {toast.type === "success"
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>
          }
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ─── Export Button ─────────────────────────────────────────────────────────────
interface ExportButtonProps {
  orders: Order[];
  dealerName: string;
  dealerId: string;
  isLoading?: boolean;
}

function ExportButton({ orders, dealerName, dealerId, isLoading = false }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [showNotification, setShowNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  const handleExport = async (uploadToSupabase: boolean) => {
    if (orders.length === 0) { setShowNotification({ type: "error", message: "No orders to export" }); setShowMenu(false); return; }
    setIsExporting(true); setShowMenu(false);
    try {
      if (uploadToSupabase) {
        const result = await exportOrdersToSupabase({ orders, dealerName, dealerId, title: `Order History - ${dealerName}`, fileName: `orders_${moment().format("YYYY-MM-DD")}` });
        setShowNotification({ type: result.success ? "success" : "error", message: result.success ? "PDF exported to Supabase! 🎉" : (result.error || "Failed") });
      } else {
        const result = await downloadPDFDirectly({ orders, dealerName, title: `Order History - ${dealerName}`, fileName: `orders_${moment().format("YYYY-MM-DD")}.pdf` });
        setShowNotification({ type: result.success ? "success" : "error", message: result.success ? "PDF downloaded successfully! 📥" : (result.error || "Failed") });
      }
    } catch (error) {
      setShowNotification({ type: "error", message: error instanceof Error ? error.message : "Export failed" });
    } finally {
      setIsExporting(false);
      setTimeout(() => setShowNotification(null), 4000);
    }
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          disabled={isLoading || isExporting || orders.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-xl transition-colors"
        >
          {isExporting ? (
            <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Exporting…</>
          ) : (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export</>
          )}
        </button>
        {showMenu && (
          <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-40 overflow-hidden">
            <button onClick={() => handleExport(false)} disabled={isExporting} className="w-full text-left px-4 py-3 text-[13px] text-gray-700 hover:bg-blue-50 disabled:opacity-50 border-b border-gray-100 transition-colors flex items-center gap-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <div><p className="font-medium">Download to Device</p><p className="text-[11px] text-gray-500 mt-0.5">Save PDF locally</p></div>
            </button>
            <button onClick={() => handleExport(true)} disabled={isExporting} className="w-full text-left px-4 py-3 text-[13px] text-gray-700 hover:bg-emerald-50 disabled:opacity-50 transition-colors flex items-center gap-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1"/><path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m0 5.08l-4.24 4.24M19.78 4.22l-4.24 4.24m0 5.08l4.24 4.24M1 12a11 11 0 0 1 22 0 11 11 0 0 1-22 0"/></svg>
              <div><p className="font-medium">Upload to Supabase</p><p className="text-[11px] text-gray-500 mt-0.5">Cloud storage with URL</p></div>
            </button>
          </div>
        )}
      </div>
      {showNotification && (
        <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg text-[13px] font-medium shadow-lg animate-in fade-in slide-in-from-bottom z-50 flex items-center gap-2 ${
          showNotification.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
        }`}>
          {showNotification.type === "success"
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          }
          {showNotification.message}
        </div>
      )}
    </>
  );
}

// ─── Delete Modal ─────────────────────────────────────────────────────────────
function DeleteModal({ orderId, onConfirm, onClose }: { orderId: string; onConfirm: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!reason.trim()) { setErr("A reason is required."); return; }
    setDeleting(true);
    await onConfirm(reason.trim());
    setDeleting(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(8px)", background: "rgba(15,23,42,0.45)" }}
      onClick={e => { if (e.target === e.currentTarget && !deleting) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" style={{ animation: "slideUp 0.2s ease" }}>
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6m5 0V4h4v2"/>
            </svg>
          </div>
          <h3 className="text-[15px] font-bold text-gray-900">Delete Order #{orderId}?</h3>
          <p className="text-[13px] text-gray-600 mt-1">Order stays in history with your reason. This cannot be undone.</p>
        </div>
        <div className="px-6 py-4">
          <label className="text-[11px] font-bold text-gray-600 uppercase tracking-widest block mb-2">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={e => { setReason(e.target.value); setErr(""); }}
            placeholder="e.g. Duplicate order, wrong items, customer cancelled…"
            rows={3}
            disabled={deleting}
            className={`w-full px-4 py-3 text-[13px] text-gray-900 border rounded-xl outline-none resize-none transition-all placeholder:text-gray-400 ${
              err ? "border-red-300 bg-red-50/30 focus:ring-2 focus:ring-red-100" : "border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            }`}
          />
          {err && <p className="text-[11px] text-red-600 mt-1.5">{err}</p>}
        </div>
        <div className="px-6 pb-6 flex gap-2">
          <button onClick={onClose} disabled={deleting} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">Cancel</button>
          <button onClick={submit} disabled={deleting || !reason.trim()} className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-[13px] font-semibold transition-colors flex items-center justify-center gap-2">
            {deleting && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {deleting ? "Deleting…" : "Delete Order"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function OrderHistoryPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [dealerId, setDealerId] = useState("225");
  const [year] = useState(new Date().getFullYear());
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  useEffect(() => { setDealerId(getDealerId()); }, []);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["orders", page, query, dealerId],
    queryFn: () => fetchOrders(page, query, dealerId),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: !!dealerId,
  });

  const orders = data?.data ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setQuery(search); setPage(1); };

  const handleDelete = async (reason: string) => {
    if (!deleteOrderId) return;
    const fd = new FormData();
    fd.append("id", deleteOrderId);
    fd.append("reason", reason);
    fd.append("field", "order_id");
    fd.append("tbl", "order_tbl");
    await fetch(`${BACKEND}/deletewithreason`, { method: "POST", body: fd });
    setDeleteOrderId(null);
    refetch();
  };

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | "…")[]>((acc, p, i, arr) => {
      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
      acc.push(p); return acc;
    }, []);

  return (
    <>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(12px) scale(0.97); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] text-[12.5px] font-medium text-[#374151] cursor-pointer transition-all hover:bg-[#f1f5f9] hover:-translate-x-px"
            >
              back
            </button>
            <h1 className="text-xl font-bold text-gray-900">Order History</h1>
            <p className="text-sm text-gray-600 mt-0.5">
              {isLoading ? "Loading…" : `${totalCount} total orders`}
              {isFetching && !isLoading && (
                <span className="ml-2 inline-flex items-center gap-1 text-indigo-600 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping inline-block" />
                  refreshing
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orders…"
                  className="pl-9 pr-4 py-2 text-[13px] text-gray-900 border border-gray-200 rounded-xl bg-gray-50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all w-52 placeholder:text-gray-400" />
              </div>
              <button type="submit" className="px-4 py-2 bg-gray-900 text-white text-[13px] font-semibold rounded-xl hover:bg-gray-700 transition-colors">Search</button>
              {query && (
                <button type="button" onClick={() => { setSearch(""); setQuery(""); setPage(1); }}
                  className="px-3 py-2 text-[13px] text-gray-600 hover:text-gray-900 border border-gray-200 rounded-xl transition-colors">Clear</button>
              )}
            </form>

            <button
              onClick={() => setShowInvoiceModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-xl transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Invoices
            </button>

            <ExportButton
              orders={orders}
              dealerName={data?.data?.[0]?.Dealer_Name || "Unknown"}
              dealerId={dealerId}
              isLoading={isLoading}
            />
          </div>
        </div>

        <div className="px-8 py-6 max-w-[1440px] mx-auto">
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">

            {isError && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
                </svg>
                <p className="text-sm text-gray-600">Failed to load orders. Please try again.</p>
              </div>
            )}

            {!isError && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {["#", "Order No.", "Date", "Gross", "Discount", "Net", "Units", "Outstanding", "Actions"].map(h => (
                        <th key={h} className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {isLoading
                      ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                      : orders.length === 0
                        ? (
                          <tr><td colSpan={10}>
                            <div className="flex flex-col items-center justify-center py-16 gap-3">
                              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.2" strokeLinecap="round">
                                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                                <rect x="9" y="3" width="6" height="4" rx="1" />
                              </svg>
                              <p className="text-sm text-gray-600">No orders found</p>
                            </div>
                          </td></tr>
                        )
                        : orders.map((order, idx) => {
                          const net = Number(order.order_amount) - Number(order.order_discount);
                          const isDeleted = !!(order.reason);

                          return (
                            <tr key={order.order_id} className={`hover:bg-blue-50/30 transition-colors ${isDeleted ? "opacity-60" : ""}`}>
                              <td className="px-4 py-3.5 text-gray-700 font-medium">
                                {String((page - 1) * PAGE_SIZE + idx + 1).padStart(2, "0")}
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[13px] font-bold text-indigo-700">
                                    OM/{year}/{order.order_id}
                                  </span>
                                  {isDeleted && (
                                    <span className="px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-700 rounded text-[10px] font-bold">DELETED</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3.5">
                                <p className="text-[13px] text-gray-900 font-medium">{moment(order.order_date).format("DD MMM YYYY")}</p>
                                <p className="text-[11px] text-gray-600 font-mono mt-0.5">{moment(order.order_date).format("hh:mm A")}</p>
                              </td>
                              <td className="px-4 py-3.5 font-mono text-[13px] text-gray-700 line-through">
                                ₹{Number(order.order_amount).toLocaleString("en-IN")}
                              </td>
                              <td className="px-4 py-3.5 font-mono text-[13px] text-amber-700">
                                −₹{Number(order.order_discount).toLocaleString("en-IN")}
                              </td>
                              <td className="px-4 py-3.5 font-mono text-[14px] font-bold text-gray-900">
                                ₹{net.toLocaleString("en-IN")}
                              </td>
                              <td className="px-4 py-3.5">
                                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded-lg text-[12px] font-mono font-semibold">
                                  {order.orderdata_item_quantity} units
                                </span>
                              </td>
                              {/* <td className="px-4 py-3.5">
                                <MtStatusBadge status={order.mtstatus} />
                              </td> */}
                              <td className="px-4 py-3.5 font-mono text-[12px] text-gray-700">
                                {order.outstandingDate ? moment(order.outstandingDate).format("DD MMM YYYY") : "—"}
                              </td>

                              {/* Actions — always visible, no hover gate */}
                              <td className="px-4 py-3.5 w-px whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => router.push(`/orders/${order.order_id}`)}
                                    title="View order detail"
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-700 hover:text-indigo-700 rounded-lg text-[11px] font-semibold transition-all shadow-sm"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                      <circle cx="12" cy="12" r="3" />
                                    </svg>
                                    View
                                  </button>

                                  {/* Invoice button — always present */}
                                  <InvoiceRowButton order={order} />

                                  {!isDeleted && (
                                    <button
                                      onClick={() => setDeleteOrderId(order.order_id)}
                                      title="Delete order"
                                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-700 hover:text-red-700 rounded-lg text-[11px] font-semibold transition-all shadow-sm"
                                    >
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
                                      </svg>
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                    }
                  </tbody>
                </table>
              </div>
            )}

            {!isLoading && !isError && totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
                <p className="text-[13px] text-gray-700 font-medium">
                  Page {page} of {totalPages} · <span className="text-gray-600">{totalCount} orders</span>
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all font-medium">‹</button>
                  {pageNums.map((p, i) => p === "…"
                    ? <span key={`d${i}`} className="w-8 h-8 flex items-center justify-center text-gray-500 text-[13px]">…</span>
                    : <button key={p} onClick={() => setPage(p as number)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-[13px] font-semibold border transition-all ${page === p ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-700 hover:bg-white"}`}>{p}</button>
                  )}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all font-medium">›</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {deleteOrderId && (
        <DeleteModal orderId={deleteOrderId} onConfirm={handleDelete} onClose={() => setDeleteOrderId(null)} />
      )}

      <InvoiceModal
        dealerId={dealerId}
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
      />
    </>
  );
}