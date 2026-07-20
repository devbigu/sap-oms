import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveOrderAccess } from "@/lib/orderAccess";
import { fetchStaffAssignedDealerIds } from "@/lib/orderScopeServer";
import { MongoServerError } from "mongodb";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { invalidatePendingProductsCache } from "@/lib/pendingProducts";
import { findOrderOverlay } from "@/lib/orderOverlays";
import { parsePhpJsonResponse } from "@/lib/phpJson";
import {
  buildBulkDispatchPlan,
  buildBulkDispatchLineKey,
  buildDispatchIdentity,
  buildLegacyDispatchSeed,
  canUserEditDispatch,
  canUserViewDispatch,
  computeRemainingQuantity,
  DISPATCH_MUTATION_STATUSES,
  mergeOrderItemsWithDispatchRecords,
  normalizeDispatchOrderItemId,
  normalizeDispatchRemark,
  normalizeDispatchStatus,
  resolveOrderAcceptance,
  safeDispatchInteger,
  type DispatchActorRole,
  type DispatchStatus,
  type DispatchUserSession,
  type OrderDispatchRecord,
} from "@/lib/orderDispatch";
import { isExpectedOrderNumber, normalizeSku } from "@/lib/orderProductNotes.mjs";

export const runtime = "nodejs";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const COLLECTION = "order_dispatch_records";

type PhpOrderItem = {
  orderdata_id: string;
  orderdata_orderid: string;
  orderdata_cat_no: string;
  orderdata_item_quantity: string;
  orderdata_status?: string;
  order_status?: string;
  readyquantity?: string;
  remark?: string;
  remarks?: string;
  order_dealer?: string;
  orderdata_dealerid?: string;
  Dealer_Id?: string;
  dealerId?: string;
  assignedstaff?: string;
  staffid?: string;
  accept_order?: string;
  del_status?: string;
};

type PhpOrderPayload = {
  items: PhpOrderItem[];
  meta: Record<string, unknown>;
};

type DispatchOrderAccessContext = {
  dealerId: string;
  assignedStaffId: string;
  acceptOrder: string;
  delStatus: string;
  orderStatus: string;
};

function accessContextFromOrder(order: Record<string, unknown> | null): DispatchOrderAccessContext {
  const source = order ?? {};
  return {
    dealerId: pickFirstText(80, source.order_dealer, source.orderdata_dealerid, source.Dealer_Id, source.dealerId),
    assignedStaffId: pickFirstText(80, source.assignedstaff, source.staffid),
    acceptOrder: pickFirstText(10, source.accept_order),
    delStatus: pickFirstText(10, source.del_status),
    orderStatus: pickFirstText(40, source.order_status),
  };
}

type RequestedBulkLine = {
  orderItemId: string | null;
  sku: string;
  normalizedSku: string;
  occurrence: number;
  dispatchQuantity: number;
  status: Exclude<DispatchStatus, "pending">;
};

type DispatchApiRecord = OrderDispatchRecord & {
  _id?: { toString(): string };
};

function safeText(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function pickFirstText(max: number, ...values: unknown[]): string {
  for (const value of values) {
    const text = safeText(value, max);
    if (text) return text;
  }
  return "";
}

function orderLookupKey(value: unknown): string {
  const raw = safeText(value, 120);
  const match = raw.match(/(?:^|\/)(\d+)$/);
  return match?.[1] ?? raw;
}

function parseActor(req: NextRequest): DispatchUserSession | null {
  const actorId = safeText(req.headers.get("x-omsons-actor-id"), 80);
  const actorRole = safeText(req.headers.get("x-omsons-actor-role"), 40).toLowerCase();
  const roletype = safeText(req.headers.get("x-omsons-actor-roletype"), 40);

  if (!actorId) return null;
  if (actorRole !== "admin" && actorRole !== "staff" && actorRole !== "dealer") return null;

  return {
    id: actorId,
    role: actorRole,
    roletype,
  };
}

function toResponseRecord(doc: DispatchApiRecord) {
  return {
    ...doc,
    ...(doc._id ? { id: doc._id.toString() } : {}),
    orderItemId: normalizeDispatchOrderItemId(doc.orderItemId),
    assignedStaffId: normalizeDispatchOrderItemId(doc.assignedStaffId),
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    legacyImportedAt: doc.legacyImportedAt instanceof Date ? doc.legacyImportedAt.toISOString() : doc.legacyImportedAt,
    updates: (doc.updates ?? []).map((update) => ({
      ...update,
      createdAt: update.createdAt instanceof Date ? update.createdAt.toISOString() : update.createdAt,
    })),
    remainingQuantity: computeRemainingQuantity(doc.orderedQuantity, doc.dispatchedQuantity),
  };
}

async function getCollection() {
  const db = await getDb();
  const collection = db.collection<DispatchApiRecord>(COLLECTION);
  await collection.createIndex(
    { orderItemId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        orderItemId: { $exists: true, $type: "string" },
      },
    }
  );
  await collection.createIndex(
    { orderId: 1, normalizedSku: 1, occurrence: 1 },
    { unique: true, partialFilterExpression: { orderItemId: null } }
  );
  await collection.createIndex({ orderId: 1, updatedAt: -1 });
  return collection;
}

