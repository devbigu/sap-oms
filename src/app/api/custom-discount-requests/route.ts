import { NextRequest, NextResponse } from "next/server";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";

export const runtime = "nodejs";

function clampPercent(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

function safeText(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
    const status = req.nextUrl.searchParams.get("status");
    const orderId = req.nextUrl.searchParams.get("order_id") || req.nextUrl.searchParams.get("orderId");
    const orderNumber = req.nextUrl.searchParams.get("order_number") || req.nextUrl.searchParams.get("orderNumber");
    const reorderable = req.nextUrl.searchParams.get("reorderable");
    const limitParam = Number(req.nextUrl.searchParams.get("limit") || 100);
    const limit = Number.isFinite(limitParam) ? Math.min(500, Math.max(1, limitParam)) : 100;

    const query: Record<string, string | boolean> = {};
    if (dealerId) query.dealerId = dealerId;
    if (staffId) query.staffId = staffId;
    if (status) query.status = status;
    if (orderId) {
      query.orderId = orderId;
    } else if (orderNumber) {
      query.orderNumber = orderNumber;
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

    return NextResponse.json({ success: true, data: docs.map(toDoc) });
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
    const requestedDiscountPercent = clampPercent(body.requestedDiscountPercent);
    const currentDiscountPercent = clampPercent(body.currentDiscountPercent);

    if (!dealerId) {
      return NextResponse.json({ success: false, message: "dealerId is required" }, { status: 400 });
    }
    if (!Number.isFinite(requestedDiscountPercent)) {
      return NextResponse.json({ success: false, message: "requestedDiscountPercent is required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const db = await getDb();
    const discountScope = body.discountScope === "product" ? "product" : "order";
    const doc = {
      dealerId,
      staffId: safeText(body.staffId || body.staff_id, 80),
      dealerName: safeText(body.dealerName, 200),
      dealerCode: safeText(body.dealerCode, 80),
      dealerEmail: safeText(body.dealerEmail, 160),
      dealerPhone: safeText(body.dealerPhone, 80),
      requestedDiscountPercent,
      currentDiscountPercent: Number.isFinite(currentDiscountPercent) ? currentDiscountPercent : 0,
      subtotal: Number(body.subtotal || 0),
      currentDiscountAmount: Number(body.currentDiscountAmount || 0),
      requestedDiscountAmount: Number(body.requestedDiscountAmount || 0),
      currentFinalPayable: Number(body.currentFinalPayable || 0),
      requestedFinalPayable: Number(body.requestedFinalPayable || 0),
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
      products: Array.isArray(body.products) ? body.products.slice(0, 100) : [],
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
