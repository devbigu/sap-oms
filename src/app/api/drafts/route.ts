import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

const dealerDraftQuery = (dealerId: string) => ({ dealer_id: dealerId });

function toDoc(doc: any): object {
  return {
    ...doc,
    id:         doc._id.toString(),
    _id:        undefined,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

// GET /api/drafts?dealer_id=<id>  — list all drafts (newest first)
// GET /api/drafts?dealer_id=<id>&count=1  — just the count
export async function GET(req: NextRequest) {
  const dealerId = req.nextUrl.searchParams.get("dealer_id");
  if (!dealerId)
    return NextResponse.json({ success: false, message: "dealer_id required" }, { status: 400 });

  try {
    const db = await getDb();

    if (req.nextUrl.searchParams.get("count") === "1") {
      const count = await db.collection("order_drafts").countDocuments(dealerDraftQuery(dealerId));
      return NextResponse.json({ success: true, count });
    }

    const docs = await db
      .collection("order_drafts")
      .find(dealerDraftQuery(dealerId))
      .sort({ updatedAt: -1 })
      .toArray();

    return NextResponse.json({ success: true, data: docs.map(toDoc) });
  } catch (e: any) {
    console.error("[GET /api/drafts]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

// POST /api/drafts  — create a new named draft
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dealer_id, name, rows, shipto, refno, order_note, coupon_code, coupon_pct, approval_state } = body;

    if (!dealer_id || !name || !Array.isArray(rows))
      return NextResponse.json(
        { success: false, message: "dealer_id, name, and rows are required" },
        { status: 400 }
      );

    const now = new Date().toISOString();
    const db  = await getDb();

    const result = await db.collection("order_drafts").insertOne({
      dealer_id,
      name,
      rows,
      shipto:      shipto      ?? null,
      refno:       refno       ?? null,
      order_note:  order_note  ?? null,
      coupon_code: coupon_code ?? null,
      coupon_pct:  coupon_pct  ?? null,
      approval_state: approval_state ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await db.collection("order_drafts").findOne({ _id: result.insertedId });
    return NextResponse.json({ success: true, data: toDoc(created!) }, { status: 201 });
  } catch (e: any) {
    console.error("[POST /api/drafts]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
