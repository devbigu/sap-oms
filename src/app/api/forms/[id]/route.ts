import { NextRequest, NextResponse } from "next/server";
import { isMongoDependencyError } from "@/lib/mongodb";
import { formSubmissionCollection, objectIdFromString, serializeFormSubmission } from "@/lib/formSubmissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const role = String(req.headers.get("x-omsons-actor-role") || "").trim().toLowerCase();
    if (role !== "admin") {
      return NextResponse.json({ success: false, message: "Only admin can view form submissions" }, { status: 403 });
    }

    const { id } = await params;
    const objectId = objectIdFromString(id);
    if (!objectId) {
      return NextResponse.json({ success: false, message: "Invalid submission id" }, { status: 400 });
    }

    const collection = await formSubmissionCollection();
    const doc = await collection.findOne({ _id: objectId });
    if (!doc) {
      return NextResponse.json({ success: false, message: "Form submission not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: serializeFormSubmission(doc) });
  } catch (error) {
    console.error("[GET /api/forms/:id]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json(
      { success: false, message: status === 503 ? "Forms database is currently unavailable" : "Failed to load form submission" },
      { status },
    );
  }
}
