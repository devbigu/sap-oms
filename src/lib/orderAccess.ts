import {
  getDealerAssignedStaffIds,
  resolveOrderDealerId,
  splitScopeIds,
} from "@/lib/staffOrderScope.js";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";

type OrderAccessReason = "available" | "not_found" | "forbidden" | "upstream_unavailable";

type OrderActor = {
  role: "admin" | "accountant" | "staff" | "dealer";
  actorId: string;
};

type OrderAccessOptions = {
  actor: OrderActor;
  assignedDealerIds?: Array<string | number>;
  dealerId?: unknown;
};

export type OrderAccess = {
  visible: boolean;
  order: Record<string, unknown> | null;
  reason: OrderAccessReason;
  message: string;
};

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

export function messageForReason(reason: OrderAccessReason) {
  switch (reason) {
    case "forbidden": return "This order is outside your assigned order scope.";
    case "upstream_unavailable": return "Order verification is temporarily unavailable.";
    case "not_found": return "Order not found.";
    default: return "";
  }
}

function result(order: Record<string, unknown> | null): OrderAccess {
  const reason: OrderAccessReason = order ? "available" : "not_found";
  return { visible: !!order, order, reason, message: messageForReason(reason) };
}

function unavailableResult(): OrderAccess {
  const reason = "upstream_unavailable";
  return { visible: false, order: null, reason, message: messageForReason(reason) };
}

function isAccessOptions(value: unknown): value is OrderAccessOptions {
  return !!value && typeof value === "object" && "actor" in value;
}

function forbiddenResult(): OrderAccess {
  const reason = "forbidden";
  return { visible: false, order: null, reason, message: messageForReason(reason) };
}

function canStaffAccessOrder(order: Record<string, unknown>, options: OrderAccessOptions) {
  const dealerId = resolveOrderDealerId(order);
  if (!dealerId) return false;

  const assignedDealerIds = new Set(splitScopeIds(options.assignedDealerIds));
  if (assignedDealerIds.has(dealerId)) return true;

  return getDealerAssignedStaffIds(order).includes(safeText(options.actor.actorId));
}

function applyActorAccess(order: Record<string, unknown> | null, options: OrderAccessOptions | null): OrderAccess {
  if (!order) return result(null);
  if (!options) return result(order);

  if (options.actor.role === "admin" || options.actor.role === "accountant") {
    return result(order);
  }

  const dealerId = resolveOrderDealerId(order);
  if (options.actor.role === "dealer") {
    const allowedDealerIds = splitScopeIds([options.dealerId, options.actor.actorId]);
    return dealerId && allowedDealerIds.includes(dealerId)
      ? result(order)
      : forbiddenResult();
  }

  if (options.actor.role === "staff") {
    return canStaffAccessOrder(order, options) ? result(order) : forbiddenResult();
  }

  return forbiddenResult();
}

export async function resolveOrderAccess(orderId: unknown, dealerIdOrOptions?: unknown): Promise<OrderAccess> {
  const id = normalizeLookupOrderId(orderId);
  if (!id) return result(null);
  const options = isAccessOptions(dealerIdOrOptions) ? dealerIdOrOptions : null;
  const legacyDealerId = options ? "" : safeText(dealerIdOrOptions);
  const params = new URLSearchParams({ page: "1", limit: "50", search: id });
  if (!options && legacyDealerId) params.set("id", legacyDealerId);
  const endpoint = !options && legacyDealerId ? "orderhispegination" : "orderpegination";

  try {
    const response = await fetch(`${BACKEND_URL}/${endpoint}?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return unavailableResult();
    const rows = rowsFrom(await response.json());
    const order = rows.find((row) => normalizeLookupOrderId(row.order_id ?? row.orderId) === id) ?? null;
    return applyActorAccess(order, options);
  } catch {
    return unavailableResult();
  }
}

export async function filterExistingOrderIds(orderIds: unknown[], dealerId?: unknown): Promise<Set<string>> {
  const ids = Array.from(new Set(orderIds.map((id) => safeText(id)).filter(Boolean))).slice(0, 200);
  const results = await Promise.all(ids.map((id) => resolveOrderAccess(id, dealerId)));
  return new Set(ids.filter((id, index) => results[index].visible));
}
