import { NextRequest, NextResponse } from "next/server";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { ACTIVE_ORDER_CUTOFF_DATE, filterActiveOrderSnapshots } from "@/lib/activeOrderPeriod.js";
import { resolveActiveOrder } from "@/lib/activeOrderAccess";
import {
  buildDraftApprovalState,
  buildOrderApprovalSnapshot,
  buildPendingRequestLookup,
  normalizeCustomDiscountScope,
} from "@/lib/customDiscountRequests";

export const runtime = "nodejs";

function clampPercent(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

function safeText(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toObjectId(id: string) {
  try { return new ObjectId(id); } catch { return null; }
}

function toDoc<T extends { _id: { toString(): string } }>(doc: T) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    id: _id.toString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const dealerId = req.nextUrl.searchParams.get("dealer_id");
    const staffId = req.nextUrl.searchParams.get("staff_id");
    const assignedStaffId = req.nextUrl.searchParams.get("assignedStaffId") || req.nextUrl.searchParams.get("assigned_staff_id");
    const status = req.nextUrl.searchParams.get("status");
    const orderId = req.nextUrl.searchParams.get("order_id") || req.nextUrl.searchParams.get("orderId");
    const orderNumber = req.nextUrl.searchParams.get("order_number") || req.nextUrl.searchParams.get("orderNumber");
    const orderDraftId = req.nextUrl.searchParams.get("order_draft_id") || req.nextUrl.searchParams.get("orderDraftId");
    const reorderable = req.nextUrl.searchParams.get("reorderable");
    const limitParam = Number(req.nextUrl.searchParams.get("limit") || 100);
    const limit = Number.isFinite(limitParam) ? Math.min(500, Math.max(1, limitParam)) : 100;

    const query: Record<string, unknown> = { createdAt: { $gte: ACTIVE_ORDER_CUTOFF_DATE } };
    if (dealerId) query.dealerId = dealerId;
    if (staffId || assignedStaffId) {
      const normalizedStaffId = staffId || assignedStaffId || "";
      query.$or = [{ staffId: normalizedStaffId }, { assignedStaffId: normalizedStaffId }];
    }
    if (status) query.status = status;
    if (orderId) {
      query.orderId = orderId;
    } else if (orderNumber) {
      query.orderNumber = orderNumber;
    }
    if (orderDraftId) {
      query.orderDraftId = orderDraftId;
    }
    if (reorderable === "true") {
      query.status = "approved";
      query.allowReorder = true;
    }

    const db = await getDb();
    const docs = await db
      .collection("custom_discount_requests")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const activeSnapshots = filterActiveOrderSnapshots(docs);
    const visibleDocs = (await Promise.all(activeSnapshots.map(async (doc) => {
      const linkedOrderId = safeText(doc.orderId || doc.order_id, 120);
      if (!linkedOrderId) return doc;
      const access = await resolveActiveOrder(linkedOrderId, doc.dealerId).catch(() => ({ visible: false }));
      return access.visible ? doc : null;
    }))).filter((doc): doc is NonNullable<typeof doc> => doc !== null);
    return NextResponse.json({ success: true, data: visibleDocs.map(toDoc) });
  } catch (error: unknown) {
    console.error("custom-discount-requests GET failed", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json(
      { success: false, message: status === 503 ? "Custom discount database is currently unavailable" : "Failed to load custom discount requests" },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dealerId = safeText(body.dealerId || body.dealer_id, 80);
    const orderDraftId = safeText(body.orderDraftId || body.order_draft_id, 120);
    const requestedDiscountPercent = clampPercent(body.requestedDiscountPercent);
    const currentDiscountPercent = clampPercent(body.currentDiscountPercent);
    const discountScope = normalizeCustomDiscountScope(body.discountScope);
    const requestedOrderDiscountPercent = discountScope === "order" ? requestedDiscountPercent : null;
    const requestedProductDiscounts = body.requestedProductDiscounts && typeof body.requestedProductDiscounts === "object"
      ? body.requestedProductDiscounts as Record<string, number>
      : {};

    if (!dealerId) {
      return NextResponse.json({ success: false, message: "dealerId is required" }, { status: 400 });
    }
    if (!orderDraftId) {
      return NextResponse.json({ success: false, message: "orderDraftId is required" }, { status: 400 });
    }
    if (!Number.isFinite(requestedDiscountPercent) && discountScope === "order") {
      return NextResponse.json({ success: false, message: "requestedDiscountPercent is required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const db = await getDb();
    const orderSnapshot = buildOrderApprovalSnapshot({
      products: Array.isArray(body.orderSnapshot?.products)
        ? body.orderSnapshot.products
        : Array.isArray(body.products)
          ? body.products
          : [],
      orderNote: body.orderSnapshot?.orderNote ?? body.orderNote,
      baseDiscountPercent: Number.isFinite(currentDiscountPercent) ? currentDiscountPercent : 0,
      requestedOrderDiscountPercent,
      requestedProductDiscounts,
    });

    if (orderSnapshot.products.length === 0) {
      return NextResponse.json({ success: false, message: "At least one order product is required" }, { status: 400 });
    }

    const pendingLookup = buildPendingRequestLookup(dealerId, orderDraftId);
    const existingPending = await db.collection("custom_discount_requests").findOne(pendingLookup);
    if (existingPending) {
      return NextResponse.json({ success: true, data: toDoc(existingPending) });
    }

    const currentFinalPayable = Math.max(0, orderSnapshot.grossAmount - orderSnapshot.baseDiscountAmount);
    const doc = {
      dealerId,
      staffId: safeText(body.staffId || body.staff_id, 80),
      assignedStaffId: safeText(body.assignedStaffId || body.staffId || body.staff_id, 80),
      dealerName: safeText(body.dealerName, 200),
      dealerCode: safeText(body.dealerCode, 80),
      dealerEmail: safeText(body.dealerEmail, 160),
      dealerPhone: safeText(body.dealerPhone, 80),
      orderDraftId,
      order_draft_id: orderDraftId,
      requestedDiscountPercent: Number.isFinite(requestedDiscountPercent) ? requestedDiscountPercent : 0,
      currentDiscountPercent: Number.isFinite(currentDiscountPercent) ? currentDiscountPercent : 0,
      requestedOrderDiscountPercent,
      requestedProductDiscounts,
      subtotal: orderSnapshot.grossAmount,
      currentDiscountAmount: orderSnapshot.baseDiscountAmount,
      requestedDiscountAmount: orderSnapshot.requestedAdditionalDiscountAmount,
      currentFinalPayable,
      requestedFinalPayable: orderSnapshot.requestedNetPayableAmount,
      discountScope,
      targetProduct: discountScope === "product" && body.targetProduct && typeof body.targetProduct === "object"
        ? {
          productKey: safeText(body.targetProduct.productKey, 120),
          productname: safeText(body.targetProduct.productname, 200),
          displayName: safeText(body.targetProduct.displayName, 300),
          variantCode: safeText(body.targetProduct.variantCode, 160),
        }
        : null,
      shipto: safeText(body.shipto, 1000),
      refno: safeText(body.refno, 120),
      orderNote: safeText(body.orderNote, 1500),
      orderId: safeText(body.orderId || body.order_id, 120),
      order_id: safeText(body.orderId || body.order_id, 120),
      orderNumber: safeText(body.orderNumber || body.order_number, 160),
      order_number: safeText(body.orderNumber || body.order_number, 160),
      orderSignature: safeText(body.orderSignature, 400),
      discountBreakdown: body.discountBreakdown && typeof body.discountBreakdown === "object"
        ? body.discountBreakdown
        : {},
      orderSnapshot,
      products: orderSnapshot.products,
      draftProducts: Array.isArray(body.draftProducts) ? body.draftProducts.slice(0, 100) : [],
      status: "pending",
      allowReorder: false,
      reorderCount: 0,
      lastReorderedAt: null,
      lastReorderedOrderId: "",
      adminNote: "",
      reviewedBy: "",
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection("custom_discount_requests").insertOne(doc);
    const created = await db.collection("custom_discount_requests").findOne({ _id: result.insertedId });

    const draftObjectId = toObjectId(orderDraftId);
    if (draftObjectId) {
      await db.collection("order_drafts").updateOne(
        { _id: draftObjectId, dealer_id: dealerId },
        {
          $set: {
            approval_state: buildDraftApprovalState({
              approvalRequestId: result.insertedId.toString(),
              status: "pending",
              requestedOrderDiscountPercent,
              requestedProductDiscounts,
              updatedAt: now,
            }),
            updatedAt: now,
          },
        }
      );
    }

    return NextResponse.json({ success: true, data: toDoc(created!) }, { status: 201 });
  } catch (error: unknown) {
    console.error("[POST /api/custom-discount-requests]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json(
      { success: false, message: status === 503 ? "Custom discount database is currently unavailable" : "Failed to create custom discount request" },
      { status }
    );
  }
}
