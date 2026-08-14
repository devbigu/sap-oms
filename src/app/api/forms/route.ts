import { NextRequest, NextResponse } from "next/server";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import {
  formSubmissionCollection,
  nextLeadNo,
  serializeFormSubmission,
  validateFormSubmissionBody,
  type SubmittedBy,
} from "@/lib/formSubmissions";

export const runtime = "nodejs";

export function actor(req: NextRequest) {
  return {
    role: String(req.headers.get("x-omsons-actor-role") || "").trim().toLowerCase(),
    id: String(req.headers.get("x-omsons-actor-id") || "").trim(),
    name: String(req.headers.get("x-omsons-actor-name") || "").trim(),
  };
}

function staffActor(req: NextRequest): SubmittedBy | NextResponse {
  const current = actor(req);
  if (current.role !== "staff" || !current.id) {
    return NextResponse.json({ success: false, message: "Only staff can submit forms" }, { status: 403 });
  }
  return { userId: current.id.slice(0, 120), name: (current.name || current.id).slice(0, 200) };
}

function adminOnly(req: NextRequest) {
  if (actor(req).role !== "admin") {
    return NextResponse.json({ success: false, message: "Only admin can view all form submissions" }, { status: 403 });
  }
  return null;
}

function dateFrom(value: string | null, end = false) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (end) parsed.setHours(23, 59, 59, 999);
  return parsed;
}

export function listQuery(req: NextRequest, staffId?: string) {
  const search = String(req.nextUrl.searchParams.get("search") || "").trim();
  const pageParam = Number(req.nextUrl.searchParams.get("page") || 1);
  const limitParam = Number(req.nextUrl.searchParams.get("limit") || 20);
  const page = Number.isFinite(pageParam) ? Math.max(1, pageParam) : 1;
  const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, limitParam)) : 20;
  const from = dateFrom(req.nextUrl.searchParams.get("from"));
  const to = dateFrom(req.nextUrl.searchParams.get("to"), true);
  const and: Record<string, unknown>[] = [];

  if (staffId) and.push({ "submittedBy.userId": staffId });
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    and.push({ $or: [{ leadNo: regex }, { "customerDetails.companyName": regex }, { "submittedBy.name": regex }] });
  }
  if (from || to) and.push({ visitedDate: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } });

  return { query: and.length ? { $and: and } : {}, page, limit };
}

export async function listForms(req: NextRequest, staffId?: string) {
  const { query, page, limit } = listQuery(req, staffId);
  const collection = await formSubmissionCollection();
  const [rows, total] = await Promise.all([
    collection.find(query).sort({ visitedDate: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    collection.countDocuments(query),
  ]);
  return NextResponse.json({
    success: true,
    data: rows.map(serializeFormSubmission),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

export async function POST(req: NextRequest) {
  try {
    const submittedBy = staffActor(req);
    if (submittedBy instanceof NextResponse) return submittedBy;

    const data = validateFormSubmissionBody(await req.json());
    const db = await getDb();
    const now = new Date();
    const doc = {
      ...data,
      leadNo: await nextLeadNo(db),
      submittedBy,
      visitedDate: now,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const collection = await formSubmissionCollection();
    const result = await collection.insertOne(doc);
    const created = await collection.findOne({ _id: result.insertedId });
    return NextResponse.json({ success: true, data: created ? serializeFormSubmission(created) : null }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/forms]", error);
    const message = error instanceof Error ? error.message : "Failed to create form submission";
    const status = message.includes("required") ? 400 : isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json({ success: false, message: status === 503 ? "Forms database is currently unavailable" : message }, { status });
  }
}

export async function GET(req: NextRequest) {
  try {
    const denied = adminOnly(req);
    if (denied) return denied;
    return await listForms(req);
  } catch (error) {
    console.error("[GET /api/forms]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json({ success: false, message: status === 503 ? "Forms database is currently unavailable" : "Failed to load form submissions" }, { status });
  }
}
