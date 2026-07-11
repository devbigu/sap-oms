import { normalizeSku } from "@/lib/orderProductNotes.mjs";

export type DispatchStatus = "pending" | "packing" | "dispatched" | "not_in_stock" | "successful";
export type DispatchActorRole = "staff" | "admin";
export type DispatchViewerRole = "admin" | "staff" | "dealer" | "unknown";

export type DispatchUserSession = {
  role: DispatchViewerRole;
  id: string;
  name?: string;
  roletype?: string;
};

export type DispatchHistoryEntry = {
  id: string;
  quantity: number;
  remark: string;
  status: DispatchStatus;
  actorId: string;
  actorRole: DispatchActorRole;
  createdAt: Date | string;
};

export type OrderDispatchRecord = {
  id?: string;
  orderId: string;
  orderItemId: string | null;
  sku: string;
  normalizedSku: string;
  occurrence: number;
  dealerId: string;
  assignedStaffId: string | null;
  orderedQuantity: number;
  dispatchedQuantity: number;
  currentStatus: DispatchStatus;
  updates: DispatchHistoryEntry[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
  legacyImported?: boolean;
  legacyImportedAt?: Date | string;
};

export type DispatchSourceItem = {
  orderdata_id?: string;
  orderdata_orderid?: string;
  orderdata_cat_no?: string;
  orderdata_item_quantity?: string | number;
  readyquantity?: string | number;
  orderdata_status?: string | number;
  product_name?: string;
  product_discription?: string;
  remark?: string;
  remarks?: string;
  fallbackProductNote?: string;
};

export type MergedDispatchItem = {
  orderItemId: string | null;
  orderedQuantity: number;
  dispatchedQuantity: number;
  remainingQuantity: number;
  dispatchStatus: DispatchStatus;
  dispatchHistory: DispatchHistoryEntry[];
  occurrence: number;
};

export const DISPATCH_MUTATION_STATUSES = [
  "packing",
  "dispatched",
  "not_in_stock",
  "successful",
] as const;

export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  pending: "Pending",
  packing: "Packing",
  dispatched: "Dispatched",
  not_in_stock: "Not in Stock",
  successful: "Successful",
};

function normalizeDispatchFlag(value: unknown, truthy = "1"): boolean {
  return String(value ?? "").trim() === truthy;
}

export function safeDispatchInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function normalizeDispatchStatus(value: unknown, fallback: DispatchStatus = "pending"): DispatchStatus {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;

  if (text === "1" || text === "packing") return "packing";
  if (text === "2" || text === "dispatch" || text === "dispatched") return "dispatched";
  if (text === "3" || text === "notinstock" || text === "not_in_stock" || text === "not in stock") return "not_in_stock";
  if (text === "4" || text === "successful" || text === "success") return "successful";
  if (text === "0" || text === "pending" || text === "inprocess" || text === "in process") return "pending";

  return fallback;
}