async function fetchPhpOrderPayload(orderId: string): Promise<PhpOrderPayload> {
  const response = await fetch(`${BACKEND_URL}/orderdatalist?id=${encodeURIComponent(orderId)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`orderdatalist failed with ${response.status}`);
  }

  const payload = await parsePhpJsonResponse<Record<string, unknown>>(response);
  const raw = payload?.data;

  if (Array.isArray(raw)) {
    if (raw.length === 0) return { items: [], meta: {} };

    if (raw[0]?.items && Array.isArray(raw[0].items)) {
      const meta = raw[0] ?? {};
      const items = raw[0].items.map((item: Record<string, unknown>, index: number) => ({
        orderdata_id: String(item.productId ?? item.id ?? `item-${index}`),
        orderdata_orderid: String(item.orderId ?? orderId),
        orderdata_cat_no: String(item.productId ?? item.catNo ?? item.orderdata_cat_no ?? ""),
        orderdata_item_quantity: String(item.quantityPacks ?? item.quantity ?? item.orderdata_item_quantity ?? 0),
        orderdata_status: String(item.status ?? item.orderdata_status ?? "0"),
        order_status: String(item.order_status ?? meta.order_status ?? ""),
        readyquantity: String(item.readyQuantity ?? item.readyquantity ?? 0),
        remark: String(item.remark ?? item.remarks ?? ""),
        remarks: String(item.remarks ?? item.remark ?? ""),
        order_dealer: String(item.order_dealer ?? meta.order_dealer ?? meta.Dealer_Id ?? ""),
        orderdata_dealerid: String(item.orderdata_dealerid ?? meta.orderdata_dealerid ?? ""),
        Dealer_Id: String(item.Dealer_Id ?? meta.Dealer_Id ?? ""),
        dealerId: String(item.dealerId ?? meta.dealerId ?? ""),
        assignedstaff: String(item.assignedstaff ?? meta.assignedstaff ?? ""),
        staffid: String(item.staffid ?? meta.staffid ?? ""),
        accept_order: String(item.accept_order ?? meta.accept_order ?? ""),
        del_status: String(item.del_status ?? meta.del_status ?? ""),
      }));
      return { items, meta };
    }

    if (raw[0]?.productId || raw[0]?.productName || raw[0]?.quantityPacks !== undefined) {
      const meta = raw[0] ?? {};
      const items = raw.map((item: Record<string, unknown>, index: number) => ({
        orderdata_id: String(item.productId ?? item.id ?? `item-${index}`),
        orderdata_orderid: String(item.orderId ?? orderId),
        orderdata_cat_no: String(item.productId ?? item.catNo ?? item.orderdata_cat_no ?? ""),
        orderdata_item_quantity: String(item.quantityPacks ?? item.quantity ?? item.orderdata_item_quantity ?? 0),
        orderdata_status: String(item.status ?? item.orderdata_status ?? "0"),
        order_status: String(item.order_status ?? meta.order_status ?? ""),
        readyquantity: String(item.readyQuantity ?? item.readyquantity ?? 0),
        remark: String(item.remark ?? item.remarks ?? ""),
        remarks: String(item.remarks ?? item.remark ?? ""),
        order_dealer: String(item.order_dealer ?? meta.order_dealer ?? meta.Dealer_Id ?? ""),
        orderdata_dealerid: String(item.orderdata_dealerid ?? meta.orderdata_dealerid ?? ""),
        Dealer_Id: String(item.Dealer_Id ?? meta.Dealer_Id ?? ""),
        dealerId: String(item.dealerId ?? meta.dealerId ?? ""),
        assignedstaff: String(item.assignedstaff ?? meta.assignedstaff ?? ""),
        staffid: String(item.staffid ?? meta.staffid ?? ""),
        accept_order: String(item.accept_order ?? meta.accept_order ?? ""),
        del_status: String(item.del_status ?? meta.del_status ?? ""),
      }));
      return { items, meta };
    }

    return { items: raw as PhpOrderItem[], meta: raw[0] ?? {} };
  }

  if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).items)) {
    const meta = raw as Record<string, unknown>;
    const rawItems = meta.items as Record<string, unknown>[];
    const items = rawItems.map((item: Record<string, unknown>, index: number) => ({
      orderdata_id: String(item.productId ?? item.id ?? `item-${index}`),
      orderdata_orderid: String(item.orderId ?? orderId),
      orderdata_cat_no: String(item.productId ?? item.catNo ?? item.orderdata_cat_no ?? ""),
      orderdata_item_quantity: String(item.quantityPacks ?? item.quantity ?? item.orderdata_item_quantity ?? 0),
      orderdata_status: String(item.status ?? item.orderdata_status ?? "0"),
      order_status: String(item.order_status ?? meta.order_status ?? ""),
      readyquantity: String(item.readyQuantity ?? item.readyquantity ?? 0),
      remark: String(item.remark ?? item.remarks ?? ""),
      remarks: String(item.remarks ?? item.remark ?? ""),
      order_dealer: String(item.order_dealer ?? meta.order_dealer ?? meta.Dealer_Id ?? ""),
      orderdata_dealerid: String(item.orderdata_dealerid ?? meta.orderdata_dealerid ?? ""),
      Dealer_Id: String(item.Dealer_Id ?? meta.Dealer_Id ?? ""),
      dealerId: String(item.dealerId ?? meta.dealerId ?? ""),
      assignedstaff: String(item.assignedstaff ?? meta.assignedstaff ?? ""),
      staffid: String(item.staffid ?? meta.staffid ?? ""),
      accept_order: String(item.accept_order ?? meta.accept_order ?? ""),
      del_status: String(item.del_status ?? meta.del_status ?? ""),
    }));
    return { items, meta };
  }

  return { items: [], meta: {} };
}

async function fetchPhpOrderAccessContext(orderId: string, dealerId: string): Promise<DispatchOrderAccessContext | null> {
  const normalizedDealerId = safeText(dealerId, 80);
  if (!normalizedDealerId) return null;

  const response = await fetch(
    `${BACKEND_URL}/orderhispegination?page=1&limit=20&search=${encodeURIComponent(orderId)}&id=${encodeURIComponent(normalizedDealerId)}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error(`orderhispegination failed with ${response.status}`);
  }

  const payload = await parsePhpJsonResponse<Record<string, unknown>>(response);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const matched = rows.find((entry: Record<string, unknown>) => orderLookupKey(entry?.order_id) === orderLookupKey(orderId));
  if (!matched) return null;

  return {
    dealerId: pickFirstText(80, matched.order_dealer, normalizedDealerId),
    assignedStaffId: pickFirstText(80, matched.assignedstaff, matched.staffid),
    acceptOrder: pickFirstText(10, matched.accept_order),
    delStatus: pickFirstText(10, matched.del_status),
    orderStatus: pickFirstText(40, matched.order_status),
  };
}

