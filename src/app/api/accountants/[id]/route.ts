import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/server";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { scryptSync, randomBytes } from "crypto";

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function toObjectId(id: string) {
  try { return new ObjectId(id); } catch { return null; }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = requireApiSession(req, {
      roles: ["admin", "accountant"],
      unauthenticatedMessage: "Authentication required to view accountant details",
      unauthorizedMessage: "You are not allowed to view this accountant record",
    });
    if (session instanceof NextResponse) return session;
    if (session.role === "accountant" && session.accountantId !== id) {
      return NextResponse.json({ success: false, message: "You are not allowed to view this accountant record" }, { status: 403 });
    }

    const oid    = toObjectId(id);
    if (!oid) return NextResponse.json({ success: false, message: "Invalid id" }, { status: 400 });

    const db          = await getDb();
    const doc         = await db
      .collection("accountants")
      .findOne({ _id: oid }, { projection: { password: 0 } });

    if (!doc) return NextResponse.json({ success: false, message: "Not found" }, { status: 404 });

    return NextResponse.json({ success: true, data: { ...doc, _id: doc._id.toString() } });
  } catch (e: any) {
    console.error("[GET /api/accountants/[id]]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = requireApiSession(req, {
      roles: ["admin"],
      unauthenticatedMessage: "Authentication required to update accountants",
      unauthorizedMessage: "Only admin users can update accountants",
    });
    if (session instanceof NextResponse) return session;

    const { id } = await params;
    const oid    = toObjectId(id);
    if (!oid) return NextResponse.json({ success: false, message: "Invalid id" }, { status: 400 });

    const body                       = await req.json();
    const update: Record<string, string> = {};
    if (body.name?.trim())     update.name     = body.name.trim();
    if (body.email?.trim())    update.email    = body.email.trim().toLowerCase();
    if (body.phone?.trim())    update.phone    = body.phone.trim();
    if (body.password)         update.password = hashPassword(body.password);

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: false, message: "Nothing to update" }, { status: 400 });
    }

    const db = await getDb();
    const result = await db
      .collection("accountants")
      .updateOne({ _id: oid }, { $set: update });

    if (result.matchedCount === 0) {
      return NextResponse.json({ success: false, message: "Accountant not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[PUT /api/accountants/[id]]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = requireApiSession(req, {
      roles: ["admin"],
      unauthenticatedMessage: "Authentication required to delete accountants",
      unauthorizedMessage: "Only admin users can delete accountants",
    });
    if (session instanceof NextResponse) return session;

    const { id } = await params;
    const oid    = toObjectId(id);
    if (!oid) return NextResponse.json({ success: false, message: "Invalid id" }, { status: 400 });

    const db     = await getDb();
    const result = await db.collection("accountants").deleteOne({ _id: oid });

    if (result.deletedCount === 0) {
      return NextResponse.json({ success: false, message: "Accountant not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[DELETE /api/accountants/[id]]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
