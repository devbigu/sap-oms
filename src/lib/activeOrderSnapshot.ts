import { createHash, randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import { ACTIVE_ORDER_PERIOD_VERSION, getOriginalOrderDate, isActiveOrder } from "@/lib/activeOrderPeriod.js";
import { scanScopedActiveOrders, type ActiveOrdersActor } from "@/lib/activeOrdersPagination";
import { getDb } from "@/lib/mongodb";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const HEADER_COLLECTION = "active_order_headers";
const META_COLLECTION = "active_order_snapshots";
const LOCK_COLLECTION = "active_order_snapshot_locks";
const SNAPSHOT_SCHEMA_VERSION = 2;
const DEFAULT_FRESH_MS = 5 * 60 * 1000;
const DEFAULT_LOCK_MS = 2 * 60 * 1000;
const COLD_WAIT_MS = 30 * 1000;
const UPSTREAM_PAGE_SIZE = 200;
const MAX_UPSTREAM_PAGES = 100;
const UPSTREAM_TIMEOUT_MS = 20 * 1000;

export const ACTIVE_ORDER_HEADER_SOURCES = new Set([
  "orderpegination",
  "orderhispegination",
  "orderpeginationnew",
  "staffOrderrPagination",
]);

const HEADER_FIELDS = [
  "order_id", "orderId", "order_number", "orderNumber", "order_no", "refno",
  "order_date", "orderDate", "order_datetime", "orderDatetime", "order_created_at", "orderCreatedAt",
  "order_dealer", "orderdata_dealerid", "Dealer_Id", "Dealer_Name", "Dealer_Dealercode",
  "dealer_name", "dealer_code", "staffid",
  "order_amount", "total", "grossAmount", "gross_amount", "subtotal",
  "order_discount", "order_discount_amount", "discountAmount", "discount_amount",
  "order_net_amount", "netPayableAmount", "net_payable_amount",
  "baseDiscountAmount", "base_discount_amount", "baseDiscountPercent", "base_discount_percent",
  "postBaseAmount", "post_base_amount", "amountBeforeSlab", "amount_before_slab",
  "additionalDiscountType", "additional_discount_type",
  "additionalDiscountAmount", "additional_discount_amount",
  "slabDiscountAmount", "slab_discount_amount", "slabDiscountPercent", "slab_discount_percent",
  "customDiscountAmount", "custom_discount_amount", "customDiscountPercent", "custom_discount_percent",
  "approvedDiscountAmount", "approved_discount_amount", "approvedDiscountPercent", "approved_discount_percent",
  "allocatedDiscountPercent", "allocated_discount_percent",
  "couponDiscountPercent", "coupon_discount_percent",
  "invoice_id", "invoiceId", "invoice_number", "invoiceNumber", "invoice_date", "invoiceDate",
  "order_status", "status", "accept_order", "del_status", "reason", "mtstatus",
  "outstandingDate", "orderdata_item_quantity", "readyquantity", "orderdata_datetime",
] as const;

export type ActiveOrderHeader = Record<string, string | number | boolean | null | Date>;

export type ActiveOrderSnapshotDiagnostics = {
  upstreamCalls: number;
  upstreamHeaders: number;
  fetchMs: number;
  filterMs: number;
};

export type ActiveOrderSnapshot = {
  key: string;
  generation: string;
  rows: ActiveOrderHeader[];
  syncedAt: Date;
  staleAt: Date;
  exact: boolean;
  diagnostics: ActiveOrderSnapshotDiagnostics;
};

export type SnapshotBuildResult = {
  rows: ActiveOrderHeader[];
  exact: boolean;
  diagnostics: ActiveOrderSnapshotDiagnostics;
};

export interface ActiveOrderSnapshotRepository {
  ensureIndexes(): Promise<void>;
  read(key: string): Promise<ActiveOrderSnapshot | null>;
  commit(key: string, generation: string, built: SnapshotBuildResult, syncedAt: Date, staleAt: Date): Promise<void>;
  acquireLock(key: string, token: string, now: Date, expiresAt: Date): Promise<boolean>;
  releaseLock(key: string, token: string): Promise<void>;
  markAllStale(reason: string, at: Date): Promise<number>;
}

type SnapshotMetaDocument = {
  _id: string;
  schemaVersion: number;
  cutoffVersion: string;
  generation: string;
  state: "ready";
  exact: boolean;
  rowCount: number;
  syncedAt: Date;
  staleAt: Date;
  diagnostics: ActiveOrderSnapshotDiagnostics;
  invalidatedAt?: Date;
  invalidationReason?: string;
};

type SnapshotHeaderDocument = {
  snapshotKey: string;
  generation: string;
  orderKey: string;
  orderId: string;
  originalOrderDate: string | number | Date | null;
  activeDate: string;
  dealerId: string;
  orderStatus: string;
  position: number;
  header: ActiveOrderHeader;
};

type SnapshotLockDocument = {
  _id: string;
  token: string;
  acquiredAt: Date;
  expiresAt: Date;
};

export class ActiveOrderSnapshotUnavailableError extends Error {
  constructor(message = "Active orders are synchronizing. Please try again shortly.") {
    super(message);
    this.name = "ActiveOrderSnapshotUnavailableError";
  }
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function originalOrderDateValue(order: Record<string, unknown>): string | number | Date | null {
  for (const field of ["order_date", "orderDate", "order_datetime", "orderDatetime", "order_created_at", "orderCreatedAt", "created_at", "createdAt"]) {
    const value = order[field];
    if (typeof value === "string" || typeof value === "number") return value;
    if (value instanceof Date) return new Date(value.getTime());
  }
  return null;
}

export function sanitizeActiveOrderHeader(order: Record<string, unknown>): ActiveOrderHeader | null {
  if (!isActiveOrder(order)) return null;
  const header: ActiveOrderHeader = {};
  for (const field of HEADER_FIELDS) {
    const value = order[field];
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      header[field] = value;
    } else if (value instanceof Date) {
      header[field] = new Date(value.getTime());
    }
  }

  const orderId = text(header.order_id ?? header.orderId);
  const activeDate = getOriginalOrderDate(order);
  if (!orderId || !activeDate) return null;
  return header;
}

function orderKey(order: ActiveOrderHeader) {
  const dealerId = text(order.order_dealer ?? order.orderdata_dealerid ?? order.Dealer_Id);
  return `${dealerId}:${text(order.order_id ?? order.orderId)}`;
}

export function buildActiveOrderSnapshotKey(input: {
  source: string;
  actor: ActiveOrdersActor;
  assignedDealerIds: Array<string | number>;
  upstreamActorIds: string[];
}) {
  const scope = JSON.stringify({
    role: input.actor.role,
    actorId: input.actor.actorId,
    assignedDealerIds: input.assignedDealerIds.map(text).filter(Boolean).sort(),
    upstreamActorIds: input.upstreamActorIds.map(text).sort(),
  });
  const digest = createHash("sha256").update(scope).digest("hex").slice(0, 24);
  return `${ACTIVE_ORDER_PERIOD_VERSION}:${input.source}:${input.actor.role}:${digest}`;
}

function freshMilliseconds() {
  const configured = Number(process.env.ACTIVE_ORDER_SNAPSHOT_TTL_MS);
  return Number.isFinite(configured) && configured >= 30_000 ? configured : DEFAULT_FRESH_MS;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createActiveOrderSnapshotCoordinator(
  repository: ActiveOrderSnapshotRepository,
  options: {
    now?: () => Date;
    freshMs?: number;
    lockMs?: number;
    coldWaitMs?: number;
    pollMs?: number;
  } = {},
) {
  const inFlight = new Map<string, Promise<ActiveOrderSnapshot | null>>();
  const now = options.now ?? (() => new Date());
  const freshMs = options.freshMs ?? freshMilliseconds();
  const lockMs = options.lockMs ?? DEFAULT_LOCK_MS;
  const coldWaitMs = options.coldWaitMs ?? COLD_WAIT_MS;
  const pollMs = options.pollMs ?? 100;

  async function waitForCompletedSnapshot(key: string, deadline: number) {
    while (Date.now() < deadline) {
      const snapshot = await repository.read(key);
      if (snapshot) return snapshot;
      await sleep(pollMs);
    }
    return null;
  }

  async function synchronize(key: string, build: () => Promise<SnapshotBuildResult>) {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const operation = (async () => {
      await repository.ensureIndexes();
      const startedAt = now();
      const token = randomUUID();
      const acquired = await repository.acquireLock(
        key,
        token,
        startedAt,
        new Date(startedAt.getTime() + lockMs),
      );

      if (!acquired) {
        return waitForCompletedSnapshot(key, Date.now() + coldWaitMs);
      }

      try {
        const built = await build();
        if (!built.exact) {
          throw new ActiveOrderSnapshotUnavailableError("The active-order scan was incomplete; the previous snapshot was preserved.");
        }
        const syncedAt = now();
        const generation = randomUUID();
        await repository.commit(
          key,
          generation,
          built,
          syncedAt,
          new Date(syncedAt.getTime() + freshMs),
        );
        return repository.read(key);
      } finally {
        await repository.releaseLock(key, token).catch(() => undefined);
      }
    })();

    inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      if (inFlight.get(key) === operation) inFlight.delete(key);
    }
  }

  async function load(key: string, build: () => Promise<SnapshotBuildResult>, forceRefresh = false) {
    await repository.ensureIndexes();
    const snapshot = await repository.read(key);
    const currentTime = now();

    if (snapshot && !forceRefresh && snapshot.staleAt.getTime() > currentTime.getTime()) {
      return { snapshot, state: "fresh" as const, refreshPromise: null };
    }

    if (snapshot && !forceRefresh) {
      const refreshPromise = synchronize(key, build).catch((error) => {
        console.error("[active-order snapshot refresh]", error);
        return null;
      });
      return { snapshot, state: "stale" as const, refreshPromise };
    }

    try {
      const refreshed = await synchronize(key, build);
      if (refreshed) return { snapshot: refreshed, state: "refreshed" as const, refreshPromise: null };
    } catch (error) {
      if (snapshot) return { snapshot, state: "stale" as const, refreshPromise: null };
      throw error;
    }

    if (snapshot) return { snapshot, state: "stale" as const, refreshPromise: null };
    throw new ActiveOrderSnapshotUnavailableError();
  }

  return {
    load,
    synchronize,
    invalidate: (reason: string) => repository.markAllStale(reason, now()),
    inFlightCount: () => inFlight.size,
  };
}

let indexesPromise: Promise<void> | null = null;

function mongoRepository(): ActiveOrderSnapshotRepository {
  let collectionsPromise: Promise<{
    headers: Collection<SnapshotHeaderDocument>;
    meta: Collection<SnapshotMetaDocument>;
    locks: Collection<SnapshotLockDocument>;
  }> | null = null;

  function collections() {
    if (!collectionsPromise) {
      collectionsPromise = getDb().then((db) => ({
        headers: db.collection<SnapshotHeaderDocument>(HEADER_COLLECTION),
        meta: db.collection<SnapshotMetaDocument>(META_COLLECTION),
        locks: db.collection<SnapshotLockDocument>(LOCK_COLLECTION),
      })).catch((error) => {
        collectionsPromise = null;
        throw error;
      });
    }
    return collectionsPromise;
  }

  return {
    async ensureIndexes() {
      if (!indexesPromise) {
        indexesPromise = (async () => {
          const { headers, meta, locks } = await collections();
          await Promise.all([
            headers.createIndex(
              { snapshotKey: 1, generation: 1, orderKey: 1 },
              { unique: true, name: "snapshot_generation_order_unique" },
            ),
            headers.createIndex(
              { snapshotKey: 1, generation: 1, position: 1 },
              { name: "snapshot_generation_position" },
            ),
            headers.createIndex(
              { snapshotKey: 1, generation: 1, dealerId: 1, position: 1 },
              { name: "snapshot_generation_dealer_position" },
            ),
            meta.createIndex({ cutoffVersion: 1, staleAt: 1 }, { name: "cutoff_staleness" }),
            locks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expired_snapshot_locks" }),
          ]);
        })().catch((error) => {
          indexesPromise = null;
          throw error;
        });
      }
      return indexesPromise;
    },

    async read(key) {
      const { headers, meta } = await collections();
      const metadata = await meta.findOne({
        _id: key,
        state: "ready",
        exact: true,
        cutoffVersion: ACTIVE_ORDER_PERIOD_VERSION,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      });
      if (!metadata) return null;
      const docs = await headers
        .find({ snapshotKey: key, generation: metadata.generation })
        .sort({ position: 1 })
        .toArray();
      if (docs.length !== metadata.rowCount) return null;
      return {
        key,
        generation: metadata.generation,
        rows: docs.map((doc) => doc.header),
        syncedAt: metadata.syncedAt,
        staleAt: metadata.staleAt,
        exact: metadata.exact,
        diagnostics: metadata.diagnostics,
      };
    },

    async commit(key, generation, built, syncedAt, staleAt) {
      const { headers, meta } = await collections();
      const docs = built.rows.map((header, position): SnapshotHeaderDocument => ({
        snapshotKey: key,
        generation,
        orderKey: orderKey(header),
        orderId: text(header.order_id ?? header.orderId),
        originalOrderDate: originalOrderDateValue(header),
        activeDate: getOriginalOrderDate(header) ?? "",
        dealerId: text(header.order_dealer ?? header.orderdata_dealerid ?? header.Dealer_Id),
        orderStatus: text(header.order_status ?? header.status),
        position,
        header,
      }));

      try {
        if (docs.length > 0) await headers.insertMany(docs, { ordered: true });
        await meta.updateOne(
          { _id: key },
          {
            $set: {
              schemaVersion: SNAPSHOT_SCHEMA_VERSION,
              cutoffVersion: ACTIVE_ORDER_PERIOD_VERSION,
              generation,
              state: "ready",
              exact: true,
              rowCount: docs.length,
              syncedAt,
              staleAt,
              diagnostics: built.diagnostics,
            },
            $unset: { invalidatedAt: "", invalidationReason: "" },
          },
          { upsert: true },
        );
      } catch (error) {
        await headers.deleteMany({ snapshotKey: key, generation }).catch(() => undefined);
        throw error;
      }

      await headers.deleteMany({ snapshotKey: key, generation: { $ne: generation } }).catch(() => undefined);
    },

    async acquireLock(key, token, now, expiresAt) {
      const { locks } = await collections();
      try {
        const result = await locks.findOneAndUpdate(
          { _id: key, $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }] },
          { $set: { token, acquiredAt: now, expiresAt } },
          { upsert: true, returnDocument: "after" },
        );
        return result?.token === token;
      } catch (error) {
        if ((error as { code?: number }).code === 11000) return false;
        throw error;
      }
    },

    async releaseLock(key, token) {
      const { locks } = await collections();
      await locks.deleteOne({ _id: key, token });
    },

    async markAllStale(reason, at) {
      const { meta } = await collections();
      const result = await meta.updateMany(
        { cutoffVersion: ACTIVE_ORDER_PERIOD_VERSION, state: "ready" },
        { $set: { staleAt: new Date(0), invalidatedAt: at, invalidationReason: reason.slice(0, 120) } },
      );
      return result.modifiedCount;
    },
  };
}

