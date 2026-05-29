import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

function clampPercent(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

function safeText(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toDoc(doc: any) {
  return {
    ...doc,
    id: doc._id.toString(),
    _id: undefined,
  };
}

export async function GET(req: NextRequest) {
  try {
    const dealerId = req.nextUrl.searchParams.get("dealer_id");
    const status = req.nextUrl.searchParams.get("status");
    const limitParam = Number(req.nextUrl.searchParams.get("limit") || 100);
    const limit = Number.isFinite(limitParam) ? Math.min(200, Math.max(1, limitParam)) : 100;

    const query: Record<string, any> = {};
    if (dealerId) query.dealerId = dealerId;
    if (status) query.status = status;

    const db = await getDb();
    const docs = await db
      .collection("custom_discount_requests")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ success: true, data: docs.map(toDoc) });
  } catch (e: any) {
    console.error("[GET /api/custom-discount-requests]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
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
    const doc = {
      dealerId,
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
      shipto: safeText(body.shipto, 1000),
      refno: safeText(body.refno, 120),
      orderNote: safeText(body.orderNote, 1500),
      orderSignature: safeText(body.orderSignature, 400),
      discountBreakdown: body.discountBreakdown && typeof body.discountBreakdown === "object"
        ? body.discountBreakdown
        : {},
      products: Array.isArray(body.products) ? body.products.slice(0, 100) : [],
      status: "pending",
      adminNote: "",
      reviewedBy: "",
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection("custom_discount_requests").insertOne(doc);
    const created = await db.collection("custom_discount_requests").findOne({ _id: result.insertedId });

    return NextResponse.json({ success: true, data: toDoc(created!) }, { status: 201 });
  } catch (e: any) {
    console.error("[POST /api/custom-discount-requests]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
