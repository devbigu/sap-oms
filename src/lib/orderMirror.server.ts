import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import {
  ORDER_MIRROR_COLLECTION,
  compareOrderSnapshot,
  snapshotFromOrderDetailRows,
  type OrderMirrorSnapshot,
  type OrderMirrorVerification,
} from "@/lib/orderMirror";
import { normalizeOrderDetailResponse } from "@/lib/orderDetailItems";

export type OrderMirrorRecord = {
  orderId: string;
  orderNumber: string;
  dealerId: string;
  actor: { id: string; role: string; name: string };
  idempotencyKey: string;
  snapshot: OrderMirrorSnapshot;
  submittedForm: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
};

export type SaveOrderMirrorInput = Omit<OrderMirrorRecord, "createdAt" | "updatedAt">;

/**
 * Never let mirroring fail an order that PHP already accepted — this is a
 * fallback record, not a gate.
 */
export async function saveOrderMirror(input: SaveOrderMirrorInput): Promise<boolean> {
  try {
    const now = new Date();
    await (await getDb()).collection(ORDER_MIRROR_COLLECTION).updateOne(
      { orderId: input.orderId },
      { $set: { ...input, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error("order mirror save failed", { orderId: input.orderId, error });
    return false;
  }
}

export async function findOrderMirror(orderId: string): Promise<OrderMirrorRecord | null> {
  try {
    const doc = await (await getDb())
      .collection(ORDER_MIRROR_COLLECTION)
      .findOne<OrderMirrorRecord>({ orderId: String(orderId) }, { projection: { _id: 0 } });
    return doc ?? null;
  } catch (error) {
    if (isMongoDependencyError(error)) return null;
    throw error;
  }
}

/** Compare the stored mirror against the live PHP order detail payload. */
export function verifyOrderAgainstMirror(
  mirror: OrderMirrorRecord,
  phpDetailPayload: unknown,
  orderId: string
): OrderMirrorVerification {
  const { meta, items } = normalizeOrderDetailResponse(phpDetailPayload, orderId);
  return compareOrderSnapshot(mirror.snapshot, snapshotFromOrderDetailRows(items, meta));
}
