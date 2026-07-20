import { NextRequest, NextResponse } from "next/server";
import catalogueProducts from "../../../../public/data/omsons_products_from_excel_with_images.json";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { findOrderOverlay } from "@/lib/orderOverlays";
import type { OrderDispatchRecord } from "@/lib/orderDispatch";
import { loadOrderHeaders } from "@/lib/orderHeaders";
import {
  aggregatePendingProducts,
  buildPendingProductDrilldown,
  buildPendingProductFilterOptions,
  buildPendingProductLines,
  buildPendingProductsSummaryFromLines,
  filterPendingOrdersByRoleScope,
  filterPendingProductLines,
  filterPendingProducts,
  getPendingProductsCacheVersion,
  isEligibleOrderForPendingProducts,
  paginatePendingProducts,
  sortPendingProducts,
  type PendingDealerDirectoryRow,
  type PendingProductsItemRow,
  type PendingProductsOrderRow,
  type PendingProductsRole,
} from "@/lib/pendingProducts";

export const runtime = "nodejs";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const DISPATCH_COLLECTION = "order_dispatch_records";
const PAGINATION_LIMIT = 200;
const MAX_PAGINATION_PAGES = 50;
const ORDER_ITEM_CACHE_TTL_MS = 5 * 60 * 1000;
const BASE_SCOPE_CACHE_TTL_MS = 60 * 1000;
const ORDER_ITEM_CONCURRENCY = 6;

type PendingProductsActor = {
  role: PendingProductsRole;
  actorId: string;
  roletype: string;
};

type CachedOrderItems = {
  cachedAt: number;
  cacheVersion: number;
  items: PendingProductsItemRow[];
};

type CachedBaseScope = {
  cachedAt: number;
  cacheVersion: number;
  refreshToken: string;
  lines: ReturnType<typeof buildPendingProductLines>;
  warnings: string[];
};

type PhpPaginatedResponse<T> = {
  data?: T[];
  total?: number;
  count?: number;
  last_page?: number;
};

class PendingProductsError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PendingProductsError";
    this.status = status;
  }
}

const orderItemCache = new Map<string, CachedOrderItems>();
const baseScopeCache = new Map<string, CachedBaseScope>();

function safeText(value: unknown, max = 200): string {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : String(value ?? "").trim().slice(0, max);
}

function safeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function scalarStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function parseActor(req: NextRequest): PendingProductsActor | null {
  const role = safeText(req.headers.get("x-omsons-actor-role"), 20).toLowerCase();
  const actorId = safeText(req.headers.get("x-omsons-actor-id"), 120);
  const roletype = safeText(req.headers.get("x-omsons-actor-roletype"), 20);

  if (role !== "admin" && role !== "staff" && role !== "dealer") return null;
  if (role !== "admin" && !actorId) return null;

  return {
    role,
    actorId,
    roletype,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const responseText = await response.text();

  if (!response.ok) {
    throw new PendingProductsError(502, `External API failed with ${response.status}`);
  }

  if (/^\s*</.test(responseText)) {
    throw new PendingProductsError(502, "External API returned HTML instead of JSON");
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new PendingProductsError(502, "External API returned invalid JSON");
  }
}

async function fetchPaginatedRows<T>(urlBuilder: (page: number) => string): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  let lastPage = 1;

  while (page <= lastPage && page <= MAX_PAGINATION_PAGES) {
    const response = await fetchJson<PhpPaginatedResponse<T>>(urlBuilder(page));
    const data = Array.isArray(response.data) ? response.data : [];
    rows.push(...data);

    const responseLastPage = Number(response.last_page);
    if (Number.isFinite(responseLastPage) && responseLastPage > 0) {
      lastPage = responseLastPage;
    } else if (data.length < PAGINATION_LIMIT) {
      break;
    } else {
      lastPage = page + 1;
    }

    page += 1;
  }

  return rows;
}

