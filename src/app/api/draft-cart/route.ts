import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(req: NextRequest) {
  const dealerId = req.nextUrl.searchParams.get("dealer_id");
  if (!dealerId)
    return NextResponse.json({ success: false, message: "dealer_id required" }, { status: 400 });

  try {
    const db    = await getDb();
    const draft = await db.collection("draftcarts").findOne({ dealer_id: dealerId });
    if (!draft) return NextResponse.json({ success: true, data: null });
    return NextResponse.json({ success: true, data: { ...draft, _id: draft._id.toString() } });
  } catch (e: any) {
    console.error("[GET /api/draft-cart]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { dealer_id, items } = await req.json();
    if (!dealer_id || !Array.isArray(items))
      return NextResponse.json(
        { success: false, message: "dealer_id and items array required" },
        { status: 400 }
      );

    const db  = await getDb();
    const now = new Date().toISOString();
    await db.collection("draftcarts").updateOne(
      { dealer_id },
      { $set: { dealer_id, items, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[POST /api/draft-cart]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const dealerId = req.nextUrl.searchParams.get("dealer_id");
  if (!dealerId)
    return NextResponse.json({ success: false, message: "dealer_id required" }, { status: 400 });

  try {
    const db = await getDb();
    await db.collection("draftcarts").deleteOne({ dealer_id: dealerId });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[DELETE /api/draft-cart]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
