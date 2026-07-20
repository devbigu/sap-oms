"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import moment from "moment";
import * as XLSX from "xlsx";
import { hasPriorityTag } from "@/lib/orderPriority";
import { downloadOrderInvoice, type OrderInvoiceData } from "@/lib/invoicegenerator";
import {
  formatAdditionalDiscountBadge,
  getOrderDiscountSummaryRows,
  resolveOrderAmounts,
  resolveOrderDiscountBreakdown,
} from "@/lib/orderAmounts";
import { mergeFallbackProductNotes } from "@/lib/orderProductNotes.mjs";
import ProductDispatchPanel from "@/components/orders/ProductDispatchPanel";
import {
  mergeOrderItemsWithDispatchRecords,
  canUserEditDispatch,
  type DispatchUserSession,
  type OrderDispatchRecord,
  type DispatchStatus,
} from "@/lib/orderDispatch";
import { PenLine, Trash2 } from "lucide-react";


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
  accept_order?: string;
  staffid?: string;
  assignedstaff?: string;
  orderdata_dealerid?: string;
  Dealer_Name?: string;
  Dealer_Address?: string;
  Dealer_Number?: string;
  gst?: string;
  order_dealer?: string;
  packSize?: number | string;
  pack_size?: number | string;
  totalPieces?: number | string;
  total_pieces?: number | string;
  quantityPacks?: number | string;
  quantity_packs?: number | string;
  unitPrice?: number | string;
  unit_price?: number | string;
  listPriceTotal?: number | string;
  list_price_total?: number | string;
  listPrice?: number | string;
  list_price?: number | string;
  discountAmount?: number | string;
  discount_amount?: number | string;
  finalPrice?: number | string;
  final_price?: number | string;
  totalDiscountPercent?: number | string;
  total_discount_percentage?: number | string;
  total_discount?: number | string;
  orderItemId?: string | null;
  orderedQuantity?: number;
  dispatchedQuantity?: number;
  remainingQuantity?: number;
  dispatchStatus?: DispatchStatus;
  dispatchHistory?: Array<{
    id: string;
    quantity: number;
    remark: string;
    status: DispatchStatus;
    actorId: string;
    actorRole: "staff" | "admin";
    createdAt: string | Date;
  }>;
  occurrence?: number;
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

type ActiveOrderHeader = Record<string, unknown>;

type OrderProductNote = {
  orderId?: string;
  orderItemId?: string | null;
  sku?: string;
  normalizedSku?: string;
  occurrence?: number;
  note?: string;
};

type OrderMeta = Record<string, unknown> & {
  accept_order?: string;
  staffid?: string;
  assignedstaff?: string;
  order_dealer?: string;
  orderdata_dealerid?: string;
  del_status?: string;
  order_status?: string;
  Dealer_Name?: string;
  Dealer_Address?: string;
  Dealer_Number?: string;
  gst?: string;
  mtstatus?: string;
  order_date?: string;
  outstandingDate?: string;
  totalDiscountPercentage?: number | string;
  discountPercent?: number | string;
  allocatedDiscountPercent?: number | string;
  allocatedDiscount?: number | string;
  approvedDiscountPercent?: number | string;
  items?: unknown[];
};

type OrderApiItem = Record<string, unknown> & {
  productId?: unknown;
  id?: unknown;
  orderId?: unknown;
  catNo?: unknown;
  orderdata_cat_no?: unknown;
  quantityPacks?: unknown;
  quantity?: unknown;
  orderdata_item_quantity?: unknown;
  unitPrice?: unknown;
  unit_price?: unknown;
  orderdata_price?: unknown;
  discountAmount?: unknown;
  orderdata_discount?: unknown;
  finalPrice?: unknown;
  final_price?: unknown;
  orderdata_afterDisPrice?: unknown;
  status?: unknown;
  orderdata_status?: unknown;
  documentDate?: unknown;
  orderdata_datetime?: unknown;
  productName?: unknown;
  product_name?: unknown;
  productDescription?: unknown;
  product_discription?: unknown;
  unit?: unknown;
  product_unit?: unknown;
  packSize?: unknown;
  pack_size?: unknown;
  totalPieces?: unknown;
  total_pieces?: unknown;
  readyQuantity?: unknown;
  readyquantity?: unknown;
  remark?: unknown;
  remarks?: unknown;
  priority?: unknown;
  isPriority?: unknown;
  is_priority?: unknown;
  totalDiscountPercent?: unknown;
  discount?: unknown;
  del_status?: unknown;
  accept_order?: unknown;
  staffid?: unknown;
  assignedstaff?: unknown;
  order_dealer?: unknown;
  orderdata_dealerid?: unknown;
};

type DispatchRecordResponse = OrderDispatchRecord & {
  remainingQuantity?: number;
};

type OrderDispatchAccessMeta = {
  accept_order?: string;
  staffid?: string;
  assignedstaff?: string;
  del_status?: string;
  order_status?: string;
  order_dealer?: string;
};

type OrderDispatchAccessState = {
  key: string;
  meta: OrderDispatchAccessMeta | null;
};