function resolveOrderContext(meta: Record<string, unknown>, item: Partial<PhpOrderItem> | null, fallback: {
  dealerId?: string;
  assignedStaffId?: string;
  acceptOrder?: string;
  delStatus?: string;
}) {
  const dealerId = pickFirstText(
    80,
    item?.order_dealer,
    item?.orderdata_dealerid,
    item?.Dealer_Id,
    item?.dealerId,
    meta.order_dealer,
    meta.orderdata_dealerid,
    meta.Dealer_Id,
    meta.dealerId,
    fallback.dealerId
  );
  const assignedStaffId = pickFirstText(
    80,
    item?.assignedstaff,
    item?.staffid,
    meta.assignedstaff,
    meta.staffid,
    fallback.assignedStaffId
  );
  const acceptOrder = pickFirstText(10, item?.accept_order, meta.accept_order, fallback.acceptOrder);
  const delStatus = pickFirstText(10, item?.del_status, meta.del_status, fallback.delStatus);

  return { dealerId, assignedStaffId, acceptOrder, delStatus };
}

function buildResolvedAccessContext(...sources: Array<Partial<DispatchOrderAccessContext> | null | undefined>): DispatchOrderAccessContext {
  return {
    dealerId: pickFirstText(80, ...sources.map((source) => source?.dealerId)),
    assignedStaffId: pickFirstText(80, ...sources.map((source) => source?.assignedStaffId)),
    acceptOrder: pickFirstText(10, ...sources.map((source) => source?.acceptOrder)),
    delStatus: pickFirstText(10, ...sources.map((source) => source?.delStatus)),
    orderStatus: pickFirstText(40, ...sources.map((source) => source?.orderStatus)),
  };
}

function resolveItemOccurrence(items: PhpOrderItem[], target: PhpOrderItem) {
  const normalizedSku = normalizeSku(target.orderdata_cat_no);
  if (!normalizedSku) return 1;

  let count = 0;
  for (const item of items) {
    if (normalizeSku(item.orderdata_cat_no) !== normalizedSku) continue;
    count += 1;
    if (item === target) return count;
  }
  return 1;
}

function findPhpItem(items: PhpOrderItem[], input: {
  orderItemId?: string | null;
  sku?: string;
  occurrence?: number;
}) {
  const orderItemId = normalizeDispatchOrderItemId(input.orderItemId);
  if (orderItemId) {
    return items.find((item) => normalizeDispatchOrderItemId(item.orderdata_id) === orderItemId) ?? null;
  }

  const normalizedSku = normalizeSku(input.sku);
  if (!normalizedSku) return null;
  const occurrence = Math.max(1, safeDispatchInteger(input.occurrence) || 1);

  let count = 0;
  for (const item of items) {
    if (normalizeSku(item.orderdata_cat_no) !== normalizedSku) continue;
    count += 1;
    if (count === occurrence) return item;
  }

  return null;
}

