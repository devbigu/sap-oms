import {
  ACTIVE_ORDER_PERIOD_VERSION,
  OUTSIDE_ACTIVE_ORDER_PERIOD,
  isActiveOrder,
} from "@/lib/activeOrderPeriod.js";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; order: Record<string, unknown> | null }>();

function safeText(value: unknown, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function rowsFrom(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) ? data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : [];
}

export type ActiveOrderAccess = {
  visible: boolean;
  order: Record<string, unknown> | null;
  reason: string;
};

export async function resolveActiveOrder(orderId: unknown, dealerId?: unknown): Promise<ActiveOrderAccess> {
  const id = safeText(orderId);
  const dealer = safeText(dealerId);
  if (!id) return { visible: false, order: null, reason: OUTSIDE_ACTIVE_ORDER_PERIOD };

  const key = `${ACTIVE_ORDER_PERIOD_VERSION}:${dealer || "all"}:${id}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { visible: !!cached.order, order: cached.order, reason: cached.order ? "" : OUTSIDE_ACTIVE_ORDER_PERIOD };
  }

  const endpoint = dealer ? "orderhispegination" : "orderpegination";
  const params = new URLSearchParams({ page: "1", limit: "50", search: id });
  if (dealer) params.set("id", dealer);
  const response = await fetch(`${BACKEND_URL}/${endpoint}?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${endpoint} failed with ${response.status}`);

  const rows = rowsFrom(await response.json());
  const matched = rows.find((row) => safeText(row.order_id ?? row.orderId) === id) ?? null;
  const order = matched && isActiveOrder(matched) ? matched : null;
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, order });
  return { visible: !!order, order, reason: order ? "" : OUTSIDE_ACTIVE_ORDER_PERIOD };
}

export async function filterVisibleOrderIds(orderIds: unknown[], dealerId?: unknown): Promise<Set<string>> {
  const ids = Array.from(new Set(orderIds.map((id) => safeText(id)).filter(Boolean))).slice(0, 200);
  const results = await Promise.all(ids.map((id) => resolveActiveOrder(id, dealerId).catch(() => ({ visible: false }))));
  return new Set(ids.filter((id, index) => results[index].visible));
}
