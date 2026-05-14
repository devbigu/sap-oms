import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { scryptSync, timingSafeEqual, createHmac } from "crypto";

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    const hashBuffer = Buffer.from(hash, "hex");
    const derived    = scryptSync(password, salt, 64);
    return timingSafeEqual(hashBuffer, derived);
  } catch {
    return false;
  }
}

function createJWT(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body   = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig    = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

const DEMO = {
  _id:      "demo000000000000000000000",
  name:     "Demo Accountant",
  email:    "demo@omsons.com",
  password: "demo1234",
  phone:    "+91 00000 00000",
  role:     "accountant",
};

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ success: false, message: "Email and password are required" }, { status: 400 });
    }

    const secret = process.env.JWT_SECRET!;
    const exp    = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

    // Demo account — no DB needed
    if (email === DEMO.email && password === DEMO.password) {
      const token = createJWT({ sub: DEMO._id, email: DEMO.email, role: "accountant", exp }, secret);
      return NextResponse.json({
        success: true,
        token,
        data: { _id: DEMO._id, name: DEMO.name, email: DEMO.email, phone: DEMO.phone, role: DEMO.role },
      });
    }

    const db         = await getDb();
    const accountant = await db.collection("accountants").findOne({ email });

    if (!accountant || !verifyPassword(password, accountant.password as string)) {
      return NextResponse.json({ success: false, message: "Invalid email or password" }, { status: 401 });
    }

    const token = createJWT(
      { sub: accountant._id.toString(), email: accountant.email, role: "accountant", exp },
      secret,
    );

    return NextResponse.json({
      success: true,
      token,
      data: {
        _id:   accountant._id,
        name:  accountant.name,
        email: accountant.email,
        phone: accountant.phone,
        role:  accountant.role ?? "accountant",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
