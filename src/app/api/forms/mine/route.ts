import { NextRequest, NextResponse } from "next/server";
import { isMongoDependencyError } from "@/lib/mongodb";
import { actor, listForms } from "@/app/api/forms/route";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const current = actor(req);
    if (current.role !== "staff" || !current.id) {
      return NextResponse.json({ success: false, message: "Only staff can view their forms" }, { status: 403 });
    }
    return await listForms(req, current.id);
  } catch (error) {
    console.error("[GET /api/forms/mine]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json({ success: false, message: status === 503 ? "Forms database is currently unavailable" : "Failed to load form submissions" }, { status });
  }
}