type EffectiveOrderOverlayState = {
  isCancelled: boolean;
  isEdited: boolean;
  latestRevision: number;
  cancellation?: { reason?: string; cancelledAt?: string; cancelledBy?: { id?: string; role?: string; name?: string } } | null;
  eligibility?: { canDealerChange?: boolean; reason?: string } | null;
  changeHistory?: Array<{ summary?: string; type?: string }>;
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

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function orderLookupKey(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const trailing = text.match(/(\d+)(?!.*\d)/)?.[1];
  if (!trailing) return text;
  const normalized = String(Number(trailing));
  return normalized === "NaN" ? trailing : normalized;
}

async function fetchOrderDispatchAccessMeta(
  orderId: string,
  dealerId: string,
  actor: DispatchUserSession
): Promise<OrderDispatchAccessMeta | null> {
  const source = actor.role === "dealer" || actor.role === "staff" ? "orderhispegination" : "orderpegination";
  const targetDealer = actor.role === "staff" && dealerId
    ? `&target_dealer=${encodeURIComponent(dealerId)}`
    : "";
  const url = `/api/orders-data?source=${source}&role=${encodeURIComponent(actor.role)}&page=1&limit=20&search=${encodeURIComponent(orderId)}${actor.id ? `&id=${encodeURIComponent(actor.id)}` : ""}${targetDealer}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`orderhispegination failed with ${response.status}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const matched = rows.find((entry: Record<string, unknown>) => String(entry?.order_id ?? "").trim() === String(orderId).trim()) ?? rows[0];
  if (!matched) return null;

  return {
    accept_order: firstNonEmptyString(matched.accept_order),
    staffid: firstNonEmptyString(matched.staffid),
    assignedstaff: firstNonEmptyString(matched.assignedstaff),
    del_status: firstNonEmptyString(matched.del_status),
    order_status: firstNonEmptyString(matched.order_status),
    order_dealer: firstNonEmptyString(matched.order_dealer),
  };
}

function resolveCurrentUser(): DispatchUserSession | null {
  if (typeof window === "undefined") return null;

  try {
    const staffRaw = localStorage.getItem("staffData");
    if (staffRaw) {
      const parsed = JSON.parse(staffRaw);
      if (parsed?.staff_id) {
        return {
          role: parsed.staff_roletype === "0" ? "admin" : "staff",
          id: String(parsed.staff_id),
          name: parsed.staff_name || "",
          roletype: String(parsed.staff_roletype ?? ""),
        };
      }
    }

    const userRaw = localStorage.getItem("UserData");
    if (userRaw) {
      const parsed = JSON.parse(userRaw);
      if (parsed?.Dealer_Id) {
        return {
          role: "dealer",
          id: String(parsed.Dealer_Id),
          name: parsed.Dealer_Name || "",
        };
      }
      if (parsed?.staff_id) {
        return {
          role: parsed.staff_roletype === "0" ? "admin" : "staff",
          id: String(parsed.staff_id),
          name: parsed.staff_name || "",
          roletype: String(parsed.staff_roletype ?? ""),
        };
      }
      if (localStorage.getItem("roletype") === "3" && parsed && Object.keys(parsed).length > 0) {
        return {
          role: "admin",
          id: String(parsed.id || parsed.admin_id || parsed.Admin_Id || ""),
          name: parsed.name || parsed.email || "Admin",
          roletype: "0",
        };
      }
    }

    const adminRaw = localStorage.getItem("AdminData") || localStorage.getItem("admin");
    if (adminRaw) {
      const parsed = JSON.parse(adminRaw);
      if (parsed && Object.keys(parsed).length > 0) {
        return {
          role: "admin",
          id: String(parsed.id || parsed.admin_id || parsed.Admin_Id || ""),
          name: parsed.name || "Admin",
          roletype: "0",
        };
      }
    }
  } catch {}

  return null;
}

function buildDispatchHeaders(user: DispatchUserSession | null): HeadersInit {
  return {
    ...(user?.id ? { "x-omsons-actor-id": user.id } : {}),
    ...(user?.role ? { "x-omsons-actor-role": user.role } : {}),
    ...(user?.roletype ? { "x-omsons-actor-roletype": user.roletype } : {}),
  };
}

function orderAccessMessage(status: number, payload: Record<string, unknown> | null) {
  if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
  if (payload?.reason === "not_found" || status === 404) return "Order not found.";
  if (payload?.reason === "forbidden" || status === 403) return "This order is outside your assigned order scope.";
  if (payload?.reason === "upstream_unavailable" || status === 503 || status === 502) {
    return "Order verification is temporarily unavailable.";
  }
  if (status === 401) return "Access denied.";
  return "Unable to load this order right now.";
}

function buildDispatchRecordFallbackKey(record: Partial<OrderDispatchRecord>) {
  return [
    String(record.orderId ?? "").trim(),
    String(record.normalizedSku ?? record.sku ?? "").trim().toLowerCase(),
    String(record.occurrence ?? ""),
  ].join("::");
}

// ─── Status config ─────────────────────────────────────────────────────────────
const itemStatusMap: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  "0": { label: "In Process",   dot: "bg-amber-400",   text: "text-amber-700",   bg: "bg-amber-50"   },
  "1": { label: "Processing",   dot: "bg-blue-400",    text: "text-blue-700",    bg: "bg-blue-50"    },
  "2": { label: "Dispatched",   dot: "bg-indigo-400",  text: "text-indigo-700",  bg: "bg-indigo-50"  },
  "3": { label: "Not in Stock", dot: "bg-red-400",     text: "text-red-700",     bg: "bg-red-50"     },
  "4": { label: "Successful",   dot: "bg-emerald-400", text: "text-emerald-700", bg: "bg-emerald-50" },
  pending: { label: "Pending", dot: "bg-amber-400", text: "text-amber-700", bg: "bg-amber-50" },
  packing: { label: "Packing", dot: "bg-blue-400", text: "text-blue-700", bg: "bg-blue-50" },
  dispatched: { label: "Dispatched", dot: "bg-indigo-400", text: "text-indigo-700", bg: "bg-indigo-50" },
  not_in_stock: { label: "Not in Stock", dot: "bg-red-400", text: "text-red-700", bg: "bg-red-50" },
  successful: { label: "Successful", dot: "bg-emerald-400", text: "text-emerald-700", bg: "bg-emerald-50" },
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.01);
}

