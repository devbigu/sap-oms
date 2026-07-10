"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import moment from "moment";
import * as XLSX from "xlsx";
import { hasPriorityTag } from "@/lib/orderPriority";
import { downloadOrderInvoice } from "@/lib/invoicegenerator";
import {
  formatAdditionalDiscountBadge,
  getOrderDiscountSummaryRows,
  resolveOrderAmounts,
  resolveOrderDiscountBreakdown,
} from "@/lib/orderAmounts";
import { mergeFallbackProductNotes } from "@/lib/orderProductNotes.mjs";

// ─── Types ────────────────────────────────────────────────────────────────────
type OrderData = {
  orderdata_id: string;
  orderdata_orderid: string;
  orderdata_cat_no: string;
  orderdata_item_quantity: string;
  orderdata_price: string;
  orderdata_discount: string;
  orderdata_afterDisPrice: string;
  orderdata_status: string;
  orderdata_datetime: string;
  product_name: string;
  product_discription: string;
  product_unit: string;
  readyquantity: string;
  remark?: string;
  remarks?: string;
  displayRemark?: string;
  fallbackProductNote?: string;
  order_note?: string;
  note?: string;
  priority?: string | boolean;
  isPriority?: string | boolean;
  is_priority?: string | boolean;
  discount: string;
  order_discount: string;
  del_status: string;
  Dealer_Name?: string;
  Dealer_Address?: string;
  Dealer_Number?: string;
  gst?: string;
};

type DealerInfo = {
  Dealer_Id?: string;
  Dealer_Name?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_Address?: string;
  Dealer_shipto?: string;
  Dealer_City?: string;
  Dealer_Pincode?: string;
  Dealer_Username?: string;
  Dealer_Dealercode?: string;
  Dealer_Notes?: string;
  gst?: string;
  // creditdays?: string;
  discount?: string;
  // annualtarget?: string;
  staffname?: string;
  currentlimit?: string;
};

type Remark = {
  remark: string;
  readyquantity: string;
  status: string;
  datetime: string;
};

type OrderSummaryOverride = Record<string, unknown> & {
  grossAmount?: number | string;
  discountAmount?: number | string;
  netPayableAmount?: number | string;
  discountPercent?: number | string;
  baseDiscountAmount?: number | string;
  baseDiscountPercent?: number | string;
  customDiscountAmount?: number | string;
  customDiscountPercent?: number | string;
  amountBeforeSlab?: number | string;
  slabDiscountAmount?: number | string;
  slabDiscountPercent?: number | string;
  allocatedDiscountPercent?: number | string;
  approvedDiscountPercent?: number | string;
};

type OrderProductNote = {
  orderId?: string;
  orderItemId?: string | null;
  sku?: string;
  normalizedSku?: string;
  occurrence?: number;
  note?: string;
};

const BACKEND = "https://mirisoft.co.in/sas/dealerapi/api";

type PhpExchangeLog = {
  method: "GET" | "POST";
  url: string;
  request?: unknown;
  response?: unknown;
  error?: unknown;
};

function logPhpExchange(label: string, details: PhpExchangeLog) {
  console.groupCollapsed(`[PHP backend] ${label}`);
  console.info("method", details.method);
  console.info("url", details.url);
  if (details.request !== undefined) console.info("sending to PHP", details.request);
  if (details.response !== undefined) console.info("received from PHP", details.response);
  if (details.error !== undefined) console.error("PHP request failed", details.error);
  console.groupEnd();
}

// ─── Status config ─────────────────────────────────────────────────────────────
const itemStatusMap: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  "0": { label: "In Process",   dot: "bg-amber-400",   text: "text-amber-700",   bg: "bg-amber-50"   },
  "1": { label: "Processing",   dot: "bg-blue-400",    text: "text-blue-700",    bg: "bg-blue-50"    },
  "2": { label: "Dispatched",   dot: "bg-indigo-400",  text: "text-indigo-700",  bg: "bg-indigo-50"  },
  "3": { label: "Not in Stock", dot: "bg-red-400",     text: "text-red-700",     bg: "bg-red-50"     },
  "4": { label: "Successful",   dot: "bg-emerald-400", text: "text-emerald-700", bg: "bg-emerald-50" },
};

const remarkStatusMap: Record<string, string> = {
  "1": "Packing", "2": "Dispatch", "3": "Not in Stock", "4": "Successful",
};