function hasLegacyDispatchData(item: PhpOrderItem) {
  return safeDispatchInteger(item.readyquantity) > 0 || normalizeDispatchStatus(item.orderdata_status) !== "pending";
}

function bulkUpdateId(idempotencyKey: string, line: {
  orderItemId: string | null;
  normalizedSku: string;
  occurrence: number;
}) {
  const identity = line.orderItemId || `${line.normalizedSku}:${line.occurrence}`;
  return `bulk:${idempotencyKey}:${identity}`.slice(0, 240);
}

async function importLegacyDispatchRecords(orderId: string, payload: PhpOrderPayload, fallback: {
  dealerId?: string;
  assignedStaffId?: string;
  acceptOrder?: string;
  delStatus?: string;
}) {
  const collection = await getCollection();

  for (const item of payload.items) {
    if (!hasLegacyDispatchData(item)) continue;

    const context = resolveOrderContext(payload.meta, item, fallback);
    const seed = buildLegacyDispatchSeed({
      orderId,
      orderItemId: item.orderdata_id,
      sku: item.orderdata_cat_no,
      occurrence: resolveItemOccurrence(payload.items, item),
      dealerId: context.dealerId,
      assignedStaffId: context.assignedStaffId || null,
      orderedQuantity: safeDispatchInteger(item.orderdata_item_quantity),
      legacyReadyQuantity: safeDispatchInteger(item.readyquantity),
      legacyStatus: item.orderdata_status,
      now: new Date(),
    });

    try {
      await collection.updateOne(
        buildDispatchIdentity({
          orderId,
          orderItemId: seed.orderItemId,
          sku: seed.sku,
          occurrence: seed.occurrence,
        }),
        { $setOnInsert: seed },
        { upsert: true }
      );
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) {
        throw error;
      }
    }
  }
}

function authorizeView(actor: DispatchUserSession | null, context: {
  dealerId?: string;
  assignedStaffId?: string;
}) {
  return canUserViewDispatch(actor, context);
}

function authorizeEdit(actor: DispatchUserSession | null, context: {
  dealerId?: string;
  assignedStaffId?: string;
  acceptOrder?: string;
  delStatus?: string;
}) {
  return canUserEditDispatch(actor, context);
}

