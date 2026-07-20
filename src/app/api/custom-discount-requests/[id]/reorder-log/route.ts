import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { resolveOrderAccess } from "@/lib/orderAccess";

function toObjectId(id: string) {
  try { return new ObjectId(id); } catch { return null; }
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const oid = toObjectId(id);
  if (!oid) return NextResponse.json({ success: false, message: "Invalid id" }, { status: 400 });

  try {
    const body = await req.json();
    const dealerId = safeText(body.dealerId || body.dealer_id, 80);
    const orderId = safeText(body.orderId || body.order_id, 120);

    if (!dealerId) {
      return NextResponse.json({ success: false, message: "dealerId is required" }, { status: 400 });
    }
    if (!orderId) {
      return NextResponse.json({ success: false, message: "orderId is required" }, { status: 400 });
    }

    const db = await getDb();
    const existing = await db.collection("custom_discount_requests").findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    }
    if (String(existing.dealerId) !== dealerId) {
      return NextResponse.json({ success: false, message: "Request belongs to another dealer" }, { status: 403 });
    }
    const sourceOrderId = safeText(existing.orderId || existing.order_id, 120);
    if (sourceOrderId) {
      const access = await resolveOrderAccess(sourceOrderId, dealerId);
      if (!access.visible) return NextResponse.json({ success: false, message: access.reason }, { status: 409 });
    }

    const updated = await db.collection("custom_discount_requests").findOneAndUpdate(
      { _id: oid },
      {
        $inc: { reorderCount: 1 },
        $set: {
          lastReorderedAt: new Date().toISOString(),
          lastReorderedOrderId: orderId,
          updatedAt: new Date().toISOString(),
        },
      },
      { returnDocument: "after" }
    );

    return NextResponse.json({ success: true, data: toDoc(updated!) });
  } catch (e: any) {
    console.error("[POST /api/custom-discount-requests/[id]/reorder-log]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
