import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { buildDraftApprovalState } from "@/lib/customDiscountRequests";
import { resolveOrderAccess } from "@/lib/orderAccess";

export const runtime = "nodejs";

function toObjectId(id: string) {
  try { return new ObjectId(id); } catch { return null; }
}

function safeText(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safePositiveNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toDoc(doc: any) {
  return {
    ...doc,
    id: doc._id.toString(),
    _id: undefined,
  };
}

const DEFAULT_REJECTION_NOTE = "Please revise the discount percentage and resubmit.";

function buildDraftName(now: string) {
  return `Disapproved Request: ${new Date(now).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function buildDraftRows(products: any[]) {
  return (Array.isArray(products) ? products : []).slice(0, 100).map((product, index) => {
    const productname = safeText(product?.productname, 200);
    const variantCode = safeText(product?.variantCode, 160);
    const displayName = safeText(product?.displayName, 300);

    return {
      key: index + 1,
      productname: productname || variantCode,
      displayName: displayName || productname || variantCode,
      variantCode: variantCode || productname,
      producQuanity: safePositiveNumber(product?.quantity ?? product?.producQuanity, 1),
      price: safePositiveNumber(product?.price, 0),
      packSize: safePositiveNumber(product?.packSize, 1),
      isPriority: !!(product?.priority || product?.isPriority),
      productNote: safeText(product?.productNote, 500),
    };
  });
}

function buildDraftOrderNote(orderNote: unknown, adminNote: string) {
  const existingNote = safeText(orderNote, 1500);
  const rejectionNote = adminNote || DEFAULT_REJECTION_NOTE;
  return [
    existingNote,
    "--- ADMIN REJECTION NOTE ---",
    rejectionNote,
    "Please update your cart and resubmit.",
  ].filter(Boolean).join("\n\n");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const oid = toObjectId(id);
  if (!oid) return NextResponse.json({ success: false, message: "Invalid id" }, { status: 400 });

  try {
    const db = await getDb();
    const doc = await db.collection("custom_discount_requests").findOne({ _id: oid });
    if (!doc) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    const actorRole = String(req.headers.get("x-omsons-actor-role") ?? "").trim().toLowerCase();
    if (actorRole === "dealer") {
      const actorId = String(req.headers.get("x-omsons-actor-id") ?? "").trim();
      const ownerId = String(doc.dealerId ?? doc.dealer_id ?? "").trim();
      if (!actorId) return NextResponse.json({ success: false, message: "Missing Dealer identity" }, { status: 401 });
      if (!ownerId || actorId !== ownerId) {
        return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
      }
    }
    const linkedOrderId = safeText(doc.orderId || doc.order_id, 120);
    if (linkedOrderId) {
      const access = await resolveOrderAccess(linkedOrderId, doc.dealerId);
      if (!access.visible) return NextResponse.json({ success: false, message: access.reason }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: toDoc(doc) });
  } catch (e: any) {
    console.error("[GET /api/custom-discount-requests/[id]]", e);
    const status = isMongoDependencyError(e) ? 503 : 500;
    return NextResponse.json({
      success: false,
      message: status === 503 ? "Custom discount database is currently unavailable" : "Failed to load custom discount request",
    }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const oid = toObjectId(id);
  if (!oid) return NextResponse.json({ success: false, message: "Invalid id" }, { status: 400 });

  try {
    const body = await req.json();
    const status = safeText(body.status, 40);
    const orderId = safeText(body.orderId || body.order_id, 120);
    const orderNumber = safeText(body.orderNumber || body.order_number, 160);
    const hasOrderLinkUpdate = !!orderId || !!orderNumber;
    const isToggleOnly = status === "" && typeof body.allowReorder === "boolean" && !hasOrderLinkUpdate;
    const isOrderLinkOnly = status === "" && hasOrderLinkUpdate && typeof body.allowReorder !== "boolean";

    if (!isToggleOnly && !isOrderLinkOnly && !["approved", "rejected", "pending"].includes(status)) {
      return NextResponse.json({ success: false, message: "Invalid status" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const set: Record<string, any> = isToggleOnly || isOrderLinkOnly
      ? {
        updatedAt: now,
      }
      : {
        status,
        adminNote: safeText(body.adminNote ?? body.admin_note, 1500),
        reviewedBy: safeText(body.reviewedBy, 160),
        reviewedAt: status === "pending" ? null : now,
        updatedAt: now,
      };

    if (isToggleOnly) {
      set.allowReorder = body.allowReorder;
    }

    if (hasOrderLinkUpdate) {
      if (orderId) {
        set.orderId = orderId;
        set.order_id = orderId;
      }
      if (orderNumber) {
        set.orderNumber = orderNumber;
        set.order_number = orderNumber;
      }
      set.linkedOrderAt = now;
    }

    if (!isToggleOnly && !isOrderLinkOnly) {
      if (status === "approved") {
        set.allowReorder = true;
      } else if (status === "rejected") {
        set.allowReorder = false;
      } else if (typeof body.allowReorder === "boolean") {
        set.allowReorder = body.allowReorder;
      }
    }

    const db = await getDb();
    const existing = await db.collection("custom_discount_requests").findOne({ _id: oid });
    if (!existing) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    const existingOrderId = safeText(existing.orderId || existing.order_id, 120);
    if (existingOrderId) {
      const access = await resolveOrderAccess(existingOrderId, existing.dealerId);
      if (!access.visible) return NextResponse.json({ success: false, message: access.reason }, { status: 409 });
    }

    if (!isToggleOnly && status === "rejected" && !existing.rejectionDraftId) {
      const draftResult = await db.collection("order_drafts").insertOne({
        dealer_id: existing.dealerId,
        name: buildDraftName(now),
        rows: buildDraftRows(
          Array.isArray(existing.orderSnapshot?.products) && existing.orderSnapshot.products.length > 0
            ? existing.orderSnapshot.products
            : Array.isArray(existing.draftProducts) && existing.draftProducts.length > 0
              ? existing.draftProducts
              : existing.products
        ),
        shipto: existing.shipto ?? null,
        refno: existing.refno ?? null,
        order_note: buildDraftOrderNote(existing.orderSnapshot?.orderNote ?? existing.orderNote, set.adminNote),
        coupon_code: existing.discountBreakdown?.couponCode || null,
        coupon_pct: existing.discountBreakdown?.couponDiscountPercent ?? null,
        approval_state: buildDraftApprovalState({
          approvalRequestId: existing._id.toString(),
          status: "rejected",
          requestedOrderDiscountPercent: existing.requestedOrderDiscountPercent ?? null,
          requestedProductDiscounts: existing.requestedProductDiscounts ?? {},
          updatedAt: now,
        }),
        source: "custom_discount_rejection",
        source_request_id: existing._id.toString(),
        createdAt: now,
        updatedAt: now,
      });

      set.rejectionDraftId = draftResult.insertedId.toString();
      set.rejectionDraftCreatedAt = now;
    }

    const updated = await db.collection("custom_discount_requests").findOneAndUpdate(
      { _id: oid },
      { $set: set },
      { returnDocument: "after" }
    );

    if (!updated) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });

    const linkedDraftId = safeText(updated.orderDraftId || updated.order_draft_id, 120);
    const linkedDraftObjectId = toObjectId(linkedDraftId);
    if (linkedDraftObjectId) {
      await db.collection("order_drafts").updateOne(
        { _id: linkedDraftObjectId, dealer_id: updated.dealerId },
        {
          $set: {
            approval_state: buildDraftApprovalState({
              approvalRequestId: updated._id.toString(),
              status: status === "" ? updated.status : status,
              requestedOrderDiscountPercent: updated.requestedOrderDiscountPercent ?? null,
              requestedProductDiscounts: updated.requestedProductDiscounts ?? {},
              updatedAt: now,
            }),
            updatedAt: now,
          },
        }
      );
    }

    return NextResponse.json({ success: true, data: toDoc(updated) });
  } catch (e: any) {
    console.error("[PATCH /api/custom-discount-requests/[id]]", e);
    const status = isMongoDependencyError(e) ? 503 : 500;
    return NextResponse.json({
      success: false,
      message: status === 503 ? "Custom discount database is currently unavailable" : "Failed to update custom discount request",
    }, { status });
  }
}
