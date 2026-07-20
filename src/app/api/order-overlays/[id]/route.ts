import { NextRequest, NextResponse } from "next/server";
import { MongoServerError } from "mongodb";
import { resolveOrderAccess } from "@/lib/orderAccess";
import { fetchStaffAssignedDealerIds, parseOrderActor } from "@/lib/orderScopeServer";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { invalidatePendingProductsCache } from "@/lib/pendingProducts";
import {
  buildOrderEditRevision,
  findOrderOverlay,
  normalizeOrderItems,
  normalizeOverlayOrderId,
  OrderOverlayError,
  resolveEffectiveOrder,
  resolveOverlayAssignedStaffId,
  resolveOverlayDealerId,
  saveCancellation,
  saveEditRevision,
  toSafeOverlay,
  type OrderOverlayActor,
} from "@/lib/orderOverlays";

export const runtime = "nodejs";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";

function safeText(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function parseActor(req: NextRequest): OrderOverlayActor | null {
  const query = req.nextUrl.searchParams;
  const actor = parseOrderActor({
    role: query.get("role") || req.headers.get("x-omsons-actor-role"),
    actorId: query.get("actor_id") || req.headers.get("x-omsons-actor-id"),
  });
  if (!actor) return null;
  return {
    role: actor.role,
    actorId: actor.actorId,
    name: safeText(req.headers.get("x-omsons-actor-name"), 160),
    roletype: safeText(req.headers.get("x-omsons-actor-roletype"), 40),
  };
}

async function fetchPhpDetail(orderId: string) {
  const response = await fetch(`${BACKEND_URL}/orderdatalist?id=${encodeURIComponent(orderId)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new OrderOverlayError(502, "php_unavailable", "Unable to fetch the original PHP order.");
  }
  return response.json();
}

async function fetchDispatchRecords(orderId: string) {
  const db = await getDb();
  return db.collection("order_dispatch_records").find({ orderId }).toArray();
}

async function loadEffectiveContext(orderIdInput: string, actor: OrderOverlayActor) {
  const orderId = normalizeOverlayOrderId(orderIdInput);
  const assignedDealerIds = actor.role === "staff"
    ? await fetchStaffAssignedDealerIds(actor.actorId)
    : [];
  const access = await resolveOrderAccess(orderId, {
    actor: { role: actor.role, actorId: actor.actorId },
    assignedDealerIds,
    dealerId: actor.role === "dealer" ? actor.actorId : undefined,
  });
  if (!access.visible || !access.order) {
    throw new OrderOverlayError(access.reason === "forbidden" ? 403 : 404, access.reason, access.message || "Order not found.");
  }

  const phpDetail = await fetchPhpDetail(orderId);
  const normalized = normalizeOrderItems(phpDetail, orderId);
  const originalOrder = { ...normalized.meta, ...access.order };
  const dealerId = resolveOverlayDealerId(originalOrder, normalized.items[0]);

  if (actor.role === "dealer" && dealerId !== actor.actorId) {
    throw new OrderOverlayError(403, "forbidden", "This order belongs to another Dealer.");
  }
  if (actor.role === "staff" && !assignedDealerIds.includes(dealerId)) {
    throw new OrderOverlayError(403, "forbidden", "This order is outside your assigned Dealer scope.");
  }

  const overlay = await findOrderOverlay(orderId);
  const dispatchRecords = await fetchDispatchRecords(orderId).catch(() => []);
  const effective = resolveEffectiveOrder({
    orderId,
    originalOrder,
    originalItems: normalized.items,
    overlay,
    dispatchRecords,
  });

  return {
    orderId,
    assignedDealerIds,
    originalOrder,
    originalItems: normalized.items,
    dealerId,
    assignedStaffId: resolveOverlayAssignedStaffId(originalOrder, normalized.items[0]),
    overlay,
    effective,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof OrderOverlayError) {
    return NextResponse.json({ success: false, code: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof MongoServerError && error.code === 11000) {
    return NextResponse.json({ success: false, code: "duplicate", message: "A conflicting order overlay already exists." }, { status: 409 });
  }
  const status = isMongoDependencyError(error) ? 503 : 500;
  return NextResponse.json(
    {
      success: false,
      code: status === 503 ? "mongo_unavailable" : "unexpected",
      message: status === 503 ? "Order overlay database is currently unavailable." : "Unable to process order overlay.",
    },
    { status }
  );
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = parseActor(req);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Missing order overlay identity." }, { status: 401 });
    }
    const { id } = await params;
    const context = await loadEffectiveContext(id, actor);
    return NextResponse.json({
      success: true,
      data: {
        ...context.effective,
        overlay: toSafeOverlay(context.overlay),
      },
    });
  } catch (error) {
    console.error("[GET /api/order-overlays/[id]]", error);
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = parseActor(req);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Missing order overlay identity." }, { status: 401 });
    }
    if (actor.role !== "dealer") {
      return NextResponse.json({ success: false, message: "Only Dealers can change their order overlay." }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const action = safeText(body.action, 40);
    const context = await loadEffectiveContext(id, actor);

    if (!context.effective.eligibility.canDealerChange) {
      return NextResponse.json(
        { success: false, code: context.effective.eligibility.reason, message: "This order can no longer be changed." },
        { status: 409 }
      );
    }

    if (action === "cancel") {
      const saved = await saveCancellation({
        orderId: context.orderId,
        formattedOrderNumber: safeText(body.formattedOrderNumber, 80),
        dealerId: context.dealerId,
        dealerName: safeText(context.originalOrder.Dealer_Name, 200),
        assignedStaffId: context.assignedStaffId,
        originalOrderRef: context.originalOrder,
        reason: safeText(body.reason, 1000),
        actor,
      });
      invalidatePendingProductsCache();
      return NextResponse.json({ success: true, data: toSafeOverlay(saved) });
    }

    if (action === "edit") {
      const expectedRevision = Number(body.expectedRevision ?? 0);
      if (!Number.isFinite(expectedRevision) || expectedRevision !== context.effective.latestRevision) {
        return NextResponse.json({ success: false, code: "stale_revision", message: "Reload the order before saving this edit." }, { status: 409 });
      }
      const requestedItems = Array.isArray(body.items) ? body.items : [];
      const revision = buildOrderEditRevision({
        orderId: context.orderId,
        baseOrder: context.originalOrder,
        originalItems: context.effective.effectiveItems,
        requestedItems,
        expectedRevision,
        idempotencyKey: safeText(body.idempotencyKey, 120),
        actor,
      });
      const saved = await saveEditRevision({
        orderId: context.orderId,
        dealerId: context.dealerId,
        dealerName: safeText(context.originalOrder.Dealer_Name, 200),
        assignedStaffId: context.assignedStaffId,
        originalOrderRef: context.originalOrder,
        revision,
        expectedRevision,
      });
      invalidatePendingProductsCache();
      return NextResponse.json({ success: true, data: toSafeOverlay(saved) });
    }

    return NextResponse.json({ success: false, message: "Unsupported overlay action." }, { status: 400 });
  } catch (error) {
    console.error("[POST /api/order-overlays/[id]]", error);
    return errorResponse(error);
  }
}
