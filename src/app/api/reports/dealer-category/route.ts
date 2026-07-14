import { NextRequest, NextResponse } from "next/server";
import catalogueProducts from "../../../../../public/data/nested_omsons_products.json";
import dealerCategoryReport from "@/lib/dealerCategoryReport";
import dealerCategoryReportAccess from "@/lib/dealerCategoryReportAccess";
import { getPhpApiBaseUrl } from "@/lib/phpBackend";

export const runtime = "nodejs";

const BACKEND_URL = getPhpApiBaseUrl();
const ORDER_PAGE_SIZE = 1000;
const MAX_ORDER_PAGES = 25;
const ORDER_ITEM_CONCURRENCY = 5;

type ReportActor = {
  role: "admin" | "staff";
  actorId: string;
};

type DealerRow = Record<string, unknown> & {
  Dealer_Id?: string;
  Dealer_Name?: string;
  Dealer_City?: string;
  Dealer_Number?: string;
  Dealer_Dealercode?: string;
  assignedstaff?: string;
  staffname?: string;
};

type OrderHeader = Record<string, unknown> & {
  order_id?: string;
  order_date?: string;
  orderDate?: string;
  order_dealer?: string;
  Dealer_Name?: string;
  accept_order?: string;
  del_status?: string;
  order_status?: string;
  mtstatus?: string;
  reason?: string;
};

type OrderListResponse = {
  data?: OrderHeader[];
  last_page?: number;
  count?: number;
};

type NormalizedDealer = {
  Dealer_Id: string;
  Dealer_Name: string;
  Dealer_City?: string;
  Dealer_Number?: string;
  Dealer_Dealercode?: string;
  assignedstaff?: string;
  staffname?: string;
};

const reportHelper = dealerCategoryReport as unknown as {
  buildDealerPurchaseLines: (input: {
    orders: OrderHeader[];
    orderItemsByOrderId: Record<string, Record<string, unknown>[]>;
    catalogueProducts: unknown[];
    fromDate?: string;
    toDate?: string;
    statusFilter?: string;
  }) => {
    filteredOrders: OrderHeader[];
    lines: unknown[];
  };
  buildDealerCategoryReport: (input: {
    dealer: NormalizedDealer;
    orders: OrderHeader[];
    orderItemsByOrderId: Record<string, Record<string, unknown>[]>;
    catalogueProducts: unknown[];
    fromDate?: string;
    toDate?: string;
    statusFilter?: string;
    failedOrderIds?: string[];
  }) => {
    dealer: NormalizedDealer | null;
    summary: Record<string, unknown>;
    categories: unknown[];
    warnings: unknown[];
    meta: Record<string, unknown>;
  };
};

const accessHelper = dealerCategoryReportAccess as unknown as {
  normalizeDealerRecord: (row: DealerRow) => NormalizedDealer;
  canStaffAccessDealer: (assignedDealers: NormalizedDealer[], dealerId: string) => boolean;
};

function safeText(value: unknown, max = 240) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : String(value ?? "").trim().slice(0, max);
}

function parseActor(req: NextRequest): ReportActor | null {
  const role = safeText(req.headers.get("x-omsons-actor-role"), 20).toLowerCase();
  const actorId = safeText(req.headers.get("x-omsons-actor-id"), 120);

  if (role !== "admin" && role !== "staff") return null;
  if (role === "staff" && !actorId) return null;

  return {
    role,
    actorId,
  } as ReportActor;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`External API failed with ${response.status}`);
  }

  if (/^\s*</.test(text)) {
    throw new Error("External API returned HTML instead of JSON");
  }

  return JSON.parse(text) as T;
}

async function fetchStaffDealers(staffId: string) {
  const json = await fetchJson<{ data?: DealerRow[] }>(
    `${BACKEND_URL}/staffDealers?id=${encodeURIComponent(staffId)}`
  );

  return (Array.isArray(json.data) ? json.data : []).map(accessHelper.normalizeDealerRecord);
}

