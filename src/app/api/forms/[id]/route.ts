import { NextRequest, NextResponse } from "next/server";
import { isMongoDependencyError } from "@/lib/mongodb";
import {
  formSubmissionCollection,
  objectIdFromString,
  serializeFormSubmission,
  validateFormSubmissionBody,
} from "@/lib/formSubmissions";
import { actor } from "@/app/api/forms/route";

export const runtime = "nodejs";

function accessQuery(req: NextRequest, id: string) {
  const objectId = objectIdFromString(id);
  if (!objectId) return { error: NextResponse.json({ success: false, message: "Invalid submission id" }, { status: 400 }) };
  const current = actor(req);
  if (current.role === "admin") return { query: { _id: objectId } };
  if (current.role === "staff" && current.id) return { query: { _id: objectId, "submittedBy.userId": current.id } };
  return { error: NextResponse.json({ success: false, message: "Form access denied" }, { status: 403 }) };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = accessQuery(req, id);
    if (access.error) return access.error;
    const collection = await formSubmissionCollection();
    const doc = await collection.findOne(access.query);
    if (!doc) return NextResponse.json({ success: false, message: "Form submission not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: serializeFormSubmission(doc) });
  } catch (error) {
    console.error("[GET /api/forms/:id]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json({ success: false, message: status === 503 ? "Forms database is currently unavailable" : "Failed to load form submission" }, { status });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = accessQuery(req, id);
    if (access.error) return access.error;

    const data = validateFormSubmissionBody(await req.json());
    const collection = await formSubmissionCollection();
    const result = await collection.findOneAndUpdate(
      access.query,
      { $set: { ...data, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!result) return NextResponse.json({ success: false, message: "Form submission not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: serializeFormSubmission(result) });
  } catch (error) {
    console.error("[PUT /api/forms/:id]", error);
    const message = error instanceof Error ? error.message : "Failed to update form submission";
    const status = message.includes("required") ? 400 : isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json({ success: false, message: status === 503 ? "Forms database is currently unavailable" : message }, { status });
  }
}
