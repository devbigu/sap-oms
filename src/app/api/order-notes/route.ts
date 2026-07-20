import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { filterExistingOrderIds, resolveOrderAccess } from "@/lib/orderAccess";

function safeText(value: unknown, max = 1200) {
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
    const orderId = req.nextUrl.searchParams.get("order_id");
    const orderIds = req.nextUrl.searchParams.get("order_ids");
    if (!orderId && !orderIds) {
      return NextResponse.json({ success: false, message: "order_id or order_ids required" }, { status: 400 });
    }

    const requestedIds = orderIds
      ? orderIds.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 200)
      : orderId ? [orderId] : [];
    const visibleIds = await filterExistingOrderIds(requestedIds, dealerId);
    if (requestedIds.length > 0 && visibleIds.size === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const query: Record<string, any> = {};
    if (dealerId) query.dealerId = dealerId;
    if (orderId) query.orderId = orderId;
    if (orderIds) {
      query.orderId = { $in: Array.from(visibleIds) };
    }

    const db = await getDb();
    const docs = await db
      .collection("order_notes")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    return NextResponse.json({ success: true, data: docs.map(toDoc) });
  } catch (e: any) {
    console.error("[GET /api/order-notes]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orderId = safeText(body.orderId || body.order_id, 80);
    const dealerId = safeText(body.dealerId || body.dealer_id, 80);
    const note = safeText(body.note);

    if (!orderId || !dealerId || !note) {
      return NextResponse.json({ success: false, message: "orderId, dealerId, and note are required" }, { status: 400 });
    }
    const access = await resolveOrderAccess(orderId, dealerId);
    if (!access.visible) return NextResponse.json({ success: false, message: access.reason }, { status: 404 });

    const now = new Date().toISOString();
    const db = await getDb();
    await db.collection("order_notes").updateOne(
      { orderId, dealerId },
      {
        $set: {
          note,
          dealerName: safeText(body.dealerName, 200),
          updatedAt: now,
        },
        $setOnInsert: { orderId, dealerId, createdAt: now },
      },
      { upsert: true }
    );

    const doc = await db.collection("order_notes").findOne({ orderId, dealerId });
    return NextResponse.json({ success: true, data: toDoc(doc!) }, { status: 201 });
  } catch (e: any) {
    console.error("[POST /api/order-notes]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
