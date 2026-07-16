import { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { ACTIVE_ORDER_PERIOD_VERSION, filterActiveOrders } from "@/lib/activeOrderPeriod.js";
import {
  OrderAmountSource,
  resolveOrderAmounts,
  withDisplayOrderAmounts,
} from "@/lib/orderAmounts";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const CACHE_ID = `collective_ledger_snapshot:${ACTIVE_ORDER_PERIOD_VERSION}`;
const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = Number(process.env.LEDGER_FETCH_TIMEOUT_MS ?? 30_000);
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

export type LedgerOrderState = "Cancelled" | "Awaiting" | "SupposedToGo" | "SentAndSettled";

export type ExternalDealer = Record<string, any> & {
  Dealer_Id?: string;
  Dealer_Name?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_Address?: string;
  Dealer_City?: string;
  Dealer_Pincode?: string;
  walletBalance?: number;
};

export type ExternalOrder = Record<string, any> & {
  order_id?: string;
  order_dealer?: string;
  order_date?: string;
  order_amount?: string | number;
  order_discount?: string | number;
  order_discount_amount?: string | number;
  order_net_amount?: string | number;
  grossAmount?: string | number;
  discountAmount?: string | number;
  netPayableAmount?: string | number;
  accept_order?: string | number;
  del_status?: string | number;
  mtstatus?: string | number;
};

export type AccountBookSummary = {
  booked: number;
  bookedCount: number;
  sentAndSettled: number;
  sentAndSettledCount: number;
  supposedToGo: number;
  supposedToGoCount: number;
  awaiting: number;
  awaitingCount: number;
};

type LedgerSnapshot = {
  updatedAt: string;
  dealers: ExternalDealer[];
  orders: ExternalOrder[];
};

type LedgerCacheDocument = LedgerSnapshot & {
  _id: typeof CACHE_ID;
};

type SnapshotResult = LedgerSnapshot & {
  isLive: boolean;
};

let memorySnapshot: (SnapshotResult & { cachedAt: number }) | null = null;
let snapshotRequest: Promise<SnapshotResult> | null = null;

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.dealers)) return value.dealers;
  if (Array.isArray(value?.orders)) return value.orders;
  if (value?.data && typeof value.data === "object") return [value.data];
  if (value && typeof value === "object") return [value];
  return [];
}

function toPaise(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function fromPaise(value: number): number {
  return Math.round(value) / 100;
}

function cacheIsFresh() {
  return memorySnapshot && Date.now() - memorySnapshot.cachedAt < CACHE_TTL_MS;
}

async function getOptionalDb(): Promise<Db | null> {
  try {
    return await getDb();
  } catch (error) {
    console.error("[ledger mongo connection]", error);
    return null;
  }
}

function orderOverrideKey(orderId: unknown, dealerId: unknown) {
  const oid = String(orderId ?? "").trim();
  const did = String(dealerId ?? "").trim();
  return oid && did ? `${did}:${oid}` : "";
}

async function readOrderSummaryOverrides(
  orders: ExternalOrder[],
  db?: Db | null
): Promise<Map<string, OrderAmountSource>> {
  const ids = Array.from(new Set(
    orders.map((order) => String(order.order_id ?? "").trim()).filter(Boolean)
  ));
  if (ids.length === 0) return new Map();

  const database = db ?? await getOptionalDb();
  if (!database) return new Map();

  try {
    const docs = await database
      .collection("order_summary_overrides")
      .find({ orderId: { $in: ids } })
      .toArray();

    const byOrder = new Map<string, OrderAmountSource>();
    for (const doc of docs) {
      const key = orderOverrideKey(doc.orderId ?? doc.order_id, doc.dealerId ?? doc.order_dealer);
      if (key) byOrder.set(key, doc as OrderAmountSource);
    }
    return byOrder;
  } catch (error) {
    console.error("[ledger order summary overrides]", error);
    return new Map();
  }
}

async function applyOrderSummaryOverrides(snapshot: LedgerSnapshot, db?: Db | null): Promise<LedgerSnapshot> {
  const overrides = await readOrderSummaryOverrides(snapshot.orders, db);
  if (snapshot.orders.length === 0) return snapshot;

  return {
    ...snapshot,
    orders: snapshot.orders.map((order) => {
      const key = orderOverrideKey(order.order_id, order.order_dealer);
      return withDisplayOrderAmounts(order, key ? overrides.get(key) : undefined);
    }),
  };
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, cache: "no-store" });
  if (!res.ok) throw new Error(`External API failed: ${res.status}`);
  return res.json();
}

