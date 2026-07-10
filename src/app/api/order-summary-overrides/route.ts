import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getReadableAdditionalDiscountText } from "@/lib/orderAmounts";

function safeText(value: unknown, max = 1200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeAmount(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const amount = typeof value === "number"
    ? value
    : Number(String(value).replace(/,/g, "").trim());

  if (!Number.isFinite(amount)) return undefined;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function normalizeAdditionalDiscountType(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (["slab", "flat", "flat/slab"].includes(text)) return "slab" as const;
  if (["custom", "approved", "approved_custom"].includes(text)) return "custom" as const;
  return null;
}

function toDoc(doc: any) {
  return {
    ...doc,
    id: doc._id.toString(),
    _id: undefined,
  };
}

async function getCollection() {
  const db = await getDb();
  const collection = db.collection("order_summary_overrides");
  await collection.createIndex({ dealerId: 1, orderId: 1 }, { unique: true });
  await collection.createIndex({ dealerId: 1, orderIdNumber: -1 });
  return collection;
}

export async function GET(req: NextRequest) {
  try {
    const dealerId = req.nextUrl.searchParams.get("dealer_id");
    const orderId = req.nextUrl.searchParams.get("order_id");
    const orderIds = req.nextUrl.searchParams.get("order_ids");

    const query: Record<string, any> = {};
    if (dealerId) query.dealerId = dealerId;
    if (orderId) query.orderId = orderId;
    if (orderIds) {
      query.orderId = {
        $in: orderIds.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 200),
      };
    }

    const collection = await getCollection();
    const resultLimit = orderIds
      ? Math.min(query.orderId?.$in?.length || 200, 1000)
      : 200;

    const docs = await collection
      .find(query)
      .sort({ orderIdNumber: -1, createdAt: -1 })
      .limit(resultLimit)
      .toArray();

    return NextResponse.json({ success: true, data: docs.map(toDoc) });
  } catch (e: any) {
    console.error("[GET /api/order-summary-overrides]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orderId = safeText(body.orderId || body.order_id, 80);
    const dealerId = safeText(body.dealerId || body.dealer_id || body.order_dealer, 80);

    const grossAmount = safeAmount(body.grossAmount ?? body.gross_amount ?? body.order_amount);
    const discountAmount = safeAmount(body.discountAmount ?? body.discount_amount ?? body.order_discount_amount);
    const netPayableAmount = safeAmount(body.netPayableAmount ?? body.net_payable_amount ?? body.order_net_amount);
    const discountPercent = safeAmount(body.discountPercent ?? body.discount_percent) ?? 0;
    const allocatedDiscountPercent = safeAmount(body.allocatedDiscountPercent ?? body.allocated_discount_percent) ?? 0;
    const baseDiscountPercent = safeAmount(body.baseDiscountPercent ?? body.base_discount_percent);
    const baseDiscountAmount = safeAmount(body.baseDiscountAmount ?? body.base_discount_amount);
    const postBaseAmount = safeAmount(body.postBaseAmount ?? body.post_base_amount ?? body.amountBeforeSlab ?? body.amount_before_slab);
    const additionalDiscountType = normalizeAdditionalDiscountType(body.additionalDiscountType ?? body.additional_discount_type);
    const rawAdditionalDiscountAmount = safeAmount(body.additionalDiscountAmount ?? body.additional_discount_amount);
    const customDiscountAmount = safeAmount(body.customDiscountAmount ?? body.custom_discount_amount ?? body.approvedDiscountAmount ?? body.approved_discount_amount);
    const customDiscountPercent = safeAmount(body.customDiscountPercent ?? body.custom_discount_percent);
    const slabDiscountPercent = safeAmount(body.slabDiscountPercent ?? body.slab_discount_percent) ?? 0;
    const slabDiscountAmount = safeAmount(body.slabDiscountAmount ?? body.slab_discount_amount);
    const couponDiscountPercent = safeAmount(body.couponDiscountPercent ?? body.coupon_discount_percent) ?? 0;
    const approvedDiscountPercent = safeAmount(body.approvedDiscountPercent ?? body.approved_discount_percent);

    if (!orderId || !dealerId || grossAmount === undefined || discountAmount === undefined || netPayableAmount === undefined) {
      return NextResponse.json(
        { success: false, message: "orderId, dealerId, grossAmount, discountAmount, and netPayableAmount are required" },
        { status: 400 }
      );
    }

    const normalizedAdditionalType =
      additionalDiscountType
      ?? ((customDiscountAmount ?? 0) > 0 && (slabDiscountAmount ?? 0) <= 0 ? "custom" : null)
      ?? ((slabDiscountAmount ?? 0) > 0 && (customDiscountAmount ?? 0) <= 0 ? "slab" : null);

    const normalizedBaseDiscountAmount = safeAmount(baseDiscountAmount ?? (postBaseAmount !== undefined ? grossAmount - postBaseAmount : undefined));
    const normalizedPostBaseAmount = safeAmount(postBaseAmount ?? (normalizedBaseDiscountAmount !== undefined ? grossAmount - normalizedBaseDiscountAmount : undefined));
    const normalizedSlabDiscountAmount = normalizedAdditionalType === "slab"
      ? safeAmount(slabDiscountAmount ?? rawAdditionalDiscountAmount ?? (normalizedBaseDiscountAmount !== undefined ? discountAmount - normalizedBaseDiscountAmount : undefined)) ?? 0
      : 0;
    const normalizedCustomDiscountAmount = normalizedAdditionalType === "custom"
      ? safeAmount(customDiscountAmount ?? rawAdditionalDiscountAmount ?? (normalizedBaseDiscountAmount !== undefined ? discountAmount - normalizedBaseDiscountAmount : undefined)) ?? 0
      : 0;
    const additionalDiscountAmount = normalizedAdditionalType === "slab"
      ? normalizedSlabDiscountAmount
      : normalizedAdditionalType === "custom"
        ? normalizedCustomDiscountAmount
        : 0;

    const hasOverrideReason =
      slabDiscountPercent > 0 ||
      couponDiscountPercent > 0 ||
      approvedDiscountPercent !== undefined ||
      normalizedAdditionalType !== null ||
      discountPercent > allocatedDiscountPercent;

    if (!hasOverrideReason) {
      return NextResponse.json({ success: true, skipped: true, message: "No slab/coupon/approved discount override to save" });
    }

    const now = new Date().toISOString();
    const orderIdNumber = Number(orderId);
    const doc = {
      orderId,
      dealerId,
      orderIdNumber: Number.isFinite(orderIdNumber) ? orderIdNumber : 0,
      order_id: orderId,
      order_dealer: dealerId,
      Dealer_Name: safeText(body.dealerName || body.Dealer_Name, 200),
      order_amount: grossAmount,
      order_discount: netPayableAmount,
      order_discount_amount: discountAmount,
      order_net_amount: netPayableAmount,
      grossAmount,
      discountAmount,
      netPayableAmount,
      discountPercent,
      allocatedDiscountPercent,
      baseDiscountPercent,
      baseDiscountAmount: normalizedBaseDiscountAmount,
      postBaseAmount: normalizedPostBaseAmount,
      post_base_amount: normalizedPostBaseAmount,
      additionalDiscountType: normalizedAdditionalType,
      additional_discount_type: normalizedAdditionalType,
      additionalDiscountAmount,
      additional_discount_amount: additionalDiscountAmount,
      customDiscountAmount: normalizedCustomDiscountAmount,
      customDiscountPercent,
      slabDiscountPercent,
      slabDiscountAmount: normalizedSlabDiscountAmount,
      couponDiscountPercent,
      approvedDiscountPercent,
      reason: safeText(body.reason, 200) || getReadableAdditionalDiscountText({
        additionalDiscountType: normalizedAdditionalType,
        slabDiscountPercent,
        slabDiscountAmount: normalizedSlabDiscountAmount,
        customDiscountAmount: normalizedCustomDiscountAmount,
      }) || "frontend_discount_override",
      source: "frontend_order_summary_override",
      updatedAt: now,
    };

    const collection = await getCollection();
    await collection.updateOne(
      { orderId, dealerId },
      {
        $set: doc,
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    const saved = await collection.findOne({ orderId, dealerId });
    return NextResponse.json({ success: true, data: toDoc(saved!) }, { status: 201 });
  } catch (e: any) {
    console.error("[POST /api/order-summary-overrides]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
