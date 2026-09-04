import { NextRequest, NextResponse } from "next/server";
import { findOrderMirror, verifyOrderAgainstMirror } from "@/lib/orderMirror.server";
import { parsePhpJsonResponse } from "@/lib/phpJson";

export const runtime = "nodejs";
const PHP_BASE = "https://mirisoft.co.in/sas/dealerapi/api";

export async function GET(request: NextRequest) {
  const orderId = String(request.nextUrl.searchParams.get("orderId") ?? "").trim();
  if (!orderId) return NextResponse.json({ success: false, message: "orderId is required" }, { status: 400 });

  try {
    const mirror = await findOrderMirror(orderId);
    if (!mirror) return NextResponse.json({ success: true, mirrored: false, verification: null });

    const response = await fetch(`${PHP_BASE}/orderdatalist?id=${encodeURIComponent(orderId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return NextResponse.json({ success: true, mirrored: true, verification: null, snapshot: mirror.snapshot });
    }

    const verification = verifyOrderAgainstMirror(mirror, await parsePhpJsonResponse(response), orderId);
    return NextResponse.json({ success: true, mirrored: true, verification, snapshot: mirror.snapshot });
  } catch (error) {
    console.error("order-mirror GET failed", error);
    return NextResponse.json({ success: false, message: "Unable to verify order." }, { status: 500 });
  }
}
