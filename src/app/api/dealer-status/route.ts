import { NextRequest, NextResponse } from "next/server";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { normalizeDealerStatus, type DealerStatus, type DealerStatusDocument } from "@/lib/dealerStatus";

export const runtime = "nodejs";

type DealerStatusDbDocument = {
  dealerId: string;
  status: DealerStatus;
  updatedAt: Date;
  updatedBy?: string;
};

type DealerStatusResponseDocument = {
  dealerId: string;
  status: DealerStatus;
  updatedAt: string;
  updatedBy?: string;
};

const COLLECTION = "dealer_statuses";

function toResponseDocument(doc: DealerStatusDbDocument): DealerStatusResponseDocument {
  return {
    dealerId: doc.dealerId,
    status: normalizeDealerStatus(doc.status),
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : new Date(doc.updatedAt).toISOString(),
    ...(doc.updatedBy ? { updatedBy: doc.updatedBy } : {}),
  };
}

function safeErrorResponse(message: string, status = 500) {
  return NextResponse.json({ success: false, message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const dealerId = request.nextUrl.searchParams.get("dealer_id")?.trim() ?? "";
    const db = await getDb();
    const collection = db.collection<DealerStatusDbDocument>(COLLECTION);

    if (dealerId) {
      const doc = await collection.findOne({ dealerId });
      if (!doc) {
        return NextResponse.json({
          success: true,
          data: {
            dealerId,
            status: "active",
          } as DealerStatusResponseDocument,
        });
      }

      return NextResponse.json({
        success: true,
        data: toResponseDocument(doc),
      });
    }

    const docs = await collection.find({}).sort({ updatedAt: -1 }).toArray();
    return NextResponse.json({
      success: true,
      data: docs.map(toResponseDocument),
    });
  } catch (error) {
    console.error("dealer-status GET failed", error);
    if (isMongoDependencyError(error)) {
      return safeErrorResponse("Dealer status database is currently unavailable", 503);
    }
    return safeErrorResponse("Unable to load dealer status");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Partial<DealerStatusDocument & { updatedBy?: string }> | null;
    const dealerId = String(body?.dealerId ?? "").trim();
    const rawStatus = String(body?.status ?? "").trim().toLowerCase();
    const updatedBy = String(body?.updatedBy ?? "").trim();

    if (!dealerId || (rawStatus !== "active" && rawStatus !== "inactive")) {
      return safeErrorResponse("dealerId and a valid status are required", 400);
    }

    const db = await getDb();
    const collection = db.collection<DealerStatusDbDocument>(COLLECTION);
    const now = new Date();

    await collection.updateOne(
      { dealerId },
      {
        $set: {
          dealerId,
          status: rawStatus as DealerStatus,
          updatedAt: now,
          ...(updatedBy ? { updatedBy } : {}),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      data: {
        dealerId,
        status: rawStatus,
        updatedAt: now.toISOString(),
        ...(updatedBy ? { updatedBy } : {}),
      } as DealerStatusResponseDocument,
    });
  } catch (error) {
    console.error("dealer-status PATCH failed", error);
    if (isMongoDependencyError(error)) {
      return safeErrorResponse("Dealer status database is currently unavailable", 503);
    }
    return safeErrorResponse("Unable to save dealer status");
  }
}
