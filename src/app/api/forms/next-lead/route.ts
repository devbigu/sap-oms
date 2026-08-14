import { NextRequest, NextResponse } from "next/server";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const role = String(req.headers.get("x-omsons-actor-role") || "").trim().toLowerCase();
    if (role !== "staff" && role !== "admin") {
      return NextResponse.json({ success: false, message: "Form access denied" }, { status: 403 });
    }

    const db = await getDb();
    const counter = await db.collection<{ _id: string; seq: number }>("counters").findOne({ _id: "leadNo" });
    const nextSeq = Number(counter?.seq ?? 0) + 1;
    return NextResponse.json({ success: true, leadNo: `OML-${String(nextSeq).padStart(3, "0")}` });
  } catch (error) {
    console.error("[GET /api/forms/next-lead]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json(
      { success: false, message: status === 503 ? "Forms database is currently unavailable" : "Failed to load next lead number" },
      { status },
    );
  }
}
