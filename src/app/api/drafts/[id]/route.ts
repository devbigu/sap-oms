import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { ACTIVE_ORDER_CUTOFF_DATE } from "@/lib/activeOrderPeriod.js";

function toObjectId(id: string) {
  try { return new ObjectId(id); } catch { return null; }
}

function toDoc(doc: any): object {
  return {
    ...doc,
    id:         doc._id.toString(),
    _id:        undefined,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

// GET /api/drafts/[id]?dealer_id=<id>
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id }   = await params;
  const dealerId = req.nextUrl.searchParams.get("dealer_id");
  const oid      = toObjectId(id);

  if (!oid || !dealerId)
    return NextResponse.json({ success: false, message: "Invalid id or missing dealer_id" }, { status: 400 });

  try {
    const db  = await getDb();
    const doc = await db.collection("order_drafts").findOne({ _id: oid, dealer_id: dealerId, createdAt: { $gte: ACTIVE_ORDER_CUTOFF_DATE } });
    if (!doc) return NextResponse.json({ success: false, message: "Draft not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: toDoc(doc) });
  } catch (e: any) {
    console.error("[GET /api/drafts/[id]]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

// PUT /api/drafts/[id]  — update fields (dealer_id in body for ownership check)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const oid    = toObjectId(id);
  if (!oid)
    return NextResponse.json({ success: false, message: "Invalid id" }, { status: 400 });

  try {
    const body = await req.json();
    const { dealer_id, name, rows, shipto, refno, order_note, coupon_code, coupon_pct, approval_state, source, source_request_id } = body;

    if (!dealer_id)
      return NextResponse.json({ success: false, message: "dealer_id required" }, { status: 400 });

    const set: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (name        !== undefined) set.name        = name;
    if (rows        !== undefined) set.rows        = rows;
    if (shipto      !== undefined) set.shipto      = shipto;
    if (refno       !== undefined) set.refno       = refno;
    if (order_note  !== undefined) set.order_note  = order_note;
    if (coupon_code !== undefined) set.coupon_code = coupon_code;
    if (coupon_pct  !== undefined) set.coupon_pct  = coupon_pct;
    if (approval_state !== undefined) set.approval_state = approval_state;
    if (source !== undefined) set.source = source;
    if (source_request_id !== undefined) set.source_request_id = source_request_id;

    const db     = await getDb();
    const result = await db
      .collection("order_drafts")
      .findOneAndUpdate(
        { _id: oid, dealer_id, createdAt: { $gte: ACTIVE_ORDER_CUTOFF_DATE } },
        { $set: set },
        { returnDocument: "after" }
      );

    if (!result)
      return NextResponse.json({ success: false, message: "Draft not found" }, { status: 404 });

    return NextResponse.json({ success: true, data: toDoc(result) });
  } catch (e: any) {
    console.error("[PUT /api/drafts/[id]]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

// DELETE /api/drafts/[id]?dealer_id=<id>
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id }   = await params;
  const dealerId = req.nextUrl.searchParams.get("dealer_id");
  const oid      = toObjectId(id);

  if (!oid || !dealerId)
    return NextResponse.json({ success: false, message: "Invalid id or missing dealer_id" }, { status: 400 });

  try {
    const db     = await getDb();
    const result = await db.collection("order_drafts").deleteOne({ _id: oid, dealer_id: dealerId, createdAt: { $gte: ACTIVE_ORDER_CUTOFF_DATE } });
    if (result.deletedCount === 0)
      return NextResponse.json({ success: false, message: "Draft not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[DELETE /api/drafts/[id]]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
