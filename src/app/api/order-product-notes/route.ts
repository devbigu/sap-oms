import { NextRequest, NextResponse } from "next/server";
import { MongoServerError } from "mongodb";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import {
  PRODUCT_NOTE_LIMIT,
  isExpectedOrderNumber,
  normalizeProductNote,
  normalizeSku,
} from "@/lib/orderProductNotes.mjs";

export const runtime = "nodejs";

function safeText(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeOccurrence(value: unknown) {
  const occurrence = Number(value);
  if (!Number.isFinite(occurrence) || occurrence < 1) return 1;
  return Math.floor(occurrence);
}

function toDoc<T extends { _id: { toString(): string } }>(doc: T) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    id: _id.toString(),
  };
}

async function getCollection() {
  const db = await getDb();
  const collection = db.collection("order_product_notes");
  await collection.createIndex(
    { orderItemId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        orderItemId: { $exists: true, $type: "string" },
      },
    }
  );
  await collection.createIndex(
    { orderId: 1, normalizedSku: 1, occurrence: 1 },
    { unique: true, partialFilterExpression: { orderItemId: null } }
  );
  await collection.createIndex({ orderId: 1, updatedAt: -1 });
  return collection;
}

export async function GET(req: NextRequest) {
  try {
    const orderId = safeText(req.nextUrl.searchParams.get("orderId") || req.nextUrl.searchParams.get("order_id"), 80);
    const orderIds = safeText(req.nextUrl.searchParams.get("orderIds") || req.nextUrl.searchParams.get("order_ids"), 4000);
    const orderItemId = safeText(req.nextUrl.searchParams.get("orderItemId") || req.nextUrl.searchParams.get("order_item_id"), 80);

    if (!orderId && !orderIds && !orderItemId) {
      return NextResponse.json(
        { success: false, message: "orderId, orderIds, or orderItemId is required" },
        { status: 400 }
      );
    }

    const query: Record<string, unknown> = {};
    if (orderItemId) {
      query.orderItemId = orderItemId;
    } else if (orderIds) {
      query.orderId = {
        $in: orderIds.split(",").map((id) => safeText(id, 80)).filter(Boolean).slice(0, 200),
      };
    } else {
      query.orderId = orderId;
    }

    const collection = await getCollection();
    const docs = await collection.find(query).sort({ updatedAt: -1, createdAt: -1 }).limit(500).toArray();

    if (orderItemId && docs.length === 0) {
      return NextResponse.json({ success: false, message: "Product note not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: docs.map(toDoc) });
  } catch (error: unknown) {
    console.error("[GET /api/order-product-notes]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json(
      { success: false, message: status === 503 ? "Product note database is currently unavailable" : "Failed to load product notes" },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const orderId = safeText(body.orderId, 80);
    const orderItemId = safeText(body.orderItemId, 80) || null;
    const sku = safeText(body.sku, 200);
    const dealerId = safeText(body.dealerId, 80);
    const note = normalizeProductNote(body.note, PRODUCT_NOTE_LIMIT);
    const normalizedSku = normalizeSku(sku);
    const occurrence = safeOccurrence(body.occurrence);

    if (!orderId) {
      return NextResponse.json({ success: false, message: "actual orderId is required" }, { status: 400 });
    }
    if (isExpectedOrderNumber(orderId)) {
      return NextResponse.json({ success: false, message: "expectedOrderNumber cannot be used as orderId" }, { status: 409 });
    }
    if (!sku || !normalizedSku) {
      return NextResponse.json({ success: false, message: "sku is required" }, { status: 400 });
    }
    if (!dealerId) {
      return NextResponse.json({ success: false, message: "dealerId is required" }, { status: 400 });
    }
    if (!note) {
      return NextResponse.json({ success: false, message: "note is required" }, { status: 400 });
    }
    if (String(body.note ?? "").trim().length > PRODUCT_NOTE_LIMIT) {
      return NextResponse.json(
        { success: false, message: `note must not exceed ${PRODUCT_NOTE_LIMIT} characters` },
        { status: 400 }
      );
    }

    const now = new Date();
    const collection = await getCollection();
    const identity = orderItemId
      ? { orderItemId }
      : { orderId, normalizedSku, occurrence };

    await collection.updateOne(
      identity,
      {
        $set: {
          orderId,
          orderItemId,
          sku,
          normalizedSku,
          occurrence,
          dealerId,
          note,
          source: "php_fallback",
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    const doc = await collection.findOne(identity);
    if (!doc) {
      return NextResponse.json({ success: false, message: "Product note could not be saved" }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: toDoc(doc) }, { status: 201 });
  } catch (error: unknown) {
    console.error("[POST /api/order-product-notes]", error);

    if (error instanceof MongoServerError && error.code === 11000) {
      return NextResponse.json({ success: false, message: "A conflicting product note already exists" }, { status: 409 });
    }

    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json(
      { success: false, message: status === 503 ? "Product note database is currently unavailable" : "Failed to save product note" },
      { status }
    );
  }
}