async function handleBulkDispatch(actor: DispatchUserSession, body: Record<string, unknown>) {
  if (actor.role !== "staff") {
    return NextResponse.json({ success: false, message: "Multi-item dispatch is available only to assigned Staff" }, { status: 403 });
  }

  const orderId = safeText(body.orderId, 80);
  const idempotencyKey = safeText(body.idempotencyKey, 120);
  const remark = normalizeDispatchRemark(body.remark, 500);
  const rawLines = Array.isArray(body.items) ? body.items : [];

  if (!orderId || isExpectedOrderNumber(orderId)) {
    return NextResponse.json({ success: false, message: "A raw orderId is required" }, { status: 400 });
  }
  if (!idempotencyKey) {
    return NextResponse.json({ success: false, message: "A stable idempotency key is required" }, { status: 400 });
  }
  if (!remark) {
    return NextResponse.json({ success: false, message: "Operational remark is required" }, { status: 400 });
  }
  if (String(body.remark ?? "").trim().length > 500) {
    return NextResponse.json({ success: false, message: "Operational remark must be at most 500 characters" }, { status: 400 });
  }
  if (rawLines.length === 0 || rawLines.length > 100) {
    return NextResponse.json({ success: false, message: "Select between 1 and 100 dispatchable products" }, { status: 400 });
  }

  const overlay = await findOrderOverlay(orderId).catch(() => null);
  if (overlay?.status === "cancelled") {
    return NextResponse.json({ success: false, message: "Cancelled orders cannot be dispatched" }, { status: 409 });
  }
  const payload = await fetchPhpOrderPayload(orderId);
  if (payload.items.length === 0) {
    return NextResponse.json({ success: false, message: "Order not found" }, { status: 404 });
  }

  const detailContext = resolveOrderContext(payload.meta, payload.items[0] ?? null, {});
  const headerContext = await fetchPhpOrderAccessContext(orderId, detailContext.dealerId).catch(() => null);
  const context = {
    ...buildResolvedAccessContext(headerContext, detailContext),
    acceptOrder: resolveOrderAcceptance({
      phpValues: [headerContext?.acceptOrder, detailContext.acceptOrder],
      mongoAccepted: overlay?.acceptance?.rawStatus,
      deleted: headerContext?.delStatus || detailContext.delStatus,
      terminalValues: [headerContext?.orderStatus, payload.meta.order_status, payload.meta.status, payload.meta.mtstatus, overlay?.status],
    }),
  };
  const assignedDealerIds = await fetchStaffAssignedDealerIds(actor.id).catch(() => null);
  if (!assignedDealerIds) {
    return NextResponse.json({ success: false, message: "Staff assignment verification is temporarily unavailable" }, { status: 503 });
  }
  const activeAccess = await resolveOrderAccess(orderId, {
    actor: { role: "staff", actorId: actor.id },
    assignedDealerIds,
  });
  if (!activeAccess.visible || !context.dealerId || !assignedDealerIds.includes(context.dealerId)) {
    return NextResponse.json({ success: false, message: activeAccess.message || "Unauthorized or unassigned dispatch update" }, { status: 403 });
  }
  context.assignedStaffId = actor.id;

  if (!authorizeEdit(actor, context)) {
    return NextResponse.json({ success: false, message: "Unauthorized or unassigned dispatch update" }, { status: 403 });
  }

  const collection = await getCollection();
  await importLegacyDispatchRecords(orderId, payload, context);

  const latestOverlayItems = overlay?.edits?.[overlay.edits.length - 1]?.effectiveItems;
  const effectiveItems = (Array.isArray(latestOverlayItems) && latestOverlayItems.length > 0
    ? latestOverlayItems
    : payload.items) as PhpOrderItem[];

  for (const item of effectiveItems) {
    const orderedQuantity = safeDispatchInteger(item.orderdata_item_quantity);
    if (orderedQuantity <= 0) continue;

    const occurrence = resolveItemOccurrence(effectiveItems, item);
    const baseDoc = buildLegacyDispatchSeed({
      orderId,
      orderItemId: item.orderdata_id,
      sku: item.orderdata_cat_no,
      occurrence,
      dealerId: context.dealerId,
      assignedStaffId: context.assignedStaffId || null,
      orderedQuantity,
      legacyReadyQuantity: safeDispatchInteger(item.readyquantity),
      legacyStatus: item.orderdata_status,
      now: new Date(),
    });

    try {
      await collection.updateOne(
        buildDispatchIdentity({
          orderId,
          orderItemId: item.orderdata_id,
          sku: item.orderdata_cat_no,
          occurrence,
        }),
        { $setOnInsert: baseDoc },
        { upsert: true }
      );
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) {
        throw error;
      }
    }
  }

  const docs = await collection.find({ orderId }).sort({ updatedAt: -1, createdAt: -1 }).toArray();
  const mergedItems = mergeOrderItemsWithDispatchRecords(effectiveItems, docs);
  const plan = buildBulkDispatchPlan(mergedItems);
  const dispatchableByKey = new Map(plan.lines.map((line) => [buildBulkDispatchLineKey(line), line]));
  const recordsByKey = new Map(docs.map((record) => [buildBulkDispatchLineKey(record), record]));
  const requestedLines: RequestedBulkLine[] = [];
  const replayedRecords: DispatchApiRecord[] = [];
  const seenKeys = new Set<string>();

  for (const rawLine of rawLines) {
    if (!rawLine || typeof rawLine !== "object") {
      return NextResponse.json({ success: false, message: "Each selected product must have a valid identity" }, { status: 400 });
    }
    const input = rawLine as Record<string, unknown>;
    const orderItemId = normalizeDispatchOrderItemId(input.orderItemId);
    const sku = safeText(input.sku, 200);
    const normalizedSku = normalizeSku(sku);
    const occurrence = Math.max(1, safeDispatchInteger(input.occurrence) || 1);
    const key = buildBulkDispatchLineKey({ orderItemId, normalizedSku, occurrence });
    const line = key ? dispatchableByKey.get(key) : null;
    if (!key || seenKeys.has(key)) {
      return NextResponse.json({ success: false, message: "A selected product is missing, duplicated, or no longer dispatchable", itemKey: key }, { status: 409 });
    }
    const dispatchQuantity = Number(input.dispatchQuantity);
    const status = normalizeDispatchStatus(input.status);
    if (!DISPATCH_MUTATION_STATUSES.includes(status as (typeof DISPATCH_MUTATION_STATUSES)[number])) {
      return NextResponse.json({ success: false, message: "Invalid dispatch status for a selected product", itemKey: key }, { status: 400 });
    }
    if (!Number.isFinite(dispatchQuantity) || !Number.isInteger(dispatchQuantity) || dispatchQuantity <= 0) {
      return NextResponse.json({ success: false, message: "Invalid dispatch quantity for a selected product", itemKey: key }, { status: 409 });
    }
    const replayed = recordsByKey.get(key);
    const replayUpdateId = bulkUpdateId(idempotencyKey, { orderItemId, normalizedSku, occurrence });
    if (replayed?.updates?.some((update) => update.id === replayUpdateId)) {
      seenKeys.add(key);
      replayedRecords.push(replayed);
      continue;
    }
    if (!line || dispatchQuantity > line.remainingQuantity) {
      return NextResponse.json({ success: false, message: "A selected product is missing or no longer has the requested remaining quantity", itemKey: key }, { status: 409 });
    }
    seenKeys.add(key);
    requestedLines.push({
      orderItemId: line.orderItemId,
      sku: line.sku,
      normalizedSku: line.normalizedSku,
      occurrence: line.occurrence,
      dispatchQuantity,
      status: status as Exclude<DispatchStatus, "pending">,
    });
  }

  const timestamp = new Date();
  const records: DispatchApiRecord[] = [...replayedRecords];
  const failures: Array<{ sku: string; orderItemId: string | null; occurrence: number; message: string }> = [];

  for (const line of requestedLines) {
    const updateId = bulkUpdateId(idempotencyKey, line);
    const identity = buildDispatchIdentity({
      orderId,
      orderItemId: line.orderItemId,
      sku: line.sku,
      occurrence: line.occurrence,
    });

    const existing = await collection.findOne(identity);
    if (existing?.updates?.some((update) => update.id === updateId)) {
      records.push(existing);
      continue;
    }

    const dispatchQuantity = line.dispatchQuantity;
    const statusExpression = {
      $let: {
        vars: {
          nextDispatched: { $add: ["$dispatchedQuantity", dispatchQuantity] },
        },
        in: {
          $cond: [
            { $eq: [{ $subtract: ["$orderedQuantity", "$$nextDispatched"] }, 0] },
            "successful",
            line.status,
          ],
        },
      },
    };

    const updated = await collection.findOneAndUpdate(
      {
        ...identity,
        "updates.id": { $ne: updateId },
        $expr: {
          $lte: [
            { $add: ["$dispatchedQuantity", dispatchQuantity] },
            "$orderedQuantity",
          ],
        },
      },
      [
        {
          $set: {
            orderId,
            orderItemId: line.orderItemId,
            sku: line.sku,
            normalizedSku: line.normalizedSku,
            occurrence: line.occurrence,
            dealerId: context.dealerId,
            assignedStaffId: context.assignedStaffId || null,
            dispatchedQuantity: { $add: ["$dispatchedQuantity", dispatchQuantity] },
            currentStatus: statusExpression,
            updatedAt: timestamp,
            updates: {
              $concatArrays: [
                { $ifNull: ["$updates", []] },
                [
                  {
                    id: updateId,
                    quantity: dispatchQuantity,
                    remark,
                    status: statusExpression,
                    actorId: actor.id,
                    actorRole: "staff" as DispatchActorRole,
                    createdAt: timestamp,
                  },
                ],
              ],
            },
          },
        },
      ],
      { returnDocument: "after" }
    );

    if (updated) {
      records.push(updated);
      continue;
    }

    const current = await collection.findOne(identity);
    if (current?.updates?.some((update) => update.id === updateId)) {
      records.push(current);
      continue;
    }

    failures.push({
      sku: line.sku,
      orderItemId: line.orderItemId,
      occurrence: line.occurrence,
      message: "Another dispatch update changed the remaining quantity",
    });
  }

  if (failures.length > 0) {
    return NextResponse.json(
      {
        success: false,
        message: "Some products could not be dispatched because dispatch quantities changed",
        data: {
          records: records.map(toResponseRecord),
          failures,
        },
      },
      { status: 409 }
    );
  }

  invalidatePendingProductsCache();
  return NextResponse.json({
    success: true,
    data: records.map(toResponseRecord),
    failures: [],
  });
}