async function fetchRoleScopedOrders(
  actor: PendingProductsActor,
  assignedDealerIds: string[],
  _forceRefresh: boolean,
): Promise<PendingProductsOrderRow[]> {
  const source = actor.role === "admin"
    ? "orderpegination"
    : actor.role === "staff"
      ? "staffOrderrPagination"
      : "orderhispegination";
  const loaded = await loadOrderHeaders({
    source,
    actor: { role: actor.role, actorId: actor.actorId },
    assignedDealerIds,
  });
  return loaded.rows as PendingProductsOrderRow[];
}

async function fetchDealerDirectory(actor: PendingProductsActor): Promise<PendingDealerDirectoryRow[]> {
  if (actor.role === "staff") {
    const response = await fetchJson<{ data?: PendingDealerDirectoryRow[] }>(
      `${BACKEND_URL}/staffDealers?id=${encodeURIComponent(actor.actorId)}`
    );
    return Array.isArray(response.data) ? response.data : [];
  }

  if (actor.role === "admin") {
    return fetchPaginatedRows<PendingDealerDirectoryRow>(
      (page) => `${BACKEND_URL}/dealerpegination?page=${page}&limit=${PAGINATION_LIMIT}&search=`
    );
  }

  return [];
}

function buildDealerDirectoryMap(rows: PendingDealerDirectoryRow[]) {
  return rows.reduce<Record<string, PendingDealerDirectoryRow>>((accumulator, row) => {
    const dealerId = safeText(row.Dealer_Id, 120);
    if (dealerId) accumulator[dealerId] = row;
    return accumulator;
  }, {});
}

function normalizeItemsFromPayload(orderId: string, payload: unknown): PendingProductsItemRow[] {
  const raw = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : [];

    if (Array.isArray(raw)) {
      if (raw.length > 0 && typeof raw[0] === "object" && raw[0] && Array.isArray((raw[0] as { items?: unknown[] }).items)) {
      return ((raw[0] as { items?: unknown[] }).items ?? []).map((item, index) => {
        const record = item as Record<string, unknown>;
        return {
          orderdata_id: String(record.productId ?? record.id ?? `item-${index}`),
          orderdata_orderid: String(record.orderId ?? orderId),
          orderdata_cat_no: String(record.productId ?? record.catNo ?? record.orderdata_cat_no ?? ""),
          product_name: String(record.productName ?? record.product_name ?? ""),
          product_discription: String(record.productDescription ?? record.product_discription ?? ""),
          product_unit: String(record.unit ?? record.product_unit ?? "Units"),
          orderdata_item_quantity: String(record.quantityPacks ?? record.quantity ?? record.orderdata_item_quantity ?? 0),
          readyquantity: String(record.readyQuantity ?? record.readyquantity ?? 0),
          orderdata_status: String(record.status ?? record.orderdata_status ?? "0"),
          remark: String(record.remark ?? record.remarks ?? ""),
          remarks: String(record.remarks ?? record.remark ?? ""),
          packSize: scalarStringOrNumber(record.packSize ?? record.pack_size),
          totalPieces: scalarStringOrNumber(record.totalPieces ?? record.total_pieces),
          quantityPacks: scalarStringOrNumber(record.quantityPacks ?? record.quantity_packs),
        };
      });
    }

    if (raw.length > 0 && typeof raw[0] === "object" && raw[0] && ("productId" in (raw[0] as Record<string, unknown>) || "quantityPacks" in (raw[0] as Record<string, unknown>))) {
      return raw.map((item, index) => {
        const record = item as Record<string, unknown>;
        return {
          orderdata_id: String(record.productId ?? record.id ?? `item-${index}`),
          orderdata_orderid: String(record.orderId ?? orderId),
          orderdata_cat_no: String(record.productId ?? record.catNo ?? record.orderdata_cat_no ?? ""),
          product_name: String(record.productName ?? record.product_name ?? ""),
          product_discription: String(record.productDescription ?? record.product_discription ?? ""),
          product_unit: String(record.unit ?? record.product_unit ?? "Units"),
          orderdata_item_quantity: String(record.quantityPacks ?? record.quantity ?? record.orderdata_item_quantity ?? 0),
          readyquantity: String(record.readyQuantity ?? record.readyquantity ?? 0),
          orderdata_status: String(record.status ?? record.orderdata_status ?? "0"),
          remark: String(record.remark ?? record.remarks ?? ""),
          remarks: String(record.remarks ?? record.remark ?? ""),
          packSize: scalarStringOrNumber(record.packSize ?? record.pack_size),
          totalPieces: scalarStringOrNumber(record.totalPieces ?? record.total_pieces),
          quantityPacks: scalarStringOrNumber(record.quantityPacks ?? record.quantity_packs),
        };
      });
    }

    return raw.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        orderdata_id: String(record.orderdata_id ?? ""),
        orderdata_orderid: String(record.orderdata_orderid ?? orderId),
        orderdata_cat_no: String(record.orderdata_cat_no ?? ""),
        product_name: String(record.product_name ?? ""),
        product_discription: String(record.product_discription ?? ""),
        product_unit: String(record.product_unit ?? "Units"),
        orderdata_item_quantity: String(record.orderdata_item_quantity ?? 0),
        readyquantity: String(record.readyquantity ?? 0),
        orderdata_status: String(record.orderdata_status ?? "0"),
        remark: String(record.remark ?? record.remarks ?? ""),
        remarks: String(record.remarks ?? record.remark ?? ""),
        packSize: scalarStringOrNumber(record.packSize ?? record.pack_size),
        totalPieces: scalarStringOrNumber(record.totalPieces ?? record.total_pieces),
        quantityPacks: scalarStringOrNumber(record.quantityPacks ?? record.quantity_packs),
      };
    });
  }

  if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown[] }).items)) {
    return normalizeItemsFromPayload(orderId, { data: [{ ...(raw as object) }] });
  }

  return [];
}

