import { createHmac, scryptSync, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getDefaultRouteForSession, setSessionCookie } from "@/lib/auth/server";
import { buildAccountantSession, toPublicSession } from "@/lib/auth/session";
import { getDb } from "@/lib/mongodb";

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    const hashBuffer = Buffer.from(hash, "hex");
    const derived = scryptSync(password, salt, 64);
    return timingSafeEqual(hashBuffer, derived);
  } catch {
    return false;
  }
}

function createJWT(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

const DEMO = {
  _id: "demo000000000000000000000",
  name: "Demo Accountant",
  email: "demo@omsons.com",
  password: "demo1234",
  phone: "+91 00000 00000",
  role: "accountant",
};

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail || !password) {
      return NextResponse.json({ success: false, message: "Email and password are required" }, { status: 400 });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("[POST /api/auth/accountant] Missing JWT_SECRET");
      return NextResponse.json({ success: false, message: "Authentication is not configured" }, { status: 500 });
    }

    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const allowDemo = process.env.ALLOW_DEMO_ACCOUNTANT === "true";

    if (allowDemo && normalizedEmail === DEMO.email && password === DEMO.password) {
      const token = createJWT({ sub: DEMO._id, email: DEMO.email, role: "accountant", exp }, secret);
      const session = buildAccountantSession(DEMO);
      if (!session) {
        return NextResponse.json({ success: false, message: "Demo accountant is not configured" }, { status: 500 });
      }

      const response = NextResponse.json({
        success: true,
        token,
        data: { _id: DEMO._id, name: DEMO.name, email: DEMO.email, phone: DEMO.phone, role: DEMO.role },
        session: toPublicSession(session),
        redirectTo: getDefaultRouteForSession(session),
      });
      return setSessionCookie(response, session);
    }

    const db = await getDb();
    const accountant = await db.collection("accountants").findOne({ email: normalizedEmail });

    if (!accountant || !verifyPassword(password, accountant.password as string)) {
      return NextResponse.json({ success: false, message: "Invalid email or password" }, { status: 401 });
    }

    const token = createJWT(
      { sub: accountant._id.toString(), email: accountant.email, role: "accountant", exp },
      secret,
    );

    const session = buildAccountantSession({
      _id: accountant._id.toString(),
      name: accountant.name,
      email: accountant.email,
      phone: accountant.phone,
    });

    if (!session) {
      return NextResponse.json({ success: false, message: "Accountant session could not be created" }, { status: 500 });
    }

    const response = NextResponse.json({
      success: true,
      token,
      data: {
        _id: accountant._id.toString(),
        name: accountant.name,
        email: accountant.email,
        phone: accountant.phone,
        role: accountant.role ?? "accountant",
      },
      session: toPublicSession(session),
      redirectTo: getDefaultRouteForSession(session),
    });
    return setSessionCookie(response, session);
  } catch (e: any) {
    console.error("[POST /api/auth/accountant]", e);
    if (e?.name === "MongoServerSelectionError") {
      return NextResponse.json(
        { success: false, message: "Unable to connect to the accountant database" },
        { status: 503 },
      );
    }

    return NextResponse.json({ success: false, message: e.message || "Login failed" }, { status: 500 });
  }
}