async function fetchDealerById(dealerId: string, staffScopedDealers: NormalizedDealer[] = []) {
  const scoped = staffScopedDealers.find((dealer) => dealer.Dealer_Id === dealerId);
  if (scoped) return scoped;

  const json = await fetchJson<{ data?: DealerRow[] }>(
    `${BACKEND_URL}/getdealer?id=${encodeURIComponent(dealerId)}`,
    { method: "POST" }
  );
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map(accessHelper.normalizeDealerRecord).find((dealer) => dealer.Dealer_Id === dealerId) ?? null;
}

async function fetchDealerOrders(dealerId: string) {
  const first = await fetchJson<OrderListResponse>(
    `${BACKEND_URL}/orderhispegination?page=1&limit=${ORDER_PAGE_SIZE}&search=&id=${encodeURIComponent(dealerId)}`
  );

  const rows = Array.isArray(first.data) ? first.data : [];
  const total = Number(first.count ?? rows.length);
  const inferredLastPage = total > rows.length
    ? Math.ceil(total / Math.max(rows.length, 1))
    : 1;
  const lastPage = Math.min(
    MAX_ORDER_PAGES,
    Math.max(1, Number(first.last_page ?? inferredLastPage ?? 1))
  );

  if (lastPage <= 1 || rows.length === 0) return rows;

  const pages = await Promise.all(
    Array.from({ length: lastPage - 1 }, async (_unused, index) => {
      const page = index + 2;
      const json = await fetchJson<OrderListResponse>(
        `${BACKEND_URL}/orderhispegination?page=${page}&limit=${ORDER_PAGE_SIZE}&search=&id=${encodeURIComponent(dealerId)}`
      );
      return Array.isArray(json.data) ? json.data : [];
    })
  );

  return [...rows, ...pages.flat()];
}

async function fetchOrderItems(orderId: string) {
  const json = await fetchJson<{ data?: unknown }>(
    `${BACKEND_URL}/orderdatalist?id=${encodeURIComponent(orderId)}`
  );
  const raw = json.data;

  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (raw.length > 0 && typeof first === "object" && first && Array.isArray((first as { items?: unknown[] }).items)) {
      rows = ((first as { items?: unknown[] }).items ?? [])
        .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
    } else {
      rows = raw.filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
    }
  } else if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown[] }).items)) {
    rows = ((raw as { items?: unknown[] }).items ?? [])
      .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
  }

  return rows.map((item, index) => ({
    orderdata_id: safeText(item.orderdata_id ?? item.id ?? item.productId ?? `${orderId}-${index}`, 120),
    orderdata_orderid: safeText(item.orderdata_orderid ?? item.orderId ?? orderId, 120),
    orderdata_cat_no: safeText(item.orderdata_cat_no ?? item.catNo ?? item.productId ?? item.product_cat, 120),
    orderdata_item_quantity: item.quantityPacks ?? item.quantity ?? item.orderdata_item_quantity ?? 0,
    orderdata_price: item.unitPrice ?? item.unit_price ?? item.orderdata_price ?? 0,
    orderdata_discount: item.discountAmount ?? item.discount_amount ?? item.orderdata_discount ?? 0,
    orderdata_afterDisPrice: item.finalPrice ?? item.final_price ?? item.orderdata_afterDisPrice ?? item.orderdata_totalprice ?? 0,
    product_name: safeText(item.productName ?? item.product_name, 240),
    product_discription: safeText(item.productDescription ?? item.product_discription, 400),
    packSize: item.packSize ?? item.pack_size ?? undefined,
    totalPieces: item.totalPieces ?? item.total_pieces ?? undefined,
    quantityPacks: item.quantityPacks ?? item.quantity ?? undefined,
    category: item.category ?? item.product_category ?? item.productCategory ?? undefined,
    product_category: item.product_category ?? undefined,
    productCategory: item.productCategory ?? undefined,
    unitPrice: item.unitPrice ?? item.unit_price ?? undefined,
    listPriceTotal: item.listPriceTotal ?? item.list_price_total ?? undefined,
    discountAmount: item.discountAmount ?? item.discount_amount ?? undefined,
    finalPrice: item.finalPrice ?? item.final_price ?? undefined,
  }));
}

