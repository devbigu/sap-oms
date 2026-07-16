import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveActiveOrder } from "@/lib/activeOrderAccess";
import { MongoServerError } from "mongodb";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import {
  buildDispatchIdentity,
  buildLegacyDispatchSeed,
  canUserEditDispatch,
  canUserViewDispatch,
  computeRemainingQuantity,
  DISPATCH_MUTATION_STATUSES,
  normalizeDispatchOrderItemId,
  normalizeDispatchRemark,
  normalizeDispatchStatus,
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

  const payload = await response.json();
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

  if (raw && typeof raw === "object" && Array.isArray(raw.items)) {
    const meta = raw as Record<string, unknown>;
    const items = raw.items.map((item: Record<string, unknown>, index: number) => ({
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

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const matched = rows.find((entry: Record<string, unknown>) => safeText(entry?.order_id, 80) === orderId) ?? rows[0];
  if (!matched) return null;

  return {
    dealerId: pickFirstText(80, matched.order_dealer, normalizedDealerId),
    assignedStaffId: pickFirstText(80, matched.assignedstaff, matched.staffid),
    acceptOrder: pickFirstText(10, matched.accept_order, "0") || "0",
    delStatus: pickFirstText(10, matched.del_status, "0") || "0",
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
  const acceptOrder = pickFirstText(10, item?.accept_order, meta.accept_order, fallback.acceptOrder, "0") || "0";
  const delStatus = pickFirstText(10, item?.del_status, meta.del_status, fallback.delStatus, "0") || "0";

  return { dealerId, assignedStaffId, acceptOrder, delStatus };
}

function buildResolvedAccessContext(...sources: Array<Partial<DispatchOrderAccessContext> | null | undefined>): DispatchOrderAccessContext {
  return {
    dealerId: pickFirstText(80, ...sources.map((source) => source?.dealerId)),
    assignedStaffId: pickFirstText(80, ...sources.map((source) => source?.assignedStaffId)),
    acceptOrder: pickFirstText(10, ...sources.map((source) => source?.acceptOrder), "0") || "0",
    delStatus: pickFirstText(10, ...sources.map((source) => source?.delStatus), "0") || "0",
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
      const access = await resolveActiveOrder(doc.orderId, doc.dealerId);
      if (!access.visible) return NextResponse.json({ success: false, message: access.reason }, { status: 404 });
      if (!authorizeView(actor, { dealerId: doc.dealerId, assignedStaffId: doc.assignedStaffId ?? undefined })) {
        return NextResponse.json({ success: false, message: "Unauthorized dispatch access" }, { status: 403 });
      }
      return NextResponse.json({ success: true, data: toResponseRecord(doc) });
    }

    if (!orderId || isExpectedOrderNumber(orderId)) {
      return NextResponse.json({ success: false, message: "A raw orderId is required" }, { status: 400 });
    }

    const activeAccess = await resolveActiveOrder(orderId);
    if (!activeAccess.visible) return NextResponse.json({ success: false, message: activeAccess.reason }, { status: 404 });

    const payload = await fetchPhpOrderPayload(orderId);
    if (payload.items.length === 0) {
      return NextResponse.json({ success: false, message: "Order not found" }, { status: 404 });
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

    if (actor.role === "dealer" || actor.role === "unknown") {
      return NextResponse.json({ success: false, message: "Dealers cannot update dispatch details" }, { status: 403 });
    }

    const body = await req.json();
    const orderId = safeText(body.orderId, 80);
    const orderItemId = normalizeDispatchOrderItemId(body.orderItemId);
    const sku = safeText(body.sku, 200);
    const occurrence = Math.max(1, safeDispatchInteger(body.occurrence) || 1);
    const requestedDealerId = safeText(body.dealerId, 80);
    const requestedAssignedStaffId = safeText(body.assignedStaffId, 80);
    const requestedAcceptOrder = safeText(body.acceptOrder, 10);
    const requestedDelStatus = safeText(body.delStatus, 10);
    const orderedQuantityHint = safeDispatchInteger(body.orderedQuantity);
    const dispatchQuantity = safeDispatchInteger(body.dispatchQuantity);
    const status = normalizeDispatchStatus(body.status, "pending");
    const remark = normalizeDispatchRemark(body.remark, 500);

    if (!orderId || isExpectedOrderNumber(orderId)) {
      return NextResponse.json({ success: false, message: "A raw orderId is required" }, { status: 400 });
    }
    const activeAccess = await resolveActiveOrder(orderId, requestedDealerId);
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

    const phpItem = findPhpItem(payload.items, { orderItemId, sku, occurrence });
    if (!phpItem) {
      return NextResponse.json({ success: false, message: "Order product not found" }, { status: 404 });
    }

    const actualOccurrence = resolveItemOccurrence(payload.items, phpItem);
    const detailContext = resolveOrderContext(payload.meta, phpItem, {});
    const headerContext = await fetchPhpOrderAccessContext(orderId, detailContext.dealerId).catch(() => null);
    const context = buildResolvedAccessContext(
      headerContext,
      detailContext,
      {
        dealerId: requestedDealerId,
        assignedStaffId: requestedAssignedStaffId,
        acceptOrder: requestedAcceptOrder,
        delStatus: requestedDelStatus,
        orderStatus: "",
      }
    );

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
