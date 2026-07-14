import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/server";
import { getDb } from "@/lib/mongodb";
import { scryptSync, randomBytes } from "crypto";

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export async function GET(req: NextRequest) {
  try {
    const session = requireApiSession(req, {
      roles: ["admin"],
      unauthenticatedMessage: "Authentication required to list accountants",
      unauthorizedMessage: "Only admin users can list accountants",
    });
    if (session instanceof NextResponse) return session;

    const db   = await getDb();
    const docs  = await db
      .collection("accountants")
      .find({}, { projection: { password: 0 } })
      .toArray();

    const accountants = docs.map(d => ({ ...d, _id: d._id.toString() }));
    return NextResponse.json({ success: true, data: accountants });
  } catch (e: any) {
    console.error("[GET /api/accountants]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = requireApiSession(req, {
      roles: ["admin"],
      unauthenticatedMessage: "Authentication required to create accountants",
      unauthorizedMessage: "Only admin users can create accountants",
    });
    if (session instanceof NextResponse) return session;

    const { name, email, password, phone } = await req.json();

    if (!name?.trim() || !email?.trim() || !password || !phone?.trim()) {
      return NextResponse.json({ success: false, message: "All fields are required" }, { status: 400 });
    }

    const db       = await getDb();
    const existing = await db.collection("accountants").findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return NextResponse.json({ success: false, message: "Email already registered" }, { status: 409 });
    }

    const result = await db.collection("accountants").insertOne({
      name:      name.trim(),
      email:     email.trim().toLowerCase(),
      password:  hashPassword(password),
      phone:     phone.trim(),
      role:      "accountant",
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      data: {
        _id:       result.insertedId.toString(),
        name:      name.trim(),
        email:     email.trim().toLowerCase(),
        phone:     phone.trim(),
        role:      "accountant",
        createdAt: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    console.error("[POST /api/accountants]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