async function mapWithConcurrency<T, R>(
  rows: T[],
  concurrency: number,
  worker: (row: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(rows.length);
  let pointer = 0;

  const runners = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (true) {
      const current = pointer;
      pointer += 1;
      if (current >= rows.length) return;
      results[current] = await worker(rows[current], current);
    }
  });

  await Promise.all(runners);
  return results;
}

export async function GET(req: NextRequest) {
  const actor = parseActor(req);
  if (!actor) {
    return NextResponse.json(
      { success: false, message: "Missing report identity" },
      { status: 401 }
    );
  }

  const dealerId = safeText(req.nextUrl.searchParams.get("dealerId"), 120);
  const fromDate = safeText(req.nextUrl.searchParams.get("from"), 20);
  const toDate = safeText(req.nextUrl.searchParams.get("to"), 20);
  const requestedStatus = safeText(req.nextUrl.searchParams.get("status"), 20).toLowerCase();
  const statusFilter = requestedStatus === "accepted" || requestedStatus === "completed"
    ? requestedStatus
    : "all";

  if (!dealerId) {
    return NextResponse.json(
      { success: false, message: "Dealer ID is required" },
      { status: 400 }
    );
  }

  try {
    const staffDealers = actor.role === "staff"
      ? await fetchStaffDealers(actor.actorId)
      : [];

    if (actor.role === "staff" && !accessHelper.canStaffAccessDealer(staffDealers, dealerId)) {
      return NextResponse.json(
        { success: false, message: "You are not allowed to view this dealer report." },
        { status: 403 }
      );
    }

    const dealer = await fetchDealerById(dealerId, staffDealers);
    if (!dealer) {
      return NextResponse.json(
        { success: false, message: "Dealer not found." },
        { status: 404 }
      );
    }

    const orders = await fetchDealerOrders(dealerId);
    const uniqueOrders = reportHelper.buildDealerPurchaseLines({
      orders,
      orderItemsByOrderId: {},
      catalogueProducts: [],
      fromDate,
      toDate,
      statusFilter,
    }).filteredOrders;

    const failedOrderIds: string[] = [];
    const orderItemsByOrderId: Record<string, Record<string, unknown>[]> = {};

    await mapWithConcurrency(
      uniqueOrders,
      ORDER_ITEM_CONCURRENCY,
      async (order) => {
        const orderId = safeText(order.order_id ?? order.orderId, 120);
        if (!orderId) return;

        try {
          orderItemsByOrderId[orderId] = await fetchOrderItems(orderId);
        } catch (error) {
          failedOrderIds.push(orderId);
          console.error("[dealer-category orderdatalist]", orderId, error);
          orderItemsByOrderId[orderId] = [];
        }
      }
    );

    const report = reportHelper.buildDealerCategoryReport({
      dealer,
      orders,
      orderItemsByOrderId,
      catalogueProducts: Array.isArray(catalogueProducts) ? catalogueProducts : [],
      fromDate,
      toDate,
      statusFilter,
      failedOrderIds,
    });

    return NextResponse.json({
      success: true,
      dealer: report.dealer,
      summary: report.summary,
      categories: report.categories,
      warnings: report.warnings,
      meta: {
        ...report.meta,
        dealerId,
        role: actor.role,
        orderRouteBase: "/orders",
        statusFilter,
      },
    });
  } catch (error) {
    console.error("[GET /api/reports/dealer-category]", error);
    return NextResponse.json(
      { success: false, message: "Dealer category report is unavailable right now." },
      { status: 500 }
    );
  }
}