async function fetchOrderItems(orderId: string, actorCacheKey: string): Promise<PendingProductsItemRow[]> {
  const cacheKey = `${actorCacheKey}:${orderId}`;
  const cached = orderItemCache.get(cacheKey);
  const cacheVersion = getPendingProductsCacheVersion();
  if (cached && cached.cacheVersion === cacheVersion && Date.now() - cached.cachedAt < ORDER_ITEM_CACHE_TTL_MS) {
    return cached.items;
  }

  const payload = await fetchJson<{ data?: unknown }>(`${BACKEND_URL}/orderdatalist?id=${encodeURIComponent(orderId)}`);
  const overlay = await findOrderOverlay(orderId).catch(() => null);
  const latestEdit = overlay?.status !== "cancelled" && Array.isArray(overlay?.edits)
    ? overlay.edits[overlay.edits.length - 1]
    : null;
  const items = latestEdit?.effectiveItems?.length
    ? normalizeItemsFromPayload(orderId, { data: latestEdit.effectiveItems })
    : normalizeItemsFromPayload(orderId, payload);
  orderItemCache.set(cacheKey, { cachedAt: Date.now(), cacheVersion, items });
  return items;
}

async function mapWithConcurrencySettled<T, U>(items: T[], limit: number, mapper: (item: T) => Promise<U>) {
  const results = new Array<PromiseSettledResult<U>>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = {
          status: "fulfilled",
          value: await mapper(items[currentIndex]),
        };
      } catch (reason) {
        results[currentIndex] = {
          status: "rejected",
          reason,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker())
  );

  return results;
}