const globalState = globalThis as typeof globalThis & {
  __activeOrderSnapshotCoordinator?: ReturnType<typeof createActiveOrderSnapshotCoordinator>;
};

const coordinator = globalState.__activeOrderSnapshotCoordinator
  ?? (globalState.__activeOrderSnapshotCoordinator = createActiveOrderSnapshotCoordinator(mongoRepository()));

function upstreamActorIds(input: {
  source: string;
  actor: ActiveOrdersActor;
  assignedDealerIds: Array<string | number>;
}) {
  if (input.actor.role !== "staff") return [input.actor.actorId];
  if (input.source === "staffOrderrPagination") return [input.actor.actorId];
  if (input.source === "orderhispegination") return input.assignedDealerIds.map(text).filter(Boolean);
  return [""];
}

async function buildActiveHeaderSnapshot(input: {
  source: string;
  actor: ActiveOrdersActor;
  assignedDealerIds: Array<string | number>;
  upstreamActorIds: string[];
}): Promise<SnapshotBuildResult> {
  let fetchMs = 0;
  let upstreamHeaders = 0;
  const filterStartedAt = performance.now();
  const scan = await scanScopedActiveOrders<Record<string, unknown>>({
    actor: input.actor,
    assignedDealerIds: input.assignedDealerIds,
    upstreamActorIds: input.upstreamActorIds,
    upstreamPageSize: UPSTREAM_PAGE_SIZE,
    maxUpstreamPages: MAX_UPSTREAM_PAGES,
    fetchPage: async (upstreamActorId, page, pageSize) => {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize), search: "" });
      if (upstreamActorId) params.set("id", upstreamActorId);
      const fetchStartedAt = performance.now();
      const response = await fetch(`${BACKEND_URL}/${input.source}?${params.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      fetchMs += performance.now() - fetchStartedAt;
      if (!response.ok) throw new Error(`${input.source} failed with ${response.status}`);
      const payload = await response.json();
      const rows: Record<string, unknown>[] = Array.isArray(payload?.data)
        ? payload.data.filter((row: unknown): row is Record<string, unknown> => !!row && typeof row === "object")
        : [];
      upstreamHeaders += rows.length;
      return {
        rows,
        lastPage: Number(payload?.last_page ?? payload?.lastPage ?? 0),
        total: Number(payload?.count ?? payload?.total ?? payload?.recordsTotal ?? 0),
      };
    },
  });

  const rows = scan.rows
    .map(sanitizeActiveOrderHeader)
    .filter((row): row is ActiveOrderHeader => row !== null);
  const filterMs = Math.max(0, performance.now() - filterStartedAt - fetchMs);
  return {
    rows,
    exact: scan.totalIsExact,
    diagnostics: {
      upstreamCalls: scan.pageCalls.length,
      upstreamHeaders,
      fetchMs: Math.round(fetchMs),
      filterMs: Math.round(filterMs),
    },
  };
}

export async function loadActiveOrderHeaders(input: {
  source: string;
  actor: ActiveOrdersActor;
  assignedDealerIds?: Array<string | number>;
  forceRefresh?: boolean;
}) {
  if (!ACTIVE_ORDER_HEADER_SOURCES.has(input.source)) {
    throw new Error(`Unsupported active-order header source: ${input.source}`);
  }
  const assignedDealerIds = input.assignedDealerIds ?? [];
  const actorIds = upstreamActorIds({ ...input, assignedDealerIds });
  const key = buildActiveOrderSnapshotKey({ ...input, assignedDealerIds, upstreamActorIds: actorIds });
  const loaded = await coordinator.load(
    key,
    () => buildActiveHeaderSnapshot({ ...input, assignedDealerIds, upstreamActorIds: actorIds }),
    input.forceRefresh,
  );
  return {
    ...loaded,
    key,
    rows: loaded.snapshot.rows,
    diagnostics: loaded.snapshot.diagnostics,
  };
}

export async function readActiveOrderHeadersSnapshot(input: {
  source: string;
  actor: ActiveOrdersActor;
  assignedDealerIds?: Array<string | number>;
}) {
  if (!ACTIVE_ORDER_HEADER_SOURCES.has(input.source)) {
    throw new Error(`Unsupported active-order header source: ${input.source}`);
  }
  const assignedDealerIds = input.assignedDealerIds ?? [];
  const actorIds = upstreamActorIds({ ...input, assignedDealerIds });
  const key = buildActiveOrderSnapshotKey({ ...input, assignedDealerIds, upstreamActorIds: actorIds });
  const repository = mongoRepository();
  await repository.ensureIndexes();
  const snapshot = await repository.read(key);
  return {
    key,
    state: snapshot ? "hit" as const : "miss" as const,
    rows: snapshot?.rows ?? [],
    diagnostics: snapshot?.diagnostics ?? null,
  };
}

export async function invalidateActiveOrderSnapshots(reason: string) {
  return coordinator.invalidate(reason || "order-header mutation");
}
