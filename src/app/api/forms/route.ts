import { NextRequest, NextResponse } from "next/server";
import { isMongoDependencyError } from "@/lib/mongodb";
import {
  formSubmissionCollection,
  serializeFormSubmission,
  validateFormSubmissionBody,
  type SubmittedBy,
} from "@/lib/formSubmissions";

export const runtime = "nodejs";

function actor(req: NextRequest) {
  return {
    role: String(req.headers.get("x-omsons-actor-role") || "").trim().toLowerCase(),
    id: String(req.headers.get("x-omsons-actor-id") || "").trim(),
    name: String(req.headers.get("x-omsons-actor-name") || "").trim(),
  };
}

function requireStaff(req: NextRequest): SubmittedBy | NextResponse {
  const current = actor(req);
  if (current.role !== "staff" || !current.id) {
    return NextResponse.json({ success: false, message: "Only staff can submit forms" }, { status: 403 });
  }
  return { id: current.id.slice(0, 120), name: (current.name || current.id).slice(0, 200) };
}

function requireAdmin(req: NextRequest): NextResponse | null {
  if (actor(req).role !== "admin") {
    return NextResponse.json({ success: false, message: "Only admin can view form submissions" }, { status: 403 });
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

export async function POST(req: NextRequest) {
  try {
    const submittedBy = requireStaff(req);
    if (submittedBy instanceof NextResponse) return submittedBy;

    const body = await req.json();
    const data = validateFormSubmissionBody(body);
    const now = new Date();
    const doc = {
      ...data,
      submittedBy,
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
    const denied = requireAdmin(req);
    if (denied) return denied;

    const search = String(req.nextUrl.searchParams.get("search") || "").trim();
    const pageParam = Number(req.nextUrl.searchParams.get("page") || 1);
    const limitParam = Number(req.nextUrl.searchParams.get("limit") || 20);
    const page = Number.isFinite(pageParam) ? Math.max(1, pageParam) : 1;
    const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, limitParam)) : 20;
    const from = dateFrom(req.nextUrl.searchParams.get("from"));
    const to = dateFrom(req.nextUrl.searchParams.get("to"), true);

    const query: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      and.push({
        $or: [
          { leadNo: regex },
          { "customerDetails.companyName": regex },
          { "submittedBy.name": regex },
        ],
      });
    }

    if (from || to) {
      and.push({
        submittedAt: {
          ...(from ? { $gte: from } : {}),
          ...(to ? { $lte: to } : {}),
        },
      });
    }

    if (and.length) query.$and = and;

    const collection = await formSubmissionCollection();
    const [rows, total] = await Promise.all([
      collection.find(query).sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
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
  } catch (error) {
    console.error("[GET /api/forms]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json(
      { success: false, message: status === 503 ? "Forms database is currently unavailable" : "Failed to load form submissions" },
      { status },
    );
  }
}
