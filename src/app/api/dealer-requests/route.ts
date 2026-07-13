import { NextRequest, NextResponse } from "next/server";

import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import {
  buildDealerRequestAccessQuery,
  buildDealerRequestCreateDocument,
  buildDealerRequestListSearchQuery,
  buildDealerRequestReference,
  ensureDealerRequestIndexes,
  getDealerRequestCollection,
  resolveDealerRequestActor,
  toDealerRequestDetail,
  toDealerRequestListItem,
} from "@/lib/dealerRequests";
import { normalizeDealerFormSnapshot, validateDealerFormSnapshot } from "@/lib/dealerForm";

export const runtime = "nodejs";

function safeNumber(value: string | null, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildResponseError(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

function isDuplicateKeyError(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: number }).code === 11000;
}

export async function GET(request: NextRequest) {
  try {
    const actor = resolveDealerRequestActor({
      headers: request.headers,
      role: request.nextUrl.searchParams.get("role"),
      actorId: request.nextUrl.searchParams.get("actorId"),
      actorName: request.nextUrl.searchParams.get("actorName"),
      roletype: request.nextUrl.searchParams.get("roletype"),
    });

    if (!actor || (actor.role !== "admin" && actor.role !== "staff")) {
      return buildResponseError("Dealer request access is restricted to admin and staff", 403);
    }

    const status = request.nextUrl.searchParams.get("status");
    const page = Math.max(1, safeNumber(request.nextUrl.searchParams.get("page"), 1));
    const limit = Math.min(50, Math.max(1, safeNumber(request.nextUrl.searchParams.get("limit"), 10)));
    const search = request.nextUrl.searchParams.get("search") ?? "";

    const filters: Record<string, unknown>[] = [buildDealerRequestAccessQuery(actor)];
    if (status === "pending" || status === "accepted" || status === "rejected") {
      filters.push({ status });
    }

    const searchQuery = buildDealerRequestListSearchQuery(search);
    if (searchQuery) {
      filters.push(searchQuery);
    }

    const query = filters.length === 1
      ? filters[0]
      : { $and: filters.filter((filter) => Object.keys(filter).length > 0) };

    const db = await getDb();
    await ensureDealerRequestIndexes(db);
    const collection = getDealerRequestCollection(db);

    const total = await collection.countDocuments(query);
    const rows = await collection
      .find(query)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    return NextResponse.json({
      success: true,
      data: rows.map(toDealerRequestListItem),
      total,
      page,
      limit,
      lastPage: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("[GET /api/dealer-requests]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return buildResponseError(
      status === 503
        ? "Dealer request database is currently unavailable"
        : "Failed to load dealer requests",
      status,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const actor = resolveDealerRequestActor({
      headers: request.headers,
      role: body.role,
      actorId: body.actorId,
      actorName: body.actorName,
      roletype: body.roletype,
    });

    if (!actor || actor.role !== "staff") {
      return buildResponseError("Only staff can submit dealer approval requests", 403);
    }

    const snapshot = normalizeDealerFormSnapshot(body.formSnapshot ?? body);
    const validationError = validateDealerFormSnapshot(snapshot);
    if (validationError) {
      return buildResponseError(validationError, 400);
    }

    const now = new Date().toISOString();
    const db = await getDb();
    await ensureDealerRequestIndexes(db);
    const collection = getDealerRequestCollection(db);

    const doc = buildDealerRequestCreateDocument({ actor, snapshot, now });
    const existing = await collection.findOne({ openRequestKey: doc.openRequestKey });
    if (existing) {
      return NextResponse.json({ success: true, data: toDealerRequestDetail(existing) });
    }

    const insertResult = await collection.insertOne(doc);
    const id = insertResult.insertedId.toString();
    const requestReference = buildDealerRequestReference(id);

    await collection.updateOne(
      { _id: insertResult.insertedId },
      { $set: { requestReference } },
    );

    const created = await collection.findOne({ _id: insertResult.insertedId });
    return NextResponse.json({ success: true, data: toDealerRequestDetail(created ?? { ...doc, _id: insertResult.insertedId, requestReference }) }, { status: 201 });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return buildResponseError("A pending dealer request already exists for these details", 409);
    }
    console.error("[POST /api/dealer-requests]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return buildResponseError(
      status === 503
        ? "Dealer request database is currently unavailable"
        : "Failed to create dealer request",
      status,
    );
  }
}