async function fetchPaginated(endpoint: "dealerpegination" | "orderpegination", signal: AbortSignal) {
  const rows: any[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${BACKEND_URL}/${endpoint}?page=${page}&limit=${PAGE_SIZE}&search=`;
    const json = await fetchJson(url, { signal });
    const pageRows = asArray(json?.data ?? json);
    rows.push(...pageRows);

    const total = Number(json?.total ?? json?.recordsTotal ?? 0);
    const lastPage = Number(json?.last_page ?? json?.lastPage ?? (total > 0 ? Math.ceil(total / PAGE_SIZE) : 0));
    if (pageRows.length === 0 || pageRows.length < PAGE_SIZE || (lastPage > 0 && page >= lastPage)) break;
  }

  return rows;
}

async function fetchLiveSnapshot(): Promise<LedgerSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const [dealers, orders] = await Promise.all([
      fetchPaginated("dealerpegination", controller.signal),
      fetchPaginated("orderpegination", controller.signal),
    ]);

    return {
      updatedAt: new Date().toISOString(),
      dealers,
      orders: filterActiveOrders(orders),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readCachedSnapshot(db: Db): Promise<LedgerSnapshot | null> {
  const doc = await db.collection<LedgerCacheDocument>("ledger_system_cache").findOne({ _id: CACHE_ID });
  if (!doc) return null;
  return {
    updatedAt: String(doc.updatedAt || new Date(0).toISOString()),
    dealers: Array.isArray(doc.dealers) ? doc.dealers : [],
    orders: filterActiveOrders(Array.isArray(doc.orders) ? doc.orders : []),
  };
}

async function writeCachedSnapshot(db: Db, snapshot: LedgerSnapshot) {
  await db.collection<LedgerCacheDocument>("ledger_system_cache").updateOne(
    { _id: CACHE_ID },
    {
      $set: {
        updatedAt: snapshot.updatedAt,
        dealers: snapshot.dealers,
        orders: snapshot.orders,
      },
    },
    { upsert: true }
  );
}

export async function getLedgerSnapshot(): Promise<SnapshotResult> {
  if (cacheIsFresh() && memorySnapshot) return memorySnapshot;
  if (snapshotRequest) return snapshotRequest;

  snapshotRequest = (async () => {
    const live = await applyOrderSummaryOverrides(await fetchLiveSnapshot());
    try {
      const db = await getOptionalDb();
      if (db) await writeCachedSnapshot(db, live);
    } catch (cacheError) {
      console.error("[ledger cache write]", cacheError);
    }

    memorySnapshot = { ...live, isLive: true, cachedAt: Date.now() };
    return memorySnapshot;
  })();

  try {
    return await snapshotRequest;
  } catch (liveError) {
    console.error("[ledger live snapshot]", liveError);

    if (memorySnapshot) {
      memorySnapshot = { ...memorySnapshot, isLive: false, cachedAt: Date.now() };
      return memorySnapshot;
    }

    const db = await getOptionalDb();
    if (db) {
      const cached = await readCachedSnapshot(db);
      if (cached) {
        const correctedCached = await applyOrderSummaryOverrides(cached, db);
        memorySnapshot = { ...correctedCached, isLive: false, cachedAt: Date.now() };
        return memorySnapshot;
      }
    }

    throw liveError;
  } finally {
    snapshotRequest = null;
  }
}

export async function fetchExternalDealer(dealerId: string): Promise<ExternalDealer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const json = await fetchJson(`${BACKEND_URL}/getdealer?id=${encodeURIComponent(dealerId)}`, {
      method: "POST",
      signal: controller.signal,
    });
    const dealers = asArray(json?.data ?? json);
    return dealers.find((dealer) => String(dealer?.Dealer_Id) === String(dealerId)) ?? dealers[0] ?? null;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeDealer(dealer: ExternalDealer) {
  return {
    Dealer_Id: String(dealer.Dealer_Id ?? ""),
    Dealer_Name: dealer.Dealer_Name ?? "",
    Dealer_Email: dealer.Dealer_Email ?? "",
    Dealer_Number: dealer.Dealer_Number ?? "",
    Dealer_Address: dealer.Dealer_Address ?? "",
    Dealer_City: dealer.Dealer_City ?? "",
    Dealer_Pincode: dealer.Dealer_Pincode ?? "",
    creditdays: dealer.creditdays ?? dealer.creditDays ?? dealer.credit_period ?? dealer.Credit_Period ?? "",
    walletBalance: Number(dealer.walletBalance || 0),
  };
}

export function mtStatusValue(s: any) {
  if (!s) return "NoActionTaken";
  const key = String(s).trim().toLowerCase().replace(/[\s_-]/g, "");
  if (key === "pending") return "Pending";
  if (key === "inprocess") return "InProcess";
  if (key === "completed") return "Completed";
  return "NoActionTaken";
}

export function classifyOrder(order: ExternalOrder): LedgerOrderState {
  if (String(order.del_status ?? "0") === "1") return "Cancelled";
  if (String(order.accept_order ?? "0") !== "1") return "Awaiting";

  const numericMtStatus = Number(order.mtstatus ?? 0);
  const isSettled = mtStatusValue(order.mtstatus) === "Completed" || (Number.isFinite(numericMtStatus) && numericMtStatus >= 2);
  return isSettled ? "SentAndSettled" : "SupposedToGo";
}

export function isLedgerOrder(order: ExternalOrder) {
  return classifyOrder(order) !== "Cancelled";
}

export function orderNetPaise(order: ExternalOrder) {
  return toPaise(resolveOrderAmounts(order).netPayable);
}

export function orderNet(order: ExternalOrder) {
  return fromPaise(orderNetPaise(order));
}

export function orderMatchesDealer(order: ExternalOrder, dealerId: string) {
  return String(order.order_dealer) === String(dealerId);
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function orderDedupeKey(order: ExternalOrder) {
  const dealerId = String(order.order_dealer ?? "");
  const orderId = String(order.order_id ?? "").trim();
  if (orderId) return `${dealerId}:${orderId}`;

  return [
    dealerId,
    order.order_date ?? "",
    order.order_amount ?? "",
    order.order_discount ?? "",
    order.order_discount_amount ?? "",
    order.order_net_amount ?? "",
    order.accept_order ?? "",
    order.mtstatus ?? "",
  ].map(String).join(":");
}

export function uniqueLedgerOrders(orders: ExternalOrder[]) {
  const byOrder = new Map<string, ExternalOrder>();

  for (const order of orders) {
    const key = orderDedupeKey(order);
    const existing = byOrder.get(key);

    if (!existing) {
      byOrder.set(key, order);
      continue;
    }

    // The external order API can return one row per item. Keep one ledger row
    // per order, while filling any blank fields from later duplicate rows.
    for (const [field, value] of Object.entries(order)) {
      if (!hasValue(existing[field]) && hasValue(value)) {
        existing[field] = value;
      }
    }
  }

  return Array.from(byOrder.values());
}

export function ordersForDealer(orders: ExternalOrder[], dealerId: string) {
  return uniqueLedgerOrders(
    filterActiveOrders(orders).filter((order) => orderMatchesDealer(order, dealerId) && isLedgerOrder(order))
  );
}

export function summarizeOrders(orders: ExternalOrder[]): AccountBookSummary {
  const totals = {
    booked: 0,
    bookedCount: 0,
    sentAndSettled: 0,
    sentAndSettledCount: 0,
    supposedToGo: 0,
    supposedToGoCount: 0,
    awaiting: 0,
    awaitingCount: 0,
  };

  let bookedPaise = 0;
  let sentAndSettledPaise = 0;
  let supposedToGoPaise = 0;
  let awaitingPaise = 0;

  for (const order of filterActiveOrders(orders)) {
    const state = classifyOrder(order);
    if (state === "Cancelled") continue;

    const net = orderNetPaise(order);
    bookedPaise += net;
    totals.bookedCount += 1;

    if (state === "Awaiting") {
      awaitingPaise += net;
      totals.awaitingCount += 1;
    } else if (state === "SupposedToGo") {
      supposedToGoPaise += net;
      totals.supposedToGoCount += 1;
    } else {
      sentAndSettledPaise += net;
      totals.sentAndSettledCount += 1;
    }
  }

  return {
    ...totals,
    booked: fromPaise(bookedPaise),
    sentAndSettled: fromPaise(sentAndSettledPaise),
    supposedToGo: fromPaise(supposedToGoPaise),
    awaiting: fromPaise(awaitingPaise),
  };
}

export function paymentCreditPaise(tx: any) {
  return tx?.type === "payment" || tx?.type === "credit" ? toPaise(tx.amount) : 0;
}

export function paymentDebitPaise(tx: any) {
  return tx?.type === "debit" ? toPaise(tx.amount) : 0;
}