export async function GET(req: NextRequest) {
  try {
    const actor = parseActor(req);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Unauthenticated dispatch access" }, { status: 401 });
    }

    const orderId = safeText(req.nextUrl.searchParams.get("orderId") || req.nextUrl.searchParams.get("order_id"), 80);
    const orderItemId = safeText(req.nextUrl.searchParams.get("orderItemId") || req.nextUrl.searchParams.get("order_item_id"), 80);

    if (!orderId && !orderItemId) {
      return NextResponse.json({ success: false, message: "orderId or orderItemId is required" }, { status: 400 });
    }

    const collection = await getCollection();

    if (orderItemId) {
      const doc = await collection.findOne({ orderItemId });
      if (!doc) {
        return NextResponse.json({ success: false, message: "Dispatch record not found" }, { status: 404 });
      }
      const access = await resolveOrderAccess(doc.orderId, doc.dealerId);
      if (!access.visible) return NextResponse.json({ success: false, message: access.reason }, { status: 404 });
      if (!authorizeView(actor, { dealerId: doc.dealerId, assignedStaffId: doc.assignedStaffId ?? undefined })) {
        return NextResponse.json({ success: false, message: "Unauthorized dispatch access" }, { status: 403 });
      }
      return NextResponse.json({ success: true, data: toResponseRecord(doc) });
    }

    if (!orderId || isExpectedOrderNumber(orderId)) {
      return NextResponse.json({ success: false, message: "A raw orderId is required" }, { status: 400 });
    }

    const activeAccess = await resolveOrderAccess(orderId);
    if (!activeAccess.visible) return NextResponse.json({ success: false, message: activeAccess.reason }, { status: 404 });

    const payload = await fetchPhpOrderPayload(orderId);
    if (payload.items.length === 0) {
      const context = accessContextFromOrder(activeAccess.order);
      if (!authorizeView(actor, context)) {
        return NextResponse.json({ success: false, message: "Unauthorized dispatch access" }, { status: 403 });
      }
      const docs = await collection.find({ orderId }).sort({ updatedAt: -1, createdAt: -1 }).toArray();
      return NextResponse.json({ success: true, data: docs.map(toResponseRecord) });
    }

    const detailContext = resolveOrderContext(payload.meta, payload.items[0] ?? null, {});
    const headerContext = await fetchPhpOrderAccessContext(orderId, detailContext.dealerId).catch(() => null);
    const context = buildResolvedAccessContext(headerContext, detailContext);
    if (!authorizeView(actor, context)) {
      return NextResponse.json({ success: false, message: "Unauthorized dispatch access" }, { status: 403 });
    }

    await importLegacyDispatchRecords(orderId, payload, context);
    const docs = await collection.find({ orderId }).sort({ updatedAt: -1, createdAt: -1 }).toArray();
    return NextResponse.json({ success: true, data: docs.map(toResponseRecord) });
  } catch (error) {
    console.error("[GET /api/order-dispatch]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json(
      {
        success: false,
        message: status === 503 ? "Dispatch database is currently unavailable" : "Failed to load dispatch details",
      },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = parseActor(req);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Unauthenticated dispatch access" }, { status: 401 });
    }

    const body = await req.json();
    if (safeText(body.action, 40) === "dispatch_selected") {
      return handleBulkDispatch(actor, body);
    }

    if (actor.role === "dealer" || actor.role === "unknown") {
      return NextResponse.json({ success: false, message: "Dealers cannot update dispatch details" }, { status: 403 });
    }

    const orderId = safeText(body.orderId, 80);
    const orderItemId = normalizeDispatchOrderItemId(body.orderItemId);
    const sku = safeText(body.sku, 200);
    const occurrence = Math.max(1, safeDispatchInteger(body.occurrence) || 1);
    const requestedDealerId = safeText(body.dealerId, 80);
    const requestedAssignedStaffId = safeText(body.assignedStaffId, 80);
    const requestedDelStatus = safeText(body.delStatus, 10);
    const orderedQuantityHint = safeDispatchInteger(body.orderedQuantity);
    const dispatchQuantity = safeDispatchInteger(body.dispatchQuantity);
    const status = normalizeDispatchStatus(body.status, "pending");
    const remark = normalizeDispatchRemark(body.remark, 500);

    if (!orderId || isExpectedOrderNumber(orderId)) {
      return NextResponse.json({ success: false, message: "A raw orderId is required" }, { status: 400 });
    }
    const overlay = await findOrderOverlay(orderId).catch(() => null);
    if (overlay?.status === "cancelled") {
      return NextResponse.json({ success: false, message: "Cancelled orders cannot be dispatched" }, { status: 409 });
    }
    const activeAccess = await resolveOrderAccess(orderId, requestedDealerId);
    if (!activeAccess.visible) return NextResponse.json({ success: false, message: activeAccess.reason }, { status: 409 });
    if (!orderItemId && !normalizeSku(sku)) {
      return NextResponse.json({ success: false, message: "orderItemId or a valid SKU is required" }, { status: 400 });
    }
    if (dispatchQuantity <= 0) {
      return NextResponse.json({ success: false, message: "Dispatch Quantity must be greater than zero" }, { status: 400 });
    }
    if (!DISPATCH_MUTATION_STATUSES.includes(status as (typeof DISPATCH_MUTATION_STATUSES)[number])) {
      return NextResponse.json({ success: false, message: "A valid dispatch status is required" }, { status: 400 });
    }
    if (!remark) {
      return NextResponse.json({ success: false, message: "Operational remark is required" }, { status: 400 });
    }
    if (String(body.remark ?? "").trim().length > 500) {
      return NextResponse.json({ success: false, message: "Operational remark must be at most 500 characters" }, { status: 400 });
    }

    const payload = await fetchPhpOrderPayload(orderId);
    if (payload.items.length === 0) {
      return NextResponse.json({ success: false, message: "Order not found" }, { status: 404 });
    }

    const latestOverlayItems = overlay?.edits?.[overlay.edits.length - 1]?.effectiveItems;
    const effectiveItems = (Array.isArray(latestOverlayItems) && latestOverlayItems.length > 0
      ? latestOverlayItems
      : payload.items) as PhpOrderItem[];
    const phpItem = findPhpItem(effectiveItems, { orderItemId, sku, occurrence });
    if (!phpItem) {
      return NextResponse.json({ success: false, message: "Order product not found" }, { status: 404 });
    }

    const actualOccurrence = resolveItemOccurrence(effectiveItems, phpItem);
    const detailContext = resolveOrderContext(payload.meta, phpItem, {});
    const headerContext = await fetchPhpOrderAccessContext(orderId, detailContext.dealerId).catch(() => null);
    const context = {
      ...buildResolvedAccessContext(headerContext, detailContext, {
        dealerId: requestedDealerId,
        assignedStaffId: requestedAssignedStaffId,
        delStatus: requestedDelStatus,
        orderStatus: "",
      }),
      acceptOrder: resolveOrderAcceptance({
        phpValues: [headerContext?.acceptOrder, detailContext.acceptOrder],
        mongoAccepted: overlay?.acceptance?.rawStatus,
        deleted: headerContext?.delStatus || detailContext.delStatus || requestedDelStatus,
        terminalValues: [headerContext?.orderStatus, payload.meta.order_status, payload.meta.status, payload.meta.mtstatus, overlay?.status],
      }),
    };

    if (!authorizeEdit(actor, context)) {
      return NextResponse.json({ success: false, message: "Unauthorized or unassigned dispatch update" }, { status: 403 });
    }

    const orderedQuantity = safeDispatchInteger(phpItem.orderdata_item_quantity) || orderedQuantityHint;
    if (orderedQuantity <= 0) {
      return NextResponse.json({ success: false, message: "Ordered quantity must be positive" }, { status: 400 });
    }

    const collection = await getCollection();
    const identity = buildDispatchIdentity({
      orderId,
      orderItemId: phpItem.orderdata_id,
      sku: phpItem.orderdata_cat_no,
      occurrence: actualOccurrence,
    });

    const baseDoc = buildLegacyDispatchSeed({
      orderId,
      orderItemId: phpItem.orderdata_id,
      sku: phpItem.orderdata_cat_no,
      occurrence: actualOccurrence,
      dealerId: context.dealerId,
      assignedStaffId: context.assignedStaffId || null,
      orderedQuantity,
      legacyReadyQuantity: safeDispatchInteger(body.legacyReadyQuantity ?? phpItem.readyquantity),
      legacyStatus: body.legacyStatus ?? phpItem.orderdata_status,
      now: new Date(),
    });

    try {
      await collection.updateOne(identity, { $setOnInsert: baseDoc }, { upsert: true });
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) {
        throw error;
      }
    }

    const timestamp = new Date();
    const updateId = randomUUID();
    const requestedStatus = status as Exclude<DispatchStatus, "pending">;
    const statusExpression = {
      $let: {
        vars: {
          nextDispatched: { $add: ["$dispatchedQuantity", dispatchQuantity] },
        },
        in: {
          $cond: [
            {
              $and: [
                { $eq: [{ $subtract: ["$orderedQuantity", "$$nextDispatched"] }, 0] },
                { $ne: [requestedStatus, "not_in_stock"] },
              ],
            },
            "successful",
            requestedStatus,
          ],
        },
      },
    };

    const updated = await collection.findOneAndUpdate(
      {
        ...identity,
        $expr: {
          $lte: [
            { $add: ["$dispatchedQuantity", dispatchQuantity] },
            "$orderedQuantity",
          ],
        },
      },
      [
        {
          $set: {
            orderId,
            orderItemId: normalizeDispatchOrderItemId(phpItem.orderdata_id),
            sku: phpItem.orderdata_cat_no,
            normalizedSku: normalizeSku(phpItem.orderdata_cat_no),
            occurrence: actualOccurrence,
            dealerId: context.dealerId,
            assignedStaffId: context.assignedStaffId || null,
            orderedQuantity,
            dispatchedQuantity: { $add: ["$dispatchedQuantity", dispatchQuantity] },
            currentStatus: statusExpression,
            updatedAt: timestamp,
            updates: {
              $concatArrays: [
                { $ifNull: ["$updates", []] },
                [
                  {
                    id: updateId,
                    quantity: dispatchQuantity,
                    remark,
                    status: statusExpression,
                    actorId: actor.id,
                    actorRole: actor.role as DispatchActorRole,
                    createdAt: timestamp,
                  },
                ],
              ],
            },
          },
        },
      ],
      { returnDocument: "after" }
    );

    if (!updated) {
      return NextResponse.json(
        { success: false, message: "Dispatch quantity exceeds the remaining quantity" },
        { status: 409 }
      );
    }

    invalidatePendingProductsCache();
    return NextResponse.json({ success: true, data: toResponseRecord(updated) });
  } catch (error) {
    console.error("[POST /api/order-dispatch]", error);

    if (error instanceof MongoServerError && error.code === 11000) {
      return NextResponse.json({ success: false, message: "A conflicting dispatch record already exists" }, { status: 409 });
    }

    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json(
      {
        success: false,
        message: status === 503 ? "Dispatch database is currently unavailable" : "Failed to save dispatch details",
      },
      { status }
    );
  }
}