type RowPricing = {
  orderedQuantity: number;
  ready: number;
  left: number;
  pieces: number;
  packs: number;
  packSize: number;
  unitPrice: number;
  gross: number;
  discount: number;
  final: number;
  pct: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rebalanceRowDiscounts(pricings: RowPricing[], targetDiscountTotal: number): RowPricing[] {
  const activeRows = pricings
    .map((pricing, index) => ({ pricing, index }))
    .filter(({ pricing }) => pricing.gross > 0);

  if (activeRows.length === 0) return pricings;

  const totalGross = activeRows.reduce((sum, row) => sum + row.pricing.gross, 0);
  if (!(totalGross > 0)) return pricings;

  const lastActiveIndex = activeRows[activeRows.length - 1]?.index ?? pricings.length - 1;
  let allocatedDiscount = 0;

  return pricings.map((pricing, index) => {
    if (!(pricing.gross > 0)) {
      return {
        ...pricing,
        discount: 0,
        final: roundMoney(pricing.gross),
        pct: 0,
      };
    }

    const nextDiscount = index === lastActiveIndex
      ? roundMoney(Math.max(0, targetDiscountTotal - allocatedDiscount))
      : roundMoney((targetDiscountTotal * pricing.gross) / totalGross);

    allocatedDiscount += nextDiscount;

    const discount = Math.min(roundMoney(pricing.gross), Math.max(0, nextDiscount));
    const final = roundMoney(Math.max(0, pricing.gross - discount));
    const pct = pricing.gross > 0 ? roundMoney((discount / pricing.gross) * 100) : 0;

    return {
      ...pricing,
      discount,
      final,
      pct,
    };
  });
}

function getRowPricing(o: OrderData, packLookup: Record<string, number>, orderMeta?: OrderMeta | null) {
  const orderedQuantity = num(o.orderdata_item_quantity);
  const ready = num(o.dispatchedQuantity ?? o.readyquantity);
  const unitPrice = num(o.unitPrice ?? o.unit_price ?? o.orderdata_price);
  const packSize = num(o.packSize ?? o.pack_size ?? packLookup[o.orderdata_cat_no]) || 1;
  const explicitPieces = num(o.totalPieces ?? o.total_pieces);
  const explicitPacks = num(o.quantityPacks ?? o.quantity_packs);

  const storedDiscount = num(o.discountAmount ?? o.discount_amount ?? o.orderdata_discount ?? o.order_discount);
  const storedNet = num(o.finalPrice ?? o.final_price ?? o.orderdata_afterDisPrice);
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

  const explicitGross = num(o.listPriceTotal ?? o.list_price_total ?? o.listPrice ?? o.list_price);
  const gross = explicitGross > 0 ? explicitGross : storedGross > 0 ? storedGross : unitPrice * pieces;

  const perItemPct = num(o.totalDiscountPercent ?? o.total_discount_percentage ?? o.total_discount ?? o.discount);
  const orderPct = num(orderMeta?.totalDiscountPercentage ?? orderMeta?.discountPercent ?? orderMeta?.allocatedDiscountPercent ?? orderMeta?.allocatedDiscount);
  const derivedPct = gross > 0 && storedDiscount > 0 ? Math.round((storedDiscount / gross) * 10000) / 100 : 0;
  const pct = perItemPct || orderPct || derivedPct;

  const discount = storedDiscount > 0 ? storedDiscount : gross * (pct / 100);
  const final = storedNet > 0 ? storedNet : Math.max(0, gross - discount);

  return {
    orderedQuantity,
    ready,
    left: typeof o.remainingQuantity === "number" ? o.remainingQuantity : orderedQuantity - ready,
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

export function LegacyTrackingModal() {
  return null;
}

// ─── View Toggle ───────────────────────────────────────────────────────────────
function TrackingModal({
  isOpen,
  orderId,
  dealerId,
  assignedStaffId,
  acceptOrder,
  delStatus,
  items,
  currentUser,
  selectedItemId,
  onClose,
  onRecordSaved,
}: {
  isOpen: boolean;
  orderId: string;
  dealerId?: string;
  assignedStaffId?: string;
  acceptOrder?: string;
  delStatus?: string;
  items: OrderData[];
  currentUser: DispatchUserSession | null;
  selectedItemId: string | null;
  onClose: () => void;
  onRecordSaved: (record: OrderDispatchRecord) => void;
}) {
  return (
    <ProductDispatchPanel
      isOpen={isOpen}
      orderId={orderId}
      dealerId={dealerId}
      assignedStaffId={assignedStaffId}
      acceptOrder={acceptOrder}
      delStatus={delStatus}
      items={items}
      currentUser={currentUser}
      selectedItemId={selectedItemId}
      onClose={onClose}
      onRecordSaved={onRecordSaved}
    />
  );
}

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
function ItemCard({
  o,
  idx,
  pricing,
  additionalDiscountType,
  onDispatch,
  dispatchLabel,
}: {
  o: OrderData;
  idx: number;
  pricing: RowPricing;
  additionalDiscountType: "slab" | "custom" | null;
  onDispatch: () => void;
  dispatchLabel: string;
}) {
  const left    = pricing.left;
  const isDeleted = o.del_status === "1";
  const originalRemarksText = [o.remark, o.remarks].filter(Boolean).join(" | ");
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
          {o.fallbackProductNote && <p className="mt-2 text-[11px] leading-5 text-indigo-700">Product Note: {o.fallbackProductNote}</p>}
          {originalRemarksText && <p className="mt-2 text-[11px] leading-5 text-gray-600">{originalRemarksText}</p>}
        </div>
        <StatusPill code={String(o.dispatchStatus ?? o.orderdata_status ?? "0")} />
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
          { label: "Discount",   val: `${pricing.pct}%`, sub: additionalDiscountType ? `incl. ${additionalDiscountType}` : undefined, cls: "text-amber-700" },
          { label: "Gross",      val: `₹${pricing.gross.toLocaleString("en-IN")}`, cls: "text-gray-500 line-through" },
          { label: "Saved",      val: `−₹${pricing.discount.toLocaleString("en-IN")}`, sub: additionalDiscountType ? `incl. ${additionalDiscountType}` : undefined, cls: "text-amber-700" },
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
        <button onClick={onDispatch} disabled={isDeleted}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all ${isDeleted ? "opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-200" : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50"}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
          </svg>
          {dispatchLabel}
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

function CancelOrderDialog({
  orderId,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  orderId: string;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <h2 className="text-base font-bold text-gray-900">Cancel this order?</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">This action will remove order OM/{new Date().getFullYear()}/{orderId} from the active fulfilment workflow. The original order record will be preserved.</p>
        <label className="mt-5 block text-[11px] font-bold uppercase tracking-wider text-gray-500">Cancellation reason</label>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, 1000))}
          disabled={saving}
          className="mt-2 text-gray-900 h-28 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100"
        />
        {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Keep Order</button>
          <button type="button" onClick={() => onConfirm(reason)} disabled={saving} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {saving ? "Cancelling..." : "Cancel Order"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditOrderDialog({
  items,
  latestRevision,
  saving,
  error,
  onClose,
  onSave,
}: {
  items: OrderData[];
  latestRevision: number;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (payload: { expectedRevision: number; items: Array<Record<string, unknown>> }) => void;
}) {
  const [draftItems, setDraftItems] = useState(() => items.map((item) => ({ ...item, originalLineId: item.orderdata_id })));
  const [reviewing, setReviewing] = useState(false);
  const visibleItems = draftItems.filter((item) => !(item as Record<string, unknown>)._removed);
  const changeSummaries = draftItems.flatMap((item) => {
    const original = items.find((entry) => entry.orderdata_id === item.originalLineId);
    if (!original) return [];
    if ((item as Record<string, unknown>)._removed) return [`Removed: ${original.product_name || original.orderdata_cat_no}`];
    const changes: string[] = [];
    if (String(original.orderdata_cat_no) !== String(item.orderdata_cat_no)) changes.push(`Replaced ${original.orderdata_cat_no} with ${item.orderdata_cat_no}`);
    if (String(original.orderdata_item_quantity) !== String(item.orderdata_item_quantity)) changes.push(`Quantity ${original.orderdata_item_quantity} to ${item.orderdata_item_quantity} for ${item.product_name || item.orderdata_cat_no}`);
    return changes;
  });

  const updateItem = (lineId: string, patch: Partial<OrderData>) => {
    setDraftItems((current) => current.map((item) => item.originalLineId === lineId ? { ...item, ...patch } : item));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="w-full max-w-5xl rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">Edit Order Items</h2>
            <p className="mt-1 text-sm text-gray-600">Remove items, replace catalogue details, or correct quantities before acceptance.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600">Close</button>
        </div>
        {!reviewing ? (
          <div className="mt-5 max-h-[60vh] overflow-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <tr><th className="p-3 text-gray-900">Cat No.</th><th className="p-3">Product</th><th className="p-3">Qty</th><th className="p-3">Pack</th><th className="p-3">Note</th><th className="p-3">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {draftItems.map((item) => {
                  const removed = !!(item as Record<string, unknown>)._removed;
                  return (
                    <tr key={item.originalLineId} className={removed ? "opacity-95" : ""}>
                      <td className="p-3 text-gray-900"><input value={String(item.orderdata_cat_no ?? "")} disabled={removed || saving} onChange={(event) => updateItem(item.originalLineId, { orderdata_cat_no: event.target.value })} className="w-36 rounded-lg border border-gray-200 px-2 py-1.5 font-mono text-xs" /></td>
                      <td className="p-3 text-gray-900"><input value={String(item.product_name ?? "")} disabled={removed || saving} onChange={(event) => updateItem(item.originalLineId, { product_name: event.target.value })} className="w-64 rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></td>
                      <td className="p-3 text-gray-900"><input type="number" min="1" value={String(item.orderdata_item_quantity ?? "")} disabled={removed || saving} onChange={(event) => updateItem(item.originalLineId, { orderdata_item_quantity: event.target.value })} className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></td>
                      <td className="p-3 text-gray-900"><input type="number" min="1" value={String(item.packSize ?? item.pack_size ?? 1)} disabled={removed || saving} onChange={(event) => updateItem(item.originalLineId, { packSize: event.target.value })} className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></td>
                      <td className="p-3 text-xs text-gray-900">{item.fallbackProductNote || item.remark || "—"}</td>
                      <td className="p-3">
                        <button type="button" disabled={saving} onClick={() => updateItem(item.originalLineId, { _removed: !removed } as Partial<OrderData>)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700">
                          {removed ? "Restore" : "Remove"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Review Changes</p>
            {changeSummaries.length === 0 ? <p className="mt-2 text-sm text-amber-800">No changes detected.</p> : (
              <ul className="mt-2 space-y-1 text-sm text-amber-900">{changeSummaries.map((summary, index) => <li key={index}>{summary}</li>)}</ul>
            )}
          </div>
        )}
        {visibleItems.length === 0 && <p className="mt-3 text-sm font-medium text-red-600">An edited order cannot be saved with no items. Use Cancel Order instead.</p>}
        {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          {reviewing && <button type="button" onClick={() => setReviewing(false)} disabled={saving} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700">Back</button>}
          {!reviewing ? (
            <button type="button" onClick={() => setReviewing(true)} disabled={saving || visibleItems.length === 0} className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Review Changes</button>
          ) : (
            <button type="button" disabled={saving || visibleItems.length === 0 || changeSummaries.length === 0} onClick={() => onSave({ expectedRevision: latestRevision, items: visibleItems })} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? "Saving..." : "Save Edit"}
            </button>
          )}
        </div>
      </div>
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
  const [orderAccessBlocked, setOrderAccessBlocked] = useState(false);
  const [orderUnavailableMessage, setOrderUnavailableMessage] = useState("Unable to load this order right now.");
  const [orderAccessVerified, setOrderAccessVerified] = useState(false);
  const [viewMode,  setViewMode ] = useState<ViewMode>("table");
  const [localOrderNote, setLocalOrderNote] = useState("");
  const [packLookup, setPackLookup] = useState<Record<string, number>>({});
  const [orderMeta, setOrderMeta] = useState<OrderMeta | null>(null);
  const [activeOrderHeader, setActiveOrderHeader] = useState<ActiveOrderHeader | null>(null);
  const [orderAccessState, setOrderAccessState] = useState<OrderDispatchAccessState>({ key: "", meta: null });
  const [summaryOverride, setSummaryOverride] = useState<OrderSummaryOverride | null>(null);
  const [fallbackProductNotes, setFallbackProductNotes] = useState<OrderProductNote[]>([]);
  const [dispatchRecords, setDispatchRecords] = useState<DispatchRecordResponse[]>([]);
  const [activeDispatchItemId, setActiveDispatchItemId] = useState<string | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceToast, setInvoiceToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [overlayState, setOverlayState] = useState<EffectiveOrderOverlayState | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const dealer = useMemo<DealerInfo | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("UserData");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.Dealer_Id ? parsed as DealerInfo : null;
    } catch {
      return null;
    }
  }, []);
  const currentUser = useMemo<DispatchUserSession | null>(() => resolveCurrentUser(), []);
  const orderAccessDealerId = useMemo(
    () => firstNonEmptyString(
      orders[0]?.order_dealer,
      orders[0]?.orderdata_dealerid,
      orderMeta?.order_dealer,
      orderMeta?.orderdata_dealerid,
      activeOrderHeader?.order_dealer,
      activeOrderHeader?.orderdata_dealerid,
      activeOrderHeader?.Dealer_Id
    ),
    [activeOrderHeader, orderMeta, orders]
  );
  const orderAccessKey = useMemo(
    () => (id && orderAccessDealerId ? `${id}:${orderAccessDealerId}` : ""),
    [id, orderAccessDealerId]
  );
  const orderAccessMeta = orderAccessState.key === orderAccessKey ? orderAccessState.meta : null;

  useEffect(() => {
    if (!id) return;
    const url = `${BACKEND}/orderdatalist?id=${id}`;
    fetch(`/api/order-access/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: buildDispatchHeaders(currentUser),
    })
      .then(async accessResponse => {
        if (!accessResponse.ok) {
          const accessPayload = await accessResponse.json().catch(() => null);
          setOrderAccessBlocked(true);
          setOrderUnavailableMessage(orderAccessMessage(accessResponse.status, accessPayload));
          setOrderAccessVerified(false);
          setActiveOrderHeader(null);
          setLoading(false);
          return null;
        }
        const accessPayload = await accessResponse.json().catch(() => null);
        setActiveOrderHeader(
          accessPayload?.data && typeof accessPayload.data === "object"
            ? accessPayload.data as ActiveOrderHeader
            : null
        );
        setOrderAccessBlocked(false);
        setOrderUnavailableMessage("Unable to load this order right now.");
        setOrderAccessVerified(true);
        return fetch(url);
      })
      .then(r => r ? r.json() : null)
      .then(d => {
        if (!d) return;
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
          const raw: unknown = d.data;
          let items: OrderApiItem[] = [];
          const rawMeta = Array.isArray(raw) ? asRecord(raw[0]) : asRecord(raw);

          if (Array.isArray(raw)) {
            if (raw.length === 0) {
              items = [];
            } else if (rawMeta.productId || rawMeta.productName || rawMeta.quantityPacks !== undefined) {
              items = raw.map((entry) => asRecord(entry) as OrderApiItem);
            } else if (Array.isArray(rawMeta.items)) {
              items = rawMeta.items.map((entry) => asRecord(entry) as OrderApiItem);
            } else {
              setOrders(raw as OrderData[]);
              setOrderMeta(rawMeta as OrderMeta);
              setLoading(false);
              return;
            }
          } else if (Array.isArray(rawMeta.items)) {
            items = rawMeta.items.map((entry) => asRecord(entry) as OrderApiItem);
          }

          const mapped: OrderData[] = items.map((it, idx) => ({
            orderdata_id: String(it.productId ?? it.id ?? `new-${idx}`),
            orderdata_orderid: String(it.orderId ?? id),
            orderdata_cat_no: String(it.productId ?? it.catNo ?? it.orderdata_cat_no ?? ""),
            orderdata_item_quantity: String(it.quantityPacks ?? it.quantity ?? it.orderdata_item_quantity ?? 0),
            orderdata_price: String(it.unitPrice ?? it.unit_price ?? it.orderdata_price ?? 0),
            orderdata_discount: String(it.discountAmount ?? it.orderdata_discount ?? 0),
            orderdata_afterDisPrice: String(it.finalPrice ?? it.final_price ?? it.orderdata_afterDisPrice ?? 0),
            orderdata_status: String(it.status ?? it.orderdata_status ?? "0"),
            orderdata_datetime: String(it.documentDate ?? it.orderdata_datetime ?? rawMeta.order_date ?? new Date().toISOString()),
            product_name: String(it.productName ?? it.product_name ?? ""),
            product_discription: String(it.productDescription ?? it.product_discription ?? ""),
            product_unit: String(it.unit ?? it.product_unit ?? "Pcs"),
            packSize: asStringOrNumber(it.packSize) ?? asStringOrNumber(it.pack_size),
            totalPieces: asStringOrNumber(it.totalPieces) ?? asStringOrNumber(it.total_pieces),
            readyquantity: String(it.readyQuantity ?? it.readyquantity ?? 0),
            remark: typeof it.remark === "string" ? it.remark : typeof it.remarks === "string" ? it.remarks : undefined,
            remarks: typeof it.remarks === "string" ? it.remarks : typeof it.remark === "string" ? it.remark : undefined,
            priority: typeof it.priority === "string" || typeof it.priority === "boolean" ? it.priority : false,
            isPriority: typeof it.isPriority === "string" || typeof it.isPriority === "boolean" ? it.isPriority : undefined,
            is_priority: typeof it.is_priority === "string" || typeof it.is_priority === "boolean" ? it.is_priority : undefined,
            discount: String(it.totalDiscountPercent ?? it.discount ?? 0),
            order_discount: String(it.discountAmount ?? 0),
            del_status: String(it.del_status ?? "0"),
            accept_order: String(it.accept_order ?? rawMeta.accept_order ?? ""),
            staffid: String(it.staffid ?? rawMeta.staffid ?? ""),
            assignedstaff: String(it.assignedstaff ?? rawMeta.assignedstaff ?? ""),
            orderdata_dealerid: String(it.orderdata_dealerid ?? rawMeta.orderdata_dealerid ?? ""),
            Dealer_Name: typeof rawMeta.Dealer_Name === "string" ? rawMeta.Dealer_Name : undefined,
            Dealer_Address: typeof rawMeta.Dealer_Address === "string" ? rawMeta.Dealer_Address : undefined,
            Dealer_Number: typeof rawMeta.Dealer_Number === "string" ? rawMeta.Dealer_Number : undefined,
            gst: typeof rawMeta.gst === "string" ? rawMeta.gst : undefined,
            order_dealer: String(it.order_dealer ?? rawMeta.order_dealer ?? it.orderdata_dealerid ?? rawMeta.orderdata_dealerid ?? ""),
          }));

          setOrders(mapped);
          setOrderMeta(rawMeta as OrderMeta);
        } catch {
          setOrders(Array.isArray(d.data) ? (d.data as OrderData[]) : []);
          const meta = (Array.isArray(d.data) ? asRecord(d.data[0]) : asRecord(d.data)) as OrderMeta;
          setOrderMeta(meta);
        }
        setLoading(false);
      })
      .catch(() => {
        setOrderAccessBlocked(true);
        setOrderUnavailableMessage("Unable to load this order right now.");
        setOrderAccessVerified(false);
        setActiveOrderHeader(null);
        setLoading(false);
      });
  }, [currentUser, id]);

  useEffect(() => {
    if (!orderAccessVerified || !id || !orderAccessDealerId || !orderAccessKey || !currentUser) return;

    let cancelled = false;

    fetchOrderDispatchAccessMeta(id, orderAccessDealerId, currentUser)
      .then((meta) => {
        if (!cancelled) setOrderAccessState({ key: orderAccessKey, meta });
      })
      .catch(() => {
        if (!cancelled) setOrderAccessState({ key: orderAccessKey, meta: null });
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser, id, orderAccessDealerId, orderAccessKey, orderAccessVerified]);

  useEffect(() => {
    if (!orderAccessVerified || !id || !currentUser) return;

    let cancelled = false;
    fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: buildDispatchHeaders(currentUser),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((json) => {
        if (cancelled || !json?.success || !json.data) return;
        const data = json.data as {
          effectiveItems?: OrderData[];
          effectiveTotals?: { grossAmount?: number; discountAmount?: number; netPayableAmount?: number };
        } & EffectiveOrderOverlayState;
        if (Array.isArray(data.effectiveItems) && data.effectiveItems.length > 0) {
          setOrders(data.effectiveItems as OrderData[]);
        }
        if (data.effectiveTotals) {
          setSummaryOverride({
            grossAmount: data.effectiveTotals.grossAmount,
            discountAmount: data.effectiveTotals.discountAmount,
            netPayableAmount: data.effectiveTotals.netPayableAmount,
          });
        }
        setOverlayState({
          isCancelled: !!data.isCancelled,
          isEdited: !!data.isEdited,
          latestRevision: Number(data.latestRevision ?? 0),
          cancellation: data.cancellation,
          eligibility: data.eligibility,
          changeHistory: data.changeHistory,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [currentUser, id, orderAccessVerified]);

  useEffect(() => {
    if (!orderAccessVerified || !id) return;
    fetch(`/api/order-notes?order_id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.[0]?.note) setLocalOrderNote(json.data[0].note);
      })
      .catch(() => {});
  }, [id, orderAccessVerified]);

  useEffect(() => {
    if (!orderAccessVerified || !id) return;
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
  }, [id, orderAccessVerified]);

  useEffect(() => {
    if (!orderAccessVerified || !id) return;
    const params = new URLSearchParams({ order_id: id });
    if (orderAccessDealerId) params.set("dealer_id", orderAccessDealerId);
    fetch(`/api/order-summary-overrides?${params.toString()}`, { cache: "no-store" })
      .then(r => r.json())
      .then(json => {
        if (json.success && Array.isArray(json.data)) {
          const normalizedId = orderLookupKey(id);
          const matched = json.data.find((item: OrderSummaryOverride) =>
            orderLookupKey(item.orderId ?? item.order_id) === normalizedId
          );
          setSummaryOverride(matched ?? json.data[0] ?? null);
        }
      })
      .catch(() => {});
  }, [id, orderAccessDealerId, orderAccessVerified]);

  useEffect(() => {
    if (!orderAccessVerified || !id || !currentUser?.id) return;

    fetch(`/api/order-dispatch?orderId=${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: buildDispatchHeaders(currentUser),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((json) => {
        if (json.success && Array.isArray(json.data)) {
          setDispatchRecords(json.data);
        } else {
          setDispatchRecords([]);
        }
      })
      .catch(() => setDispatchRecords([]));
  }, [currentUser, id, orderAccessVerified]);

  // Load product pack sizes (catNo → packSize) from local product data
  useEffect(() => {
    fetch('/data/products.json')
      .then(r => r.json())
      .then((data: Array<Record<string, unknown>>) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach(product => {
          const desc = String(product.Description ?? "");
          const pmap = parsePackSizes(desc);
          Object.assign(map, pmap);
        });
        setPackLookup(map);
      })
      .catch(() => {});
  }, []);

  const displayOrders = useMemo(() => {
    const withProductNotes = mergeFallbackProductNotes(orders, fallbackProductNotes) as OrderData[];
    return mergeOrderItemsWithDispatchRecords(withProductNotes, dispatchRecords) as OrderData[];
  }, [dispatchRecords, fallbackProductNotes, orders]);

  const handleDispatchRecordSaved = (record: OrderDispatchRecord) => {
    const nextRecord = record as DispatchRecordResponse;
    setDispatchRecords((previous) => {
      const index = previous.findIndex((entry) =>
        String(entry.orderItemId ?? "") && String(record.orderItemId ?? "")
          ? entry.orderItemId === record.orderItemId
          : buildDispatchRecordFallbackKey(entry) === buildDispatchRecordFallbackKey(record)
      );

      if (index === -1) return [nextRecord, ...previous];

      const copy = [...previous];
      copy[index] = nextRecord;
      return copy;
    });
  };

  const handleExport = () => {
    if (!tableRef.current) return;
    const wb = XLSX.utils.table_to_book(tableRef.current, { sheet: "Order Details" });
    XLSX.writeFile(wb, `order-${id}-${moment().format("YYYY-MM-DD")}.xlsx`);
  };

  const firstOrder = displayOrders[0];
  const displayOrderMeta = useMemo(
    () => ({ ...(activeOrderHeader ?? {}), ...(orderMeta ?? {}), ...(summaryOverride ?? {}) }) as OrderMeta,
    [activeOrderHeader, orderMeta, summaryOverride]
  );
  const assignedStaffId = firstNonEmptyString(
    orderAccessMeta?.assignedstaff,
    orderAccessMeta?.staffid,
    firstOrder?.assignedstaff,
    firstOrder?.staffid,
    displayOrderMeta?.assignedstaff,
    displayOrderMeta?.staffid
  );
  const acceptOrder = firstNonEmptyString(
    orderAccessMeta?.accept_order,
    firstOrder?.accept_order,
    displayOrderMeta?.accept_order,
    "0"
  );
  const orderDeleted = firstNonEmptyString(
    orderAccessMeta?.del_status,
    firstOrder?.del_status,
    displayOrderMeta?.del_status,
    "0"
  );
  const dealerIdForDispatch = firstNonEmptyString(
    orderAccessMeta?.order_dealer,
    firstOrder?.order_dealer,
    firstOrder?.orderdata_dealerid,
    displayOrderMeta?.order_dealer,
    displayOrderMeta?.orderdata_dealerid,
    dealer?.Dealer_Id
  );
  const canEditDispatchDetails = canUserEditDispatch(currentUser, {
    dealerId: dealerIdForDispatch,
    assignedStaffId,
    acceptOrder,
    delStatus: orderDeleted,
  });
  const baseRowPricings = useMemo(
    () => displayOrders.map((o) => getRowPricing(o, packLookup, displayOrderMeta)),
    [displayOrders, packLookup, displayOrderMeta]
  );
  // Compute totals from the same row pricing used by the table and cards.
  const calculatedTotals = baseRowPricings.reduce((acc, pricing) => {
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
  const rowPricings = (() => {
    if (!summaryOverride) return baseRowPricings;
    if (closeTo(calculatedTotals.discount, totals.discount)) return baseRowPricings;
    return rebalanceRowDiscounts(baseRowPricings, totals.discount);
  })();

  const buildInvoiceOrder = () => ({
    ...(displayOrderMeta ?? {}),
    order_id: id,
    order_dealer: dealerIdForDispatch,
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
    items: displayOrders.map((o, index) => {
      const pricing = rowPricings[index] ?? getRowPricing(o, packLookup, displayOrderMeta);
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
    if (overlayState?.isCancelled) {
      setInvoiceToast({ type: "error", text: "Cancelled orders cannot generate an active invoice." });
      window.setTimeout(() => setInvoiceToast(null), 3000);
      return;
    }
    if (displayOrders.length === 0 || invoiceLoading) return;
    setInvoiceLoading(true);
    const result = await downloadOrderInvoice(buildInvoiceOrder() as OrderInvoiceData, {
      normalizedRole: currentUser?.role,
      actorId: currentUser?.id,
    });
    setInvoiceLoading(false);
    setInvoiceToast({
      type: result.success ? "success" : "error",
      text: result.success ? "PDF downloaded" : result.error || "Download failed",
    });
    window.setTimeout(() => setInvoiceToast(null), 3000);
  };

  const submitCancellation = async (reason: string) => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setCancelError("Cancellation reason is required.");
      return;
    }
    if (!currentUser || currentUser.role !== "dealer") {
      setCancelError("Only the Dealer who owns this order can cancel it.");
      return;
    }
    setCancelSaving(true);
    setCancelError("");
    try {
      const response = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildDispatchHeaders(currentUser),
        },
        body: JSON.stringify({
          action: "cancel",
          reason: trimmedReason,
          formattedOrderNumber: `OM/${year}/${id}`,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) {
        setCancelError(json?.message || "Unable to cancel this order.");
        return;
      }
      setOverlayState((current) => ({
        ...(current ?? { isEdited: false, latestRevision: 0 }),
        isCancelled: true,
        cancellation: json.data?.cancellation,
        eligibility: { canDealerChange: false, reason: "order_already_cancelled" },
      }));
      setCancelDialogOpen(false);
      setInvoiceToast({ type: "success", text: "Order cancelled. The PHP order was preserved." });
      window.setTimeout(() => setInvoiceToast(null), 3000);
    } finally {
      setCancelSaving(false);
    }
  };

  const submitEdit = async (payload: { expectedRevision: number; items: Array<Record<string, unknown>> }) => {
    if (!currentUser || currentUser.role !== "dealer") {
      setEditError("Only the Dealer who owns this order can edit it.");
      return;
    }
    setEditSaving(true);
    setEditError("");
    try {
      const response = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildDispatchHeaders(currentUser),
        },
        body: JSON.stringify({
          action: "edit",
          expectedRevision: payload.expectedRevision,
          idempotencyKey: `${id}:${payload.expectedRevision}:${Date.now()}`,
          items: payload.items,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) {
        setEditError(json?.message || "Unable to save this edit.");
        return;
      }
      const latestEdit = Array.isArray(json.data?.edits) ? json.data.edits[json.data.edits.length - 1] : null;
      if (Array.isArray(latestEdit?.effectiveItems)) {
        setOrders(latestEdit.effectiveItems as OrderData[]);
      }
      if (latestEdit?.totals) {
        setSummaryOverride({
          grossAmount: latestEdit.totals.grossAmount,
          discountAmount: latestEdit.totals.discountAmount,
          netPayableAmount: latestEdit.totals.netPayableAmount,
        });
      }
      setOverlayState((current) => ({
        ...(current ?? { isCancelled: false }),
        isEdited: true,
        latestRevision: Number(json.data?.latestRevision ?? payload.expectedRevision + 1),
        changeHistory: latestEdit?.changes ?? current?.changeHistory ?? [],
        eligibility: current?.eligibility ?? { canDealerChange: true, reason: "eligible" },
      }));
      setEditDialogOpen(false);
      setInvoiceToast({ type: "success", text: "Order edit saved. The PHP order was preserved." });
      window.setTimeout(() => setInvoiceToast(null), 3000);
    } finally {
      setEditSaving(false);
    }
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
  const dealerCanChangeOrder = currentUser?.role === "dealer" && overlayState?.eligibility?.canDealerChange && !overlayState?.isCancelled;

  if (orderAccessBlocked) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-lg p-6 text-center">
          <h1 className="text-lg font-semibold text-gray-900">Order unavailable</h1>
          <p className="mt-2 text-sm text-gray-600">{orderUnavailableMessage}</p>
          <button onClick={() => router.back()} className="mt-5 px-4 py-2 text-sm font-medium border border-gray-300 rounded-md hover:bg-gray-50">Go back</button>
        </div>
      </main>
    );
  }

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
                {overlayState?.isCancelled && (
                  <span className="font-mono text-[12px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg">
                    Cancelled
                  </span>
                )}
                {overlayState?.isEdited && !overlayState.isCancelled && (
                  <span className="font-mono text-[12px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                    Edited
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
            {dealerCanChangeOrder && (
              <>
                <button onClick={() => setEditDialogOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-semibold rounded-xl transition-colors">
                <PenLine /> Edit Order
                </button>
                <button onClick={() => setCancelDialogOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold rounded-xl transition-colors">
                 <Trash2 /> Cancel Order
                </button>
              </>
            )}
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

          {overlayState?.isCancelled && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
              <p className="text-[11px] font-bold text-red-500 uppercase tracking-widest">Cancellation</p>
              <p className="mt-2 text-[13px] leading-6 text-red-800">{overlayState.cancellation?.reason || "This order was cancelled."}</p>
              <p className="mt-2 text-[12px] text-red-600">
                Cancelled by {overlayState.cancellation?.cancelledBy?.name || overlayState.cancellation?.cancelledBy?.id || "Dealer"}
                {overlayState.cancellation?.cancelledAt ? ` on ${moment(overlayState.cancellation.cancelledAt).format("DD MMM YYYY, hh:mm A")}` : ""}
              </p>
            </div>
          )}

          {overlayState?.isEdited && overlayState.changeHistory && overlayState.changeHistory.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-2xl p-5">
              <p className="text-[11px] font-bold text-amber-600 uppercase tracking-widest">Order Changes</p>
              <div className="mt-3 space-y-2">
                {overlayState.changeHistory.map((change, index) => (
                  <p key={index} className="text-[13px] leading-6 text-gray-700">{change.summary || change.type}</p>
                ))}
              </div>
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
                return (
                  <ItemCard key={o.orderdata_id} o={o} idx={idx}
                    pricing={rowPricings[idx] ?? getRowPricing(o, packLookup, displayOrderMeta)}
                    additionalDiscountType={discountBreakdown.additionalDiscountType}
                    dispatchLabel={canEditDispatchDetails ? "Update Dispatch" : "View Dispatch"}
                    onDispatch={() => setActiveDispatchItemId(o.orderdata_id)} />
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
                      const pricing = rowPricings[idx] ?? getRowPricing(o, packLookup, displayOrderMeta);
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
                            {o.fallbackProductNote && (
                              <span className="mt-1 block text-[11px] leading-5 text-indigo-700">Product Note: {o.fallbackProductNote}</span>
                            )}
                            {([o.remark, o.remarks].filter(Boolean).join(" | ")) && (
                              <span className="mt-1 block text-[11px] leading-5 text-gray-500">{[o.remark, o.remarks].filter(Boolean).join(" | ")}</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono font-bold text-gray-900">{pricing.packs}</td>
                          <td className="px-4 py-3.5 font-mono font-bold text-amber-700">{pricing.packs} × {pricing.packSize}</td>
                          <td className="px-4 py-3.5 font-mono font-bold text-gray-900">{pricing.pieces}</td>
                          <td className="px-4 py-3.5 font-mono font-semibold text-emerald-600">{pricing.ready}</td>
                          <td className="px-4 py-3.5 font-mono font-bold" style={{ color: left > 0 ? "#dc2626" : "#9ca3af" }}>{left}</td>
                          <td className="px-4 py-3.5 text-[12px] text-gray-600">{o.product_unit || "—"}</td>
                          <td className="px-4 py-3.5 font-mono text-gray-900 font-semibold">₹{pricing.unitPrice.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3.5 font-mono text-gray-900">
                            <div>{pricing.pct}%</div>
                            {discountBreakdown.additionalDiscountType && (
                              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                                incl. {discountBreakdown.additionalDiscountType}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-gray-500 line-through text-[12px]">₹{pricing.gross.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3.5 font-mono text-amber-700 font-semibold">
                            <div>−₹{pricing.discount.toLocaleString("en-IN")}</div>
                            {discountBreakdown.additionalDiscountType && (
                              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                                incl. {discountBreakdown.additionalDiscountType}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono font-bold text-emerald-700">₹{pricing.final.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3.5"><StatusPill code={String(o.dispatchStatus ?? o.orderdata_status ?? "0")} /></td>
                          <td className="px-4 py-3.5 text-[11px] text-gray-500 font-mono whitespace-nowrap">{o.orderdata_datetime || "—"}</td>
                          <td className="px-4 py-3.5 w-px">
                            <div className="track-btn">
                              <button
                                onClick={() => !isDeleted && setActiveDispatchItemId(o.orderdata_id)}
                                disabled={isDeleted}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all whitespace-nowrap ${isDeleted ? "opacity-30 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-100" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-200 hover:text-indigo-600 hover:bg-indigo-50"}`}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                </svg>
                                {canEditDispatchDetails ? "Update Dispatch" : "View Dispatch"}
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

      <TrackingModal
        isOpen={!!activeDispatchItemId}
        orderId={id}
        dealerId={dealerIdForDispatch}
        assignedStaffId={assignedStaffId}
        acceptOrder={acceptOrder}
        delStatus={orderDeleted}
        items={displayOrders}
        currentUser={currentUser}
        selectedItemId={activeDispatchItemId}
        onClose={() => setActiveDispatchItemId(null)}
        onRecordSaved={handleDispatchRecordSaved}
      />
      {cancelDialogOpen && (
        <CancelOrderDialog
          orderId={id}
          saving={cancelSaving}
          error={cancelError}
          onClose={() => setCancelDialogOpen(false)}
          onConfirm={submitCancellation}
        />
      )}
      {editDialogOpen && (
        <EditOrderDialog
          items={displayOrders}
          latestRevision={overlayState?.latestRevision ?? 0}
          saving={editSaving}
          error={editError}
          onClose={() => setEditDialogOpen(false)}
          onSave={submitEdit}
        />
      )}
    </>
  );
}