async function fetchDispatchRecordsByOrderIds(orderIds: string[]) {
  if (orderIds.length === 0) return {} as Record<string, Array<Partial<OrderDispatchRecord>>>;

  const db = await getDb();
  const collection = db.collection<OrderDispatchRecord>(DISPATCH_COLLECTION);
  const docs = await collection.find({ orderId: { $in: orderIds } }).toArray();

  return docs.reduce<Record<string, Array<Partial<OrderDispatchRecord>>>>((accumulator, record) => {
    const orderId = safeText(record.orderId, 120);
    if (!orderId) return accumulator;
    if (!accumulator[orderId]) accumulator[orderId] = [];
    accumulator[orderId].push(record);
    return accumulator;
  }, {});
}

async function loadBaseScope(actor: PendingProductsActor, refreshToken: string) {
  const actorCacheKey = `all-orders-v1:${actor.role}:${actor.actorId || "admin"}`;
  const cached = baseScopeCache.get(actorCacheKey);
  const cacheVersion = getPendingProductsCacheVersion();
  const forceRefresh = Boolean(refreshToken) && cached?.refreshToken !== refreshToken;
  if (!forceRefresh && cached && cached.cacheVersion === cacheVersion && Date.now() - cached.cachedAt < BASE_SCOPE_CACHE_TTL_MS) {
    return cached;
  }

  const warnings: string[] = [];
  const dealerDirectoryResult = await fetchDealerDirectory(actor).then(
    (rows) => ({ ok: true as const, rows }),
    () => ({ ok: false as const, rows: [] as PendingDealerDirectoryRow[] }),
  );

  const dealerDirectoryRows = dealerDirectoryResult.rows;
  if (!dealerDirectoryResult.ok && actor.role !== "dealer") {
    warnings.push(actor.role === "staff"
      ? "Dealer assignment metadata is temporarily unavailable, so no staff order data is shown."
      : "Dealer metadata is temporarily unavailable. Pending quantities remain accurate.");
  }

  const assignedDealerIds = dealerDirectoryRows
    .map((row) => safeText(row.Dealer_Id, 120))
    .filter(Boolean);
  const orders = await fetchRoleScopedOrders(actor, assignedDealerIds, forceRefresh);

  const scopedOrders = filterPendingOrdersByRoleScope({
    role: actor.role,
    actorId: actor.actorId,
    orders,
    assignedDealerIds,
  }).filter(isEligibleOrderForPendingProducts);

  const orderIds = scopedOrders
    .map((order) => safeText(order.order_id ?? order.orderId, 120))
    .filter(Boolean);

  const orderItemsByOrderId: Record<string, PendingProductsItemRow[]> = {};
  const orderItems = await mapWithConcurrencySettled(orderIds, ORDER_ITEM_CONCURRENCY, async (orderId) => ({
    orderId,
    items: await fetchOrderItems(orderId, actorCacheKey),
  }));

  let failedOrderDetailCount = 0;
  for (const result of orderItems) {
    if (result.status === "fulfilled") {
      orderItemsByOrderId[result.value.orderId] = result.value.items;
    } else {
      failedOrderDetailCount += 1;
      console.warn("[GET /api/pending-products] order detail failed", result.reason);
    }
  }

  if (failedOrderDetailCount > 0) {
    warnings.push("Some order details could not be loaded. Displayed totals may be incomplete.");
  }

  if (orderIds.length > 0 && failedOrderDetailCount === orderIds.length) {
    throw new PendingProductsError(502, "Pending product details could not be loaded from the order source.");
  }

  let dispatchRecordsByOrderId: Record<string, Array<Partial<OrderDispatchRecord>>> = {};
  try {
    dispatchRecordsByOrderId = await fetchDispatchRecordsByOrderIds(orderIds);
  } catch (error) {
    if (isMongoDependencyError(error)) {
      throw new PendingProductsError(503, "Dispatch data is currently unavailable, so pending quantities cannot be calculated reliably.");
    }
    throw error;
  }

  const lines = buildPendingProductLines({
    orders: scopedOrders,
    orderItemsByOrderId,
    dispatchRecordsByOrderId,
    dealerDirectoryById: buildDealerDirectoryMap(dealerDirectoryRows),
    catalogueProducts: Array.isArray(catalogueProducts) ? catalogueProducts : [],
  });

  const cachedScope = {
    cachedAt: Date.now(),
    cacheVersion,
    refreshToken,
    lines,
    warnings,
  };
  baseScopeCache.set(actorCacheKey, cachedScope);
  return cachedScope;
}

