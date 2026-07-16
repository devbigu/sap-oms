import {
  ACTIVE_ORDER_PERIOD_VERSION,
  OUTSIDE_ACTIVE_ORDER_PERIOD,
  inspectOriginalOrderDate,
  isActiveOrder,
} from "@/lib/activeOrderPeriod.js";
import { readActiveOrderHeadersSnapshot } from "@/lib/activeOrderSnapshot";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const CACHE_TTL_MS = 60_000;

type ActiveOrderReason =
  | "active"
  | "before_cutoff"
  | "missing_date"
  | "invalid_date"
  | "not_found"
  | "forbidden"
  | "upstream_unavailable";

type ActiveOrderActor = {
  role: "admin" | "accountant" | "staff" | "dealer";
  actorId: string;
};

type ActiveOrderAccessOptions = {
  actor: ActiveOrderActor;
  assignedDealerIds?: Array<string | number>;
  dealerId?: unknown;
};

export type ActiveOrderAccess = {
  visible: boolean;
  order: Record<string, unknown> | null;
  reason: ActiveOrderReason;
  message: string;
  diagnostics: {
    authoritativeDateField: string;
    parsedBusinessDate: string | null;
    snapshotResult: "hit" | "miss" | "not_checked" | "unavailable";
    directUpstreamResult: "hit" | "miss" | "not_checked" | "unavailable";
  };
};

const cache = new Map<string, { expiresAt: number; access: ActiveOrderAccess }>();

function safeText(value: unknown, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeLookupOrderId(value: unknown) {
  const raw = safeText(value);
  const displayIdMatch = raw.match(/(?:^|\/)(\d+)$/);
  return displayIdMatch?.[1] ?? raw;
}

function rowsFrom(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data)
    ? data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    : [];
}

export function messageForReason(reason: ActiveOrderReason) {
  switch (reason) {
    case "before_cutoff": return OUTSIDE_ACTIVE_ORDER_PERIOD;
    case "missing_date": return "This order has no authoritative creation date.";
    case "invalid_date": return "This order has an invalid creation date.";
    case "forbidden": return "This order is outside your assigned order scope.";
    case "upstream_unavailable": return "Order verification is temporarily unavailable.";
    case "not_found": return "Order not found.";
    default: return "";
  }
}

function resultForOrder(
  order: Record<string, unknown> | null,
  lookup: Pick<ActiveOrderAccess["diagnostics"], "snapshotResult" | "directUpstreamResult">,
): ActiveOrderAccess {
  if (!order) {
    const reason = "not_found";
    return {
      visible: false,
      order: null,
      reason,
      message: messageForReason(reason),
      diagnostics: { ...lookup, authoritativeDateField: "", parsedBusinessDate: null },
    };
  }

  const inspected = inspectOriginalOrderDate(order);
  const reason: ActiveOrderReason = inspected.status !== "valid"
    ? inspected.status
    : isActiveOrder(order) ? "active" : "before_cutoff";
  return {
    visible: reason === "active",
    order: reason === "active" ? order : null,
    reason,
    message: messageForReason(reason),
    diagnostics: {
      ...lookup,
      authoritativeDateField: inspected.field,
      parsedBusinessDate: inspected.date,
    },
  };
}

function unavailableResult(snapshotResult: ActiveOrderAccess["diagnostics"]["snapshotResult"]): ActiveOrderAccess {
  const reason = "upstream_unavailable";
  return {
    visible: false,
    order: null,
    reason,
    message: messageForReason(reason),
    diagnostics: {
      snapshotResult,
      directUpstreamResult: "unavailable",
      authoritativeDateField: "",
      parsedBusinessDate: null,
    },
  };
}

function isAccessOptions(value: unknown): value is ActiveOrderAccessOptions {
  return !!value && typeof value === "object" && "actor" in value;
}

function snapshotSource(actor: ActiveOrderActor) {
  if (actor.role === "dealer") return "orderhispegination";
  if (actor.role === "staff") return "staffOrderrPagination";
  return "orderpegination";
}

function upstreamScope(options: ActiveOrderAccessOptions | null, legacyDealerId: string) {
  if (!options) return { endpoint: legacyDealerId ? "orderhispegination" : "orderpegination", actorId: legacyDealerId };
  if (options.actor.role === "dealer") {
    return { endpoint: "orderhispegination", actorId: safeText(options.dealerId) || options.actor.actorId };
  }
  if (options.actor.role === "staff") return { endpoint: "staffOrderrPagination", actorId: options.actor.actorId };
  return { endpoint: "orderpegination", actorId: "" };
}

export async function resolveActiveOrder(
  orderId: unknown,
  dealerIdOrOptions?: unknown,
): Promise<ActiveOrderAccess> {
  const id = normalizeLookupOrderId(orderId);
  const options = isAccessOptions(dealerIdOrOptions) ? dealerIdOrOptions : null;
  const legacyDealerId = options ? "" : safeText(dealerIdOrOptions);
  const scopeKey = options
    ? `${options.actor.role}:${options.actor.actorId}:${safeText(options.dealerId)}`
    : `legacy:${legacyDealerId || "all"}`;
  if (!id) return resultForOrder(null, { snapshotResult: "not_checked", directUpstreamResult: "not_checked" });

  const key = `${ACTIVE_ORDER_PERIOD_VERSION}:${scopeKey}:${id}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.access;

  let snapshotResult: ActiveOrderAccess["diagnostics"]["snapshotResult"] = "not_checked";
  if (options) {
    try {
      const snapshot = await readActiveOrderHeadersSnapshot({
        source: snapshotSource(options.actor),
        actor: options.actor,
        assignedDealerIds: options.assignedDealerIds ?? [],
      });
      const matched = snapshot.rows.find((row) => normalizeLookupOrderId(row.order_id ?? row.orderId) === id) ?? null;
      snapshotResult = matched ? "hit" : "miss";
      if (matched) {
        const access = resultForOrder(matched, { snapshotResult, directUpstreamResult: "not_checked" });
        cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, access });
        return access;
      }
    } catch {
      snapshotResult = "unavailable";
    }
  }

  const { endpoint, actorId } = upstreamScope(options, legacyDealerId);
  const params = new URLSearchParams({ page: "1", limit: "50", search: id });
  if (actorId) params.set("id", actorId);

  try {
    const response = await fetch(`${BACKEND_URL}/${endpoint}?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return unavailableResult(snapshotResult);
    const rows = rowsFrom(await response.json());
    const matched = rows.find((row) => normalizeLookupOrderId(row.order_id ?? row.orderId) === id) ?? null;
    const access = resultForOrder(matched, {
      snapshotResult,
      directUpstreamResult: matched ? "hit" : "miss",
    });
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, access });
    return access;
  } catch {
    return unavailableResult(snapshotResult);
  }
}

export async function filterVisibleOrderIds(orderIds: unknown[], dealerId?: unknown): Promise<Set<string>> {
  const ids = Array.from(new Set(orderIds.map((id) => safeText(id)).filter(Boolean))).slice(0, 200);
  const results = await Promise.all(ids.map((id) => resolveActiveOrder(id, dealerId)));
  return new Set(ids.filter((id, index) => results[index].visible));
}