function StatusPill({ code }: { code: string }) {
  const s = itemStatusMap[code] ?? { label: code || "—", dot: "bg-gray-300", text: "text-gray-600", bg: "bg-gray-50" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function extractOrderNote(orders: OrderData[], overlayNote: string) {
  if (overlayNote.trim()) return overlayNote.trim();
  for (const order of orders) {
    const direct = order.order_note || order.note;
    if (direct?.trim()) return direct.trim();
    const remarks = [order.remark, order.remarks].filter(Boolean).join(" | ");
    const fromRemark = remarks.match(/Order note:\s*([^|]+)/i)?.[1]?.trim();
    if (fromRemark) return fromRemark;
  }
  return "";
}

// Parse PACK OF / pack size from product description HTML table: returns { catNo → packSize }
function parsePackSizes(html: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!html) return result;

  const theadMatch = html.match(/<thead>([\s\S]*?)<\/thead>/i);
  if (!theadMatch) return result;
  const headers = [...theadMatch[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
    .map(m => m[1].replace(/<[^>]*>/g, "").trim());
  const packIdx = headers.findIndex(h => /pack|qty|quantity/i.test(h));
  if (packIdx === -1) return result;

  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return result;

  [...tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].forEach(tr => {
    const cells = [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
      .map(m => m[1].replace(/<[^>]*>/g, "").trim());
    const catNo = cells[0];
    const packStr = cells[packIdx] ?? "1";
    const n = parseInt(packStr, 10);
    if (catNo) result[catNo] = isNaN(n) ? 1 : n;
  });
  return result;
}

// ─── Tracking Modal ────────────────────────────────────────────────────────────
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.01);
}

function getRowPricing(o: OrderData, packLookup: Record<string, number>, orderMeta?: any) {
  const item: any = o;
  const orderedQuantity = num(item.orderdata_item_quantity);
  const ready = num(item.readyquantity);
  const unitPrice = num(item.unitPrice ?? item.unit_price ?? item.orderdata_price);
  const packSize = num(item.packSize ?? item.pack_size ?? packLookup[item.orderdata_cat_no]) || 1;
  const explicitPieces = num(item.totalPieces ?? item.total_pieces);
  const explicitPacks = num(item.quantityPacks ?? item.quantity_packs);

  const storedDiscount = num(item.discountAmount ?? item.discount_amount ?? item.orderdata_discount ?? item.order_discount);
  const storedNet = num(item.finalPrice ?? item.final_price ?? item.orderdata_afterDisPrice);
  const storedGross = storedDiscount + storedNet;
  const quantityGross = orderedQuantity * unitPrice;
  const packGross = quantityGross * packSize;

  let pieces = explicitPieces > 0 ? explicitPieces : orderedQuantity * packSize;
  let packs = explicitPacks > 0 ? explicitPacks : orderedQuantity;

  if (explicitPieces <= 0 && storedGross > 0 && unitPrice > 0 && packSize > 1 && !closeTo(quantityGross, storedGross) && closeTo(packGross, storedGross)) {
    pieces = orderedQuantity * packSize;
  }

  if (explicitPacks <= 0 && packSize > 1 && pieces !== orderedQuantity) {
    packs = orderedQuantity;
  }

  const explicitGross = num(item.listPriceTotal ?? item.list_price_total ?? item.listPrice ?? item.list_price);
  const gross = explicitGross > 0 ? explicitGross : storedGross > 0 ? storedGross : unitPrice * pieces;

  const perItemPct = num(item.totalDiscountPercent ?? item.total_discount_percentage ?? item.total_discount ?? item.discount);
  const orderPct = num(orderMeta?.totalDiscountPercentage ?? orderMeta?.discountPercent ?? orderMeta?.allocatedDiscountPercent ?? orderMeta?.allocatedDiscount);
  const derivedPct = gross > 0 && storedDiscount > 0 ? Math.round((storedDiscount / gross) * 10000) / 100 : 0;
  const pct = perItemPct || orderPct || derivedPct;

  const discount = storedDiscount > 0 ? storedDiscount : gross * (pct / 100);
  const final = storedNet > 0 ? storedNet : Math.max(0, gross - discount);

  return {
    orderedQuantity,
    ready,
    left: orderedQuantity - ready,
    pieces,
    packs,
    packSize,
    unitPrice,
    gross,
    discount,
    final,
    pct,
  };
}

function TrackingModal({ orderId, itemName, leftQty, onClose }: {
  orderId: string; itemName: string; leftQty: number; onClose: () => void;
}) {
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${BACKEND}/getremark?id=${orderId}`)
      .then(r => r.json())
      .then(d => { setRemarks(d.data ?? []); setLoading(false); });
  }, [orderId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(12px)", background: "rgba(0,0,0,0.3)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-xl border border-gray-100"
        style={{ animation: "popIn 0.2s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Tracking History</p>
              <h3 className="text-[16px] font-bold text-gray-900 leading-tight">{itemName}</h3>
              <p className="text-[13px] text-gray-500 mt-0.5">
                {leftQty > 0
                  ? <span className="text-red-600 font-semibold">{leftQty} units pending</span>
                  : <span className="text-emerald-600 font-semibold">Fully dispatched</span>}
              </p>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 transition-colors flex-shrink-0">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="border-t border-gray-100 overflow-auto max-h-[50vh]">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-400 text-sm">
              <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
              Loading…
            </div>
          ) : remarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
              </svg>
              <p className="text-[13px]">No tracking history yet.</p>
            </div>
          ) : (
            <div className="px-6 py-4 flex flex-col gap-3">
              {remarks.map((r, i) => (
                <div key={i} className="flex gap-4 items-start">
                  <div className="flex flex-col items-center pt-0.5 flex-shrink-0">
                    <div className="w-2 h-2 rounded-full bg-gray-900" />
                    {i < remarks.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1.5 min-h-[24px]" />}
                  </div>
                  <div className="flex-1 pb-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                        {remarkStatusMap[r.status] ?? r.status}
                      </span>
                      <span className="text-[11px] text-gray-400 font-mono">{r.readyquantity} ready</span>
                      <span className="text-[11px] text-gray-400 ml-auto">{moment(r.datetime).format("DD MMM, hh:mm A")}</span>
                    </div>
                    {r.remark && <p className="text-[13px] text-gray-700">{r.remark}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── View Toggle ───────────────────────────────────────────────────────────────
type ViewMode = "table" | "cards";

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-1">
      {(["table", "cards"] as ViewMode[]).map(m => (
        <button key={m} onClick={() => onChange(m)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${mode === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
          {m === "table" ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          )}
          {m === "table" ? "List" : "Cards"}
        </button>
      ))}
    </div>
  );
}

// ─── Card View ─────────────────────────────────────────────────────────────────
function ItemCard({ o, idx, year, packLookup, orderMeta, onTrack }: { o: OrderData; idx: number; year: number; packLookup: Record<string, number>; orderMeta?: any; onTrack: () => void }) {
  const pricing = getRowPricing(o, packLookup, orderMeta);
  const left    = pricing.left;
  const isDeleted = o.del_status === "1";
  const progressPct = pricing.orderedQuantity > 0
    ? Math.round((pricing.ready / pricing.orderedQuantity) * 100) : 0;
  const isPriority = hasPriorityTag(o.priority, o.isPriority, o.is_priority, o.remark, o.remarks);

  return (
    <div className={`bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-4 hover:border-gray-300 hover:shadow-md transition-all ${isDeleted ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-gray-400 font-mono">#{String(idx + 1).padStart(2, "0")}</span>
            <span className="text-[10px] font-bold text-amber-700 font-mono bg-amber-50 px-2 py-0.5 rounded-full">{o.orderdata_cat_no || "—"}</span>
            {isPriority && (
              <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                Priority
              </span>
            )}
          </div>
          <h3 className="text-[14px] font-bold text-gray-900 truncate">{o.product_name || "—"}</h3>
          {o.product_discription && <p className="text-[12px] text-gray-500 truncate mt-0.5">{o.product_discription}</p>}
          {o.displayRemark && <p className="mt-2 text-[11px] leading-5 text-gray-600">{o.displayRemark}</p>}
        </div>
        <StatusPill code={o.orderdata_status} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-gray-600">Dispatch progress</span>
          <span className="text-[11px] font-mono font-bold text-gray-900">{progressPct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[11px] text-gray-500 font-mono">{pricing.ready} dispatched</span>
          <span className={`text-[11px] font-mono font-semibold ${left > 0 ? "text-red-600" : "text-emerald-600"}`}>
            {left > 0 ? `${left} left` : "complete"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 border-t border-gray-100 pt-4">
        {[
          { label: "Ordered",    val: `${pricing.packs}`, sub: "packs", cls: "text-gray-900" },
          { label: "Price",      val: `₹${pricing.unitPrice.toLocaleString("en-IN")}`, cls: "text-gray-900" },
          { label: "Discount",   val: `${pricing.pct}%`,          cls: "text-amber-700" },
          { label: "Gross",      val: `₹${pricing.gross.toLocaleString("en-IN")}`, cls: "text-gray-500 line-through" },
          { label: "Saved",      val: `−₹${pricing.discount.toLocaleString("en-IN")}`, cls: "text-amber-700" },
          { label: "Final",      val: `₹${pricing.final.toLocaleString("en-IN")}`, cls: "text-emerald-700" },
        ].map(f => (
          <div key={f.label}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{f.label}</p>
            <p className={`text-[13px] font-bold font-mono mt-0.5 ${f.cls}`}>{f.val}{f.sub && <span className="text-[11px] text-gray-500 font-normal"> {f.sub}</span>}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <span className="text-[11px] text-gray-400 font-mono">{o.orderdata_datetime || "—"}</span>
        <button onClick={onTrack} disabled={isDeleted}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all ${isDeleted ? "opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-200" : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50"}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
          </svg>
          Track
        </button>
      </div>
    </div>
  );
}

// ─── Dealer Info Field ─────────────────────────────────────────────────────────
function DealerField({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
      <p className="text-[13px] font-semibold text-gray-900 mt-0.5 break-words">{value}</p>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ViewOrderDealerPage() {
  const params   = useParams();
  const router   = useRouter();
  const id       = params.id as string;
  const tableRef = useRef<HTMLTableElement>(null);
  const year     = new Date().getFullYear();

  const [orders,    setOrders   ] = useState<OrderData[]>([]);
  const [loading,   setLoading  ] = useState(true);
  const [trackItem, setTrackItem] = useState<{ id: string; name: string; leftQty: number } | null>(null);
  const [viewMode,  setViewMode ] = useState<ViewMode>("table");
  const [dealer,    setDealer   ] = useState<DealerInfo | null>(null);
  const [localOrderNote, setLocalOrderNote] = useState("");
  const [packLookup, setPackLookup] = useState<Record<string, number>>({});
  const [orderMeta, setOrderMeta] = useState<any>(null);
  const [summaryOverride, setSummaryOverride] = useState<OrderSummaryOverride | null>(null);
  const [fallbackProductNotes, setFallbackProductNotes] = useState<OrderProductNote[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceToast, setInvoiceToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Read dealer info from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("UserData");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.Dealer_Id) setDealer(parsed as DealerInfo);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!id) return;
    const url = `${BACKEND}/orderdatalist?id=${id}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        logPhpExchange("orderdatalist", {
          method: "GET",
          url,
          request: { id },
          response: d,
        });
        // Normalize different backend shapes:
        // - legacy: d.data = [ { orderdata_... } , ... ]
        // - new   : d.data = { ...orderFields, items: [ { productId, productName, quantityPacks, packSize, totalPieces, ... } ] }
        try {
          const raw = d.data;
          let items: any[] = [];
          if (Array.isArray(raw)) {
            if (raw.length === 0) items = [];
            else if (raw[0] && (raw[0].productId || raw[0].productName || raw[0].quantityPacks !== undefined)) {
              // array of new-style items
              items = raw as any[];
            } else if (raw[0] && raw[0].items && Array.isArray(raw[0].items)) {
              items = raw[0].items;
            } else {
              // assume legacy array of OrderData
              setOrders(raw as OrderData[]);
              setOrderMeta(raw[0] ?? null);
              setLoading(false);
              return;
            }
          } else if (raw && typeof raw === "object") {
            if (Array.isArray(raw.items)) items = raw.items;
            else items = [];
          }

          // Map new-style items into OrderData shape expected by the UI
          const mapped: OrderData[] = (items ?? []).map((it: any, idx: number) => ({
            orderdata_id: String(it.productId ?? it.id ?? `new-${idx}`),
            orderdata_orderid: String(it.orderId ?? id),
            orderdata_cat_no: String(it.productId ?? it.catNo ?? it.orderdata_cat_no ?? ""),
            orderdata_item_quantity: String(it.quantityPacks ?? it.quantity ?? it.orderdata_item_quantity ?? 0),
            orderdata_price: String(it.unitPrice ?? it.unit_price ?? it.orderdata_price ?? 0),
            orderdata_discount: String(it.discountAmount ?? it.orderdata_discount ?? 0),
            orderdata_afterDisPrice: String(it.finalPrice ?? it.final_price ?? it.orderdata_afterDisPrice ?? 0),
            orderdata_status: String(it.status ?? it.orderdata_status ?? "0"),
            orderdata_datetime: String(it.documentDate ?? it.orderdata_datetime ?? d?.order_date ?? new Date().toISOString()),
            product_name: String(it.productName ?? it.product_name ?? ""),
            product_discription: String(it.productDescription ?? it.product_discription ?? ""),
            product_unit: String(it.unit ?? it.product_unit ?? "Pcs"),
            // keep original pack info when available for later calculations
            packSize: it.packSize ?? it.pack_size ?? undefined,
            totalPieces: it.totalPieces ?? it.total_pieces ?? undefined,
            readyquantity: String(it.readyQuantity ?? it.readyquantity ?? 0),
            remark: it.remark ?? it.remarks ?? undefined,
            remarks: it.remarks ?? it.remark ?? undefined,
            priority: it.priority ?? false,
            isPriority: it.isPriority ?? undefined,
            is_priority: it.is_priority ?? undefined,
            discount: String(it.totalDiscountPercent ?? it.discount ?? 0),
            order_discount: String(it.discountAmount ?? 0),
            del_status: String(it.del_status ?? "0"),
            Dealer_Name: d?.Dealer_Name ?? undefined,
            Dealer_Address: d?.Dealer_Address ?? undefined,
            Dealer_Number: d?.Dealer_Number ?? undefined,
            gst: d?.gst ?? undefined,
          }));

          setOrders(mapped);
          // capture order-level metadata if present
          const meta = (Array.isArray(raw) ? (raw[0] ?? {}) : raw) ?? {};
          setOrderMeta(meta);
        } catch (err) {
            setOrders(d.data ?? []);
            const meta = (Array.isArray(d.data) ? (d.data[0] ?? {}) : d.data) ?? {};
            setOrderMeta(meta);
        }
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/order-notes?order_id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.[0]?.note) setLocalOrderNote(json.data[0].note);
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/order-product-notes?orderId=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((json) => {
        if (json.success && Array.isArray(json.data)) {
          setFallbackProductNotes(json.data);
        } else {
          setFallbackProductNotes([]);
        }
      })
      .catch(() => setFallbackProductNotes([]));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/order-summary-overrides?order_id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(json => {
        if (json.success && Array.isArray(json.data)) setSummaryOverride(json.data[0] ?? null);
      })
      .catch(() => {});
  }, [id]);

  // Load product pack sizes (catNo → packSize) from local product data
  useEffect(() => {
    fetch('/data/products.json')
      .then(r => r.json())
      .then((data: any[]) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach(product => {
          const desc = product.Description ?? product.Description ?? "";
          const pmap = parsePackSizes(desc);
          Object.assign(map, pmap);
        });
        setPackLookup(map);
      })
      .catch(() => {});
  }, []);

  const displayOrders = useMemo(
    () => mergeFallbackProductNotes(orders, fallbackProductNotes) as OrderData[],
    [orders, fallbackProductNotes]
  );

  const handleExport = () => {
    if (!tableRef.current) return;
    const wb = XLSX.utils.table_to_book(tableRef.current, { sheet: "Order Details" });
    XLSX.writeFile(wb, `order-${id}-${moment().format("YYYY-MM-DD")}.xlsx`);
  };

  const firstOrder = displayOrders[0];
  const displayOrderMeta = summaryOverride ? { ...(orderMeta ?? {}), ...summaryOverride } : orderMeta;
  // Compute totals from the same row pricing used by the table and cards.
  const calculatedTotals = displayOrders.reduce((acc, o) => {
    const pricing = getRowPricing(o, packLookup, displayOrderMeta);

    return {
      qty: acc.qty + pricing.orderedQuantity,
      pieces: acc.pieces + pricing.pieces,
      gross: acc.gross + pricing.gross,
      discount: acc.discount + pricing.discount,
      final: acc.final + pricing.final,
    };
  }, { qty: 0, pieces: 0, gross: 0, discount: 0, final: 0 });
  const overrideAmounts = summaryOverride
    ? resolveOrderAmounts({
        grossAmount: calculatedTotals.gross,
        discountAmount: calculatedTotals.discount,
        netPayableAmount: calculatedTotals.final,
      }, summaryOverride)
    : null;
  const totals = overrideAmounts
    ? {
        ...calculatedTotals,
        gross: overrideAmounts.gross,
        discount: overrideAmounts.discountAmount,
        final: overrideAmounts.netPayable,
      }
    : calculatedTotals;
  const discountBreakdown = resolveOrderDiscountBreakdown({
    ...(displayOrderMeta ?? {}),
    grossAmount: totals.gross,
    discountAmount: totals.discount,
    netPayableAmount: totals.final,
  }, undefined, { itemDiscountTotal: calculatedTotals.discount });
  const discountSummaryRows = getOrderDiscountSummaryRows(discountBreakdown);
  const additionalDiscountBadge = formatAdditionalDiscountBadge(discountBreakdown);

  const buildInvoiceOrder = () => ({
    ...(displayOrderMeta ?? {}),
    order_id: id,
    order_date: firstOrder?.orderdata_datetime || displayOrderMeta?.order_date || new Date().toISOString(),
    order_amount: totals.gross,
    order_discount: totals.discount,
    order_discount_amount: totals.discount,
    order_net_amount: totals.final,
    grossAmount: totals.gross,
    discountAmount: totals.discount,
    netPayableAmount: totals.final,
    discountPercent: displayOrderMeta?.discountPercent,
    baseDiscountAmount: discountBreakdown.baseDiscountAmount,
    baseDiscountPercent: discountBreakdown.baseDiscountPercent,
    postBaseAmount: discountBreakdown.postBaseAmount,
    additionalDiscountType: discountBreakdown.additionalDiscountType,
    additionalDiscountAmount: discountBreakdown.additionalDiscountAmount,
    customDiscountAmount: discountBreakdown.customDiscountAmount,
    customDiscountPercent: discountBreakdown.customDiscountPercent,
    slabDiscountAmount: discountBreakdown.slabDiscountAmount,
    slabDiscountPercent: discountBreakdown.slabDiscountPercent,
    approvedDiscountPercent: displayOrderMeta?.approvedDiscountPercent,
    allocatedDiscountPercent: displayOrderMeta?.allocatedDiscountPercent,
    Dealer_Name: dealer?.Dealer_Name || firstOrder?.Dealer_Name || displayOrderMeta?.Dealer_Name || "",
    Dealer_Address: dealer?.Dealer_Address || firstOrder?.Dealer_Address || displayOrderMeta?.Dealer_Address || "",
    Dealer_Number: dealer?.Dealer_Number || firstOrder?.Dealer_Number || displayOrderMeta?.Dealer_Number || "",
    gst: dealer?.gst || firstOrder?.gst || displayOrderMeta?.gst || "",
    orderdata_item_quantity: String(totals.qty),
    mtstatus: displayOrderMeta?.mtstatus || firstOrder?.orderdata_status || "",
    outstandingDate: displayOrderMeta?.outstandingDate || "",
    items: displayOrders.map((o) => {
      const pricing = getRowPricing(o, packLookup, displayOrderMeta);
      return {
        id: o.orderdata_id,
        productId: o.orderdata_cat_no,
        catNo: o.orderdata_cat_no,
        productName: o.product_name,
        productDescription: o.product_discription,
        quantityPacks: pricing.packs,
        totalPieces: pricing.pieces,
        packSize: pricing.packSize,
        unitPrice: pricing.unitPrice,
        discountAmount: pricing.discount,
        finalPrice: pricing.final,
        totalDiscountPercent: pricing.pct,
        unit: o.product_unit || "Pcs",
        remark: o.displayRemark ?? o.remark,
        remarks: o.displayRemark ?? o.remarks,
        priority: o.priority,
        isPriority: o.isPriority,
        is_priority: o.is_priority,
      };
    }),
  });

  const handleDownloadInvoice = async () => {
    if (displayOrders.length === 0 || invoiceLoading) return;
    setInvoiceLoading(true);
    const result = await downloadOrderInvoice(buildInvoiceOrder() as any);
    setInvoiceLoading(false);
    setInvoiceToast({
      type: result.success ? "success" : "error",
      text: result.success ? "PDF downloaded" : result.error || "Download failed",
    });
    window.setTimeout(() => setInvoiceToast(null), 3000);
  };

  // Dealer fields to show — in display order, only truthy ones render
  const dealerFields: { label: string; value?: string }[] = dealer ? [
    { label: "Dealer Name",    value: dealer.Dealer_Name      },
    { label: "Dealer Code",    value: dealer.Dealer_Dealercode},
    { label: "City",           value: dealer.Dealer_City      },
    { label: "Address",        value: dealer.Dealer_Address   },
    { label: "Ship To",        value: dealer.Dealer_shipto    },
    { label: "Email",          value: dealer.Dealer_Email     },
    { label: "Phone",          value: dealer.Dealer_Number    },
    { label: "GST",            value: dealer.gst              },
    // { label: "Credit Days",    value: dealer.creditdays       },
    { label: "Discount",       value: dealer.discount ? `${dealer.discount}%` : undefined },
    // { label: "Annual Target",  value: dealer.annualtarget ? `₹${Number(dealer.annualtarget).toLocaleString("en-IN")}` : undefined },
    // { label: "Current Limit",  value: dealer.currentlimit     },
    { label: "Assigned Staff", value: dealer.staffname        },
    // { label: "Notes",          value: dealer.Dealer_Notes     },
  ] : [];

  const visibleDealerFields = dealerFields.filter(f => f.value);
  const orderNote = extractOrderNote(displayOrders, localOrderNote);

  return (
    <>
      <style>{`
        @keyframes popIn {
          from { transform: scale(0.95) translateY(8px); opacity: 0; }
          to   { transform: scale(1) translateY(0); opacity: 1; }
        }
        .track-btn { opacity: 0; transition: opacity 0.1s; }
        tr:hover .track-btn { opacity: 1; }
      `}</style>

      <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

        {/* Top bar */}
        <div className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-[12.5px] font-medium text-gray-600 hover:bg-gray-100 transition-all">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
              Back
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-[18px] font-bold text-gray-900">Order Details</h1>
                {firstOrder?.orderdata_orderid && (
                  <span className="font-mono text-[12px] font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg">
                    OM/{year}/{firstOrder.orderdata_orderid}
                  </span>
                )}
              </div>
              {dealer?.Dealer_Name && (
                <p className="text-[13px] text-gray-500 mt-0.5">{dealer.Dealer_Name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <button onClick={handleDownloadInvoice} disabled={invoiceLoading || loading || displayOrders.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 text-[13px] font-semibold rounded-xl border border-gray-200 transition-colors">
              {invoiceLoading ? (
                <div className="w-3.5 h-3.5 border-2 border-gray-200 border-t-gray-700 rounded-full animate-spin" />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" />
                </svg>
              )}
              Get a copy
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-[13px] font-semibold rounded-xl transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Export
            </button>
          </div>
        </div>

        <div className="px-8 py-6 max-w-[1600px] mx-auto space-y-5">

          {/* ── Dealer Info Card ── */}
          {visibleDealerFields.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Dealer Information</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-8 gap-y-4">
                {visibleDealerFields.map(f => (
                  <DealerField key={f.label} label={f.label} value={f.value} />
                ))}
              </div>
            </div>
          )}

          {orderNote && (
            <div className="bg-white border border-indigo-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                  </svg>
                </div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Order Note</p>
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-6 text-gray-700">{orderNote}</p>
            </div>
          )}

          {/* ── Totals ── */}
          {!loading && displayOrders.length > 0 && (
            <div className="space-y-3">
              {additionalDiscountBadge && (
                <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-700">
                  {additionalDiscountBadge}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {discountSummaryRows.map((row) => (
                  <div key={row.key} className="bg-white border border-gray-200 rounded-2xl px-5 py-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{row.label}</p>
                    <p className={`text-[20px] font-bold font-mono mt-1 ${
                      row.key === "gross" ? "text-gray-900"
                        : row.key === "net" ? "text-emerald-700"
                          : "text-amber-700"
                    }`}>
                      ₹{row.amount.toLocaleString("en-IN")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div className="bg-white border border-gray-200 rounded-2xl flex items-center justify-center py-20 gap-3 text-gray-500">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
              <span className="text-[14px]">Loading order details…</span>
            </div>
          )}

          {/* ── Empty ── */}
          {!loading && displayOrders.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
              </svg>
              <p className="text-[14px]">No order items found.</p>
            </div>
          )}

          {/* ── Card View ── */}
          {!loading && displayOrders.length > 0 && viewMode === "cards" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {displayOrders.map((o, idx) => {
                const pricing = getRowPricing(o, packLookup, displayOrderMeta);
                return (
                  <ItemCard key={o.orderdata_id} o={o} idx={idx} year={year} packLookup={packLookup} orderMeta={displayOrderMeta}
                    onTrack={() => setTrackItem({ id: o.orderdata_id, name: o.product_name || o.orderdata_cat_no, leftQty: pricing.left })} />
                );
              })}
            </div>
          )}

          {/* ── Table View ── */}
          {!loading && displayOrders.length > 0 && viewMode === "table" && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table ref={tableRef} className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {["#","Order No","Cat No.","Product","Description","Qty","Pack Size","Pieces","Dispatched","Left","Unit","Price","Disc %","Amount","Discount","Final","Status","Date",""].map(h => (
                        <th key={h} className="px-4 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 whitespace-nowrap bg-gray-50/80">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {displayOrders.map((o, idx) => {
                      const pricing = getRowPricing(o, packLookup, displayOrderMeta);
                      const left = pricing.left;
                      const isDeleted = o.del_status === "1";
                      const isPriority = hasPriorityTag(o.priority, o.isPriority, o.is_priority, o.remark, o.remarks);
                      return (
                        <tr key={o.orderdata_id} className={`group hover:bg-gray-50/80 transition-colors ${isDeleted ? "opacity-40" : ""}`}>
                          <td className="px-4 py-3.5 text-[11px] text-gray-400 font-mono font-semibold">{String(idx + 1).padStart(2, "0")}</td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="font-mono text-[11px] font-bold text-indigo-600">OM/{year}/{o.orderdata_orderid}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-[12px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg w-fit">{o.orderdata_cat_no || "—"}</span>
                              {isPriority && (
                                <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full w-fit">
                                  Priority
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 max-w-[160px]">
                            <span className="block truncate text-[13px] font-semibold text-gray-900">{o.product_name || "—"}</span>
                          </td>
                          <td className="px-4 py-3.5 max-w-[140px]">
                            <span className="block truncate text-[12px] text-gray-600">{o.product_discription || "—"}</span>
                            {o.displayRemark && (
                              <span className="mt-1 block text-[11px] leading-5 text-gray-500">{o.displayRemark}</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono font-bold text-gray-900">{pricing.packs}</td>
                          <td className="px-4 py-3.5 font-mono font-bold text-amber-700">{pricing.packs} × {pricing.packSize}</td>
                          <td className="px-4 py-3.5 font-mono font-bold text-gray-900">{pricing.pieces}</td>
                          <td className="px-4 py-3.5 font-mono font-semibold text-emerald-600">{pricing.ready}</td>
                          <td className="px-4 py-3.5 font-mono font-bold" style={{ color: left > 0 ? "#dc2626" : "#9ca3af" }}>{left}</td>
                          <td className="px-4 py-3.5 text-[12px] text-gray-600">{o.product_unit || "—"}</td>
                          <td className="px-4 py-3.5 font-mono text-gray-900 font-semibold">₹{pricing.unitPrice.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3.5 font-mono text-gray-900">{pricing.pct}%</td>
                          <td className="px-4 py-3.5 font-mono text-gray-500 line-through text-[12px]">₹{pricing.gross.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3.5 font-mono text-amber-700 font-semibold">−₹{pricing.discount.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3.5 font-mono font-bold text-emerald-700">₹{pricing.final.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3.5"><StatusPill code={o.orderdata_status} /></td>
                          <td className="px-4 py-3.5 text-[11px] text-gray-500 font-mono whitespace-nowrap">{o.orderdata_datetime || "—"}</td>
                          <td className="px-4 py-3.5 w-px">
                            <div className="track-btn">
                              <button
                                onClick={() => !isDeleted && setTrackItem({ id: o.orderdata_id, name: o.product_name || o.orderdata_cat_no, leftQty: left })}
                                disabled={isDeleted}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all whitespace-nowrap ${isDeleted ? "opacity-30 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-100" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-200 hover:text-indigo-600 hover:bg-indigo-50"}`}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                </svg>
                                Track
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {invoiceToast && (
        <div className={`fixed bottom-4 right-4 z-50 rounded-xl px-4 py-3 text-[13px] font-semibold shadow-lg border ${
          invoiceToast.type === "success"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {invoiceToast.text}
        </div>
      )}

      {trackItem && (
        <TrackingModal orderId={trackItem.id} itemName={trackItem.name} leftQty={trackItem.leftQty} onClose={() => setTrackItem(null)} />
      )}
    </>
  );
}