function parseSort(value: string) {
  if (value === "alphabetical" || value === "oldest_pending") return value;
  return "pending_desc";
}

export async function GET(req: NextRequest) {
  const actor = parseActor(req);
  if (!actor) {
    return NextResponse.json(
      { success: false, message: "Missing pending-products identity" },
      { status: 401 }
    );
  }

  const search = safeText(req.nextUrl.searchParams.get("search"), 240);
  const category = safeText(req.nextUrl.searchParams.get("category"), 120);
  const sort = parseSort(safeText(req.nextUrl.searchParams.get("sort"), 40));
  const dealerId = safeText(req.nextUrl.searchParams.get("dealerId"), 120);
  const assignedStaffId = safeText(req.nextUrl.searchParams.get("assignedStaffId"), 120);
  const productKey = safeText(req.nextUrl.searchParams.get("productKey"), 260);
  const page = safeInteger(req.nextUrl.searchParams.get("page"), 1);
  const pageSize = safeInteger(req.nextUrl.searchParams.get("pageSize"), 20);
  const refreshToken = safeText(req.nextUrl.searchParams.get("refreshToken"), 40);

  try {
    const baseScope = await loadBaseScope(actor, refreshToken);
    const scopedLines = filterPendingProductLines(baseScope.lines, { dealerId, assignedStaffId });
    const scopeSummary = buildPendingProductsSummaryFromLines(scopedLines);
    const filterOptions = buildPendingProductFilterOptions(scopedLines);
    const limitation =
      "Results are constrained inside this Next.js API, but the current application still relies on client-provided actor headers rather than a server-verifiable session.";

    if (productKey) {
      const detail = buildPendingProductDrilldown(scopedLines, productKey);
      if (!detail.aggregate) {
        return NextResponse.json(
          { success: false, message: "Pending product not found in your permitted scope." },
          { status: 404 }
        );
      }

      const paginatedOrders = paginatePendingProducts(detail.orders, page, pageSize);
      return NextResponse.json({
        success: true,
        data: {
          product: detail.aggregate,
          orders: paginatedOrders.items,
          summary: scopeSummary,
          filters: filterOptions,
          page: paginatedOrders.page,
          pageSize: paginatedOrders.pageSize,
          total: paginatedOrders.total,
          totalPages: paginatedOrders.totalPages,
          warnings: baseScope.warnings,
          limitation,
        },
      });
    }

    const aggregates = aggregatePendingProducts(scopedLines);
    const filteredAggregates = filterPendingProducts(aggregates, { search, category });
    const sortedAggregates = sortPendingProducts(filteredAggregates, sort);
    const paginatedProducts = paginatePendingProducts(sortedAggregates, page, pageSize);

    return NextResponse.json({
      success: true,
      data: {
        items: paginatedProducts.items,
        summary: scopeSummary,
        filters: filterOptions,
        page: paginatedProducts.page,
        pageSize: paginatedProducts.pageSize,
        total: paginatedProducts.total,
        totalPages: paginatedProducts.totalPages,
        warnings: baseScope.warnings,
        limitation,
      },
    });
  } catch (error) {
    console.error("[GET /api/pending-products]", error);

    if (error instanceof PendingProductsError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: error.status }
      );
    }

    const status = isMongoDependencyError(error) ? 503 : 500;
    return NextResponse.json(
      {
        success: false,
        message: status === 503
          ? "Pending products are unavailable because dispatch data could not be verified."
          : "Failed to load pending products.",
      },
      { status }
    );
  }
}