export function normalizeDispatchRemark(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function computeRemainingQuantity(orderedQuantity: number, dispatchedQuantity: number): number {
  return Math.max(0, safeDispatchInteger(orderedQuantity) - safeDispatchInteger(dispatchedQuantity));
}

export function normalizeDispatchOrderItemId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export function buildDispatchFallbackKey(orderId: string, normalizedSku: string, occurrence: number): string {
  return [String(orderId ?? "").trim(), normalizedSku, String(Math.max(1, safeDispatchInteger(occurrence) || 1))].join("::");
}

export function buildDispatchIdentity(input: {
  orderId: string;
  orderItemId?: string | null;
  sku?: string;
  normalizedSku?: string;
  occurrence?: number;
}) {
  const orderItemId = normalizeDispatchOrderItemId(input.orderItemId);
  if (orderItemId) return { orderItemId };

  const normalizedSku = normalizeSku(input.normalizedSku ?? input.sku);
  return {
    orderId: String(input.orderId ?? "").trim(),
    normalizedSku,
    occurrence: Math.max(1, safeDispatchInteger(input.occurrence) || 1),
  };
}

export function canUserViewDispatch(user: DispatchUserSession | null, context: {
  dealerId?: string | null;
  assignedStaffId?: string | null;
}): boolean {
  if (!user?.id) return false;
  if (user.role === "admin") return true;
  if (user.role === "staff") return String(context.assignedStaffId ?? "").trim() === user.id;
  if (user.role === "dealer") return String(context.dealerId ?? "").trim() === user.id;
  return false;
}

export function isAcceptedOrderForDispatch(value: unknown): boolean {
  return normalizeDispatchFlag(value, "1");
}

export function isDeletedOrderForDispatch(value: unknown): boolean {
  return normalizeDispatchFlag(value, "1");
}

export function canUpdateOrderDispatch(input: {
  role: DispatchViewerRole;
  isAssignedStaff: boolean;
  isAccepted: boolean;
  isDeleted: boolean;
}): boolean {
  if (input.role === "dealer" || input.isDeleted || !input.isAccepted) return false;
  if (input.role === "admin") return true;
  if (input.role === "staff") return input.isAssignedStaff;
  return false;
}

export function canUserEditDispatch(user: DispatchUserSession | null, context: {
  dealerId?: string | null;
  assignedStaffId?: string | null;
  acceptOrder?: string | number | null;
  delStatus?: string | number | null;
}): boolean {
  if (!canUserViewDispatch(user, context)) return false;
  const viewer = user as DispatchUserSession;
  return canUpdateOrderDispatch({
    role: viewer.role,
    isAssignedStaff: String(context.assignedStaffId ?? "").trim() === viewer.id,
    isAccepted: isAcceptedOrderForDispatch(context.acceptOrder),
    isDeleted: isDeletedOrderForDispatch(context.delStatus),
  });
}

export function mergeOrderItemsWithDispatchRecords<T extends DispatchSourceItem>(
  items: T[],
  dispatchRecords: Array<Partial<OrderDispatchRecord>>
): Array<T & MergedDispatchItem> {
  const byOrderItemId = new Map<string, Partial<OrderDispatchRecord>>();
  const byFallback = new Map<string, Partial<OrderDispatchRecord>>();

  for (const record of dispatchRecords ?? []) {
    const orderItemId = normalizeDispatchOrderItemId(record.orderItemId);
    if (orderItemId) byOrderItemId.set(orderItemId, record);

    const orderId = String(record.orderId ?? "").trim();
    const normalizedSku = normalizeSku(record.normalizedSku ?? record.sku);
    const occurrence = Math.max(1, safeDispatchInteger(record.occurrence) || 1);
    if (orderId && normalizedSku) {
      byFallback.set(buildDispatchFallbackKey(orderId, normalizedSku, occurrence), record);
    }
  }

  const occurrenceCounts = new Map<string, number>();

  return (items ?? []).map((item) => {
    const normalizedSku = normalizeSku(item.orderdata_cat_no ?? item.product_name ?? "");
    const occurrence = normalizedSku
      ? (occurrenceCounts.get(normalizedSku) ?? 0) + 1
      : 1;
    if (normalizedSku) occurrenceCounts.set(normalizedSku, occurrence);

    const orderId = String(item.orderdata_orderid ?? "").trim();
    const orderItemId = normalizeDispatchOrderItemId(item.orderdata_id);
    const matchedRecord = orderItemId && byOrderItemId.has(orderItemId)
      ? byOrderItemId.get(orderItemId)
      : byFallback.get(buildDispatchFallbackKey(orderId, normalizedSku, occurrence));

    const orderedQuantity = safeDispatchInteger(
      matchedRecord?.orderedQuantity ?? item.orderdata_item_quantity
    );
    const legacyDispatched = safeDispatchInteger(item.readyquantity);
    const dispatchedQuantity = safeDispatchInteger(
      matchedRecord?.dispatchedQuantity ?? legacyDispatched
    );
    const remainingQuantity = computeRemainingQuantity(orderedQuantity, dispatchedQuantity);
    const dispatchStatus = normalizeDispatchStatus(
      matchedRecord?.currentStatus ?? item.orderdata_status,
      dispatchedQuantity > 0 ? "dispatched" : "pending"
    );

    return {
      ...item,
      orderItemId,
      orderedQuantity,
      dispatchedQuantity,
      remainingQuantity,
      dispatchStatus,
      dispatchHistory: Array.isArray(matchedRecord?.updates)
        ? (matchedRecord?.updates as DispatchHistoryEntry[])
        : [],
      occurrence,
    };
  });
}

export function buildLegacyDispatchSeed(input: {
  orderId: string;
  orderItemId?: string | null;
  sku: string;
  occurrence: number;
  dealerId: string;
  assignedStaffId?: string | null;
  orderedQuantity: number;
  legacyReadyQuantity?: number;
  legacyStatus?: unknown;
  now?: Date;
}) {
  const orderedQuantity = safeDispatchInteger(input.orderedQuantity);
  const dispatchedQuantity = Math.min(
    orderedQuantity,
    safeDispatchInteger(input.legacyReadyQuantity)
  );
  const currentStatus = normalizeDispatchStatus(
    input.legacyStatus,
    dispatchedQuantity > 0 ? "dispatched" : "pending"
  );
  const now = input.now ?? new Date();

  return {
    orderId: String(input.orderId ?? "").trim(),
    orderItemId: normalizeDispatchOrderItemId(input.orderItemId),
    sku: String(input.sku ?? "").trim(),
    normalizedSku: normalizeSku(input.sku),
    occurrence: Math.max(1, safeDispatchInteger(input.occurrence) || 1),
    dealerId: String(input.dealerId ?? "").trim(),
    assignedStaffId: normalizeDispatchOrderItemId(input.assignedStaffId),
    orderedQuantity,
    dispatchedQuantity,
    currentStatus,
    updates: [] as DispatchHistoryEntry[],
    legacyImported: dispatchedQuantity > 0,
    ...(dispatchedQuantity > 0 ? { legacyImportedAt: now } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function applyDispatchUpdateSnapshot(
  record: OrderDispatchRecord,
  input: {
    dispatchQuantity: number;
    status: DispatchStatus;
    remark: string;
    actorId: string;
    actorRole: DispatchActorRole;
    updateId: string;
    createdAt: Date;
  }
): OrderDispatchRecord {
  const dispatchQuantity = safeDispatchInteger(input.dispatchQuantity);
  if (dispatchQuantity <= 0) {
    throw new Error("Dispatch quantity must be greater than zero");
  }

  const remainingBefore = computeRemainingQuantity(record.orderedQuantity, record.dispatchedQuantity);
  if (dispatchQuantity > remainingBefore) {
    throw new Error("Dispatch quantity exceeds remaining quantity");
  }

  const dispatchedQuantity = record.dispatchedQuantity + dispatchQuantity;
  const remainingAfter = computeRemainingQuantity(record.orderedQuantity, dispatchedQuantity);
  const requestedStatus = normalizeDispatchStatus(input.status, "packing");
  const currentStatus = remainingAfter === 0 && requestedStatus !== "not_in_stock"
    ? "successful"
    : requestedStatus;

  return {
    ...record,
    dispatchedQuantity,
    currentStatus,
    updatedAt: input.createdAt,
    updates: [
      ...(record.updates ?? []),
      {
        id: input.updateId,
        quantity: dispatchQuantity,
        remark: normalizeDispatchRemark(input.remark),
        status: currentStatus,
        actorId: String(input.actorId ?? "").trim(),
        actorRole: input.actorRole,
        createdAt: input.createdAt,
      },
    ],
  };
}
