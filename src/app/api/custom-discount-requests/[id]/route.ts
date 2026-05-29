import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const oid = toObjectId(id);
  if (!oid) return NextResponse.json({ success: false, message: "Invalid id" }, { status: 400 });

  try {
    const db = await getDb();
    const doc = await db.collection("custom_discount_requests").findOne({ _id: oid });
    if (!doc) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: toDoc(doc) });
  } catch (e: any) {
    console.error("[GET /api/custom-discount-requests/[id]]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
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
    if (!["approved", "rejected", "pending"].includes(status)) {
      return NextResponse.json({ success: false, message: "Invalid status" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const set: Record<string, any> = {
      status,
      adminNote: safeText(body.adminNote ?? body.admin_note, 1500),
      reviewedBy: safeText(body.reviewedBy, 160),
      reviewedAt: status === "pending" ? null : now,
      updatedAt: now,
    };

    const db = await getDb();
    const updated = await db.collection("custom_discount_requests").findOneAndUpdate(
      { _id: oid },
      { $set: set },
      { returnDocument: "after" }
    );

    if (!updated) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: toDoc(updated) });
  } catch (e: any) {
    console.error("[PATCH /api/custom-discount-requests/[id]]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
