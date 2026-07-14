import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ success: true });
  return clearSessionCookie(response);
}
