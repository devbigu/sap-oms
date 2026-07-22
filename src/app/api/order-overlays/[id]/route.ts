import { NextRequest, NextResponse } from "next/server";
import { MongoServerError } from "mongodb";
import { resolveOrderAccess } from "@/lib/orderAccess";
import { fetchStaffAssignedDealerIds, parseOrderActor } from "@/lib/orderScopeServer";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { invalidatePendingProductsCache } from "@/lib/pendingProducts";
import { parsePhpJsonResponse } from "@/lib/phpJson";
import walletUtils from "@/lib/wallet";
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
  saveAcceptedState,
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
  return parsePhpJsonResponse(response);
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

async function loadPublicEffectiveContext(orderIdInput: string) {
  const orderId = normalizeOverlayOrderId(orderIdInput);
  const phpDetail = await fetchPhpDetail(orderId);
  const normalized = normalizeOrderItems(phpDetail, orderId);
  const originalOrder = normalized.meta;
  const overlay = await findOrderOverlay(orderId);
  const dispatchRecords = await fetchDispatchRecords(orderId).catch(() => []);
  const effective = resolveEffectiveOrder({
    orderId,
    originalOrder,
    originalItems: normalized.items,
    overlay,
    dispatchRecords,
  });
  return { effective, overlay };
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await loadPublicEffectiveContext(id);
    return NextResponse.json({
      success: true,
      data: {
        ...context.effective,
        itemContract: "complete",
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
    const { id } = await params;
    const body = await req.json();
    const action = safeText(body.action, 40);

    if (action === "mirror_acceptance") {
      if (actor.role !== "admin") {
        return NextResponse.json({ success: false, message: "Only Admin can mirror accepted order state." }, { status: 403 });
      }
      if (String(body.acceptOrder ?? "").trim() !== "1") {
        return NextResponse.json({ success: false, message: "Only a successful accepted state can be mirrored." }, { status: 400 });
      }
      const saved = await saveAcceptedState({
        orderId: id,
        dealerId: safeText(body.dealerId, 80),
        assignedStaffId: safeText(body.assignedStaffId, 80) || null,
        actor,
      });
      invalidatePendingProductsCache();
      return NextResponse.json({ success: true, data: toSafeOverlay(saved) });
    }

    if (actor.role !== "dealer") {
      return NextResponse.json({ success: false, message: "Only Dealers can change their order overlay." }, { status: 403 });
    }

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
      const db = await getDb();
      const originalDebit = await db.collection("wallet_transactions").findOne({
        dealerId: context.dealerId,
        relatedOrderId: context.orderId,
        type: "order_debit",
      });
      if (originalDebit) {
        await walletUtils.applyWalletChange(db, context.dealerId, "refund", originalDebit.amount ?? Number(originalDebit.amountPaise || 0) / 100, {
          relatedOrderId: context.orderId,
          relatedOrderNumber: safeText(body.formattedOrderNumber, 80),
          reference: `refund:${context.orderId}`,
          note: `Refund for eligible cancelled order: ${safeText(body.reason, 1000)}`,
          actorId: actor.actorId,
          actorRole: actor.role,
          actorName: actor.name,
          idempotencyKey: `order-refund:${context.orderId}`,
        });
      }
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
      const db = await getDb();
      const originalDebit = await db.collection("wallet_transactions").findOne({
        dealerId: context.dealerId,
        relatedOrderId: context.orderId,
        type: "order_debit",
      });
      const difference = Math.round((revision.totals.netPayableAmount - context.effective.effectiveTotals.netPayableAmount) * 100) / 100;
      let walletAdjustment: Awaited<ReturnType<typeof walletUtils.applyWalletChange>> | null = null;
      if (originalDebit && Math.abs(difference) >= 0.01) {
        walletAdjustment = await walletUtils.applyWalletChange(db, context.dealerId, difference > 0 ? "debit" : "refund", Math.abs(difference), {
          relatedOrderId: context.orderId,
          reference: `edit:${context.orderId}:${revision.revision}`,
          note: difference > 0 ? "Order edit Net Payable increase" : "Order edit Net Payable decrease",
          actorId: actor.actorId,
          actorRole: actor.role,
          actorName: actor.name,
          idempotencyKey: `order-edit:${context.orderId}:${revision.revision}`,
        });
      }
      let saved;
      try {
        saved = await saveEditRevision({
          orderId: context.orderId,
          dealerId: context.dealerId,
          dealerName: safeText(context.originalOrder.Dealer_Name, 200),
          assignedStaffId: context.assignedStaffId,
          originalOrderRef: context.originalOrder,
          revision,
          expectedRevision,
        });
      } catch (error) {
        if (walletAdjustment && !walletAdjustment.duplicate) {
          await walletUtils.applyWalletChange(db, context.dealerId, difference > 0 ? "refund" : "debit", Math.abs(difference), {
            relatedOrderId: context.orderId,
            reference: `edit-rollback:${context.orderId}:${revision.revision}`,
            note: "Order edit wallet rollback",
            idempotencyKey: `order-edit-rollback:${context.orderId}:${revision.revision}`,
          });
        }
        throw error;
      }
      invalidatePendingProductsCache();
      return NextResponse.json({ success: true, data: toSafeOverlay(saved) });
    }

    return NextResponse.json({ success: false, message: "Unsupported overlay action." }, { status: 400 });
  } catch (error) {
    console.error("[POST /api/order-overlays/[id]]", error);
    return errorResponse(error);
  }
}
