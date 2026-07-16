import { NextRequest, NextResponse } from "next/server";
import { loadActiveOrderHeaders } from "@/lib/activeOrderSnapshot";
import catalogueProducts from "../../../../../public/data/omsons_products_from_excel_with_images.json";
import dealerCategoryReport from "@/lib/dealerCategoryReport";
import dealerCategoryReportAccess from "@/lib/dealerCategoryReportAccess";
import { getPhpApiBaseUrl } from "@/lib/phpBackend";

export const runtime = "nodejs";

const BACKEND_URL = getPhpApiBaseUrl();
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
  orderId?: string;
  order_date?: string;
  orderDate?: string;
  order_dealer?: string;
  orderdata_dealerid?: string;
  Dealer_Id?: string;
  Dealer_Name?: string;
  accept_order?: string;
  del_status?: string;
  order_status?: string;
  mtstatus?: string;
  reason?: string;
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
    dealer?: NormalizedDealer;
    dealerId?: string;
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
    products: unknown[];
    categories: unknown[];
    warnings: unknown[];
    meta: Record<string, unknown>;
  };
};

const accessHelper = dealerCategoryReportAccess as unknown as {
  normalizeDealerRecord: (row: DealerRow) => NormalizedDealer;
  canStaffAccessDealer: (assignedDealers: NormalizedDealer[], dealerId: string) => boolean;
};

class DealerCategoryReportError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DealerCategoryReportError";
    this.status = status;
  }
}

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
    throw new DealerCategoryReportError(502, `External API failed with ${response.status}`);
  }

  if (/^\s*</.test(text)) {
    throw new DealerCategoryReportError(502, "External API returned HTML instead of JSON");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DealerCategoryReportError(502, "External API returned invalid JSON");
  }
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

  const json = await fetchJson<{ data?: DealerRow[] | DealerRow; status?: boolean }>(
    `${BACKEND_URL}/getdealer?id=${encodeURIComponent(dealerId)}`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "type" }),
    }
  );
  const rows = Array.isArray(json.data) ? json.data : json.data && typeof json.data === "object" ? [json.data] : [];
  return rows.map(accessHelper.normalizeDealerRecord).find((dealer) => dealer.Dealer_Id === dealerId) ?? null;
}

async function fetchDealerOrders(dealerId: string) {
  const loaded = await loadActiveOrderHeaders({
    source: "orderhispegination",
    actor: { role: "dealer", actorId: dealerId },
  });
  return loaded.rows as OrderHeader[];
}

function normalizeOrderItems(orderId: string, raw: unknown) {
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
    product_name: safeText(item.productName ?? item.product_name ?? item.order_item_description, 240),
    product_discription: safeText(item.productDescription ?? item.product_discription ?? item.order_item_description, 400),
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

function extractInlineOrderItems(order: OrderHeader) {
  return normalizeOrderItems(
    safeText(order.order_id ?? order.orderId, 120),
    order.items ?? order.products ?? order.orderItems ?? order.order_items
  );
}

async function fetchOrderItems(orderId: string) {
  const json = await fetchJson<{ data?: unknown }>(
    `${BACKEND_URL}/orderdatalist?id=${encodeURIComponent(orderId)}`
  );
  return normalizeOrderItems(orderId, json.data);
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
      dealer,
      dealerId,
      orders,
      orderItemsByOrderId: {},
      catalogueProducts: [],
      fromDate,
      toDate,
      statusFilter,
    }).filteredOrders;

    const failedOrderIds: string[] = [];
    const orderItemsByOrderId: Record<string, Record<string, unknown>[]> = {};
    const ordersNeedingDetail: OrderHeader[] = [];

    for (const order of uniqueOrders) {
      const orderId = safeText(order.order_id ?? order.orderId, 120);
      if (!orderId) continue;
      const inlineItems = extractInlineOrderItems(order);
      if (inlineItems.length > 0) {
        orderItemsByOrderId[orderId] = inlineItems;
      } else {
        ordersNeedingDetail.push(order);
      }
    }

    await mapWithConcurrency(
      ordersNeedingDetail,
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
      products: report.products,
      categories: report.categories,
      warnings: report.warnings,
      meta: {
        ...report.meta,
        dealerId,
        role: actor.role,
        orderRouteBase: "/orders",
        statusFilter,
        orderListEndpoint: "orderhispegination",
        orderListMethod: "GET",
        orderListIdentifier: "id",
        orderDetailEndpoint: "orderdatalist",
        orderDetailMethod: "GET",
        orderDetailIdentifier: "id",
        orderHeaderSource: "active-order snapshot",
        orderItemConcurrency: ORDER_ITEM_CONCURRENCY,
        inlineOrderItemOrderCount: uniqueOrders.length - ordersNeedingDetail.length,
        detailFetchedOrderCount: ordersNeedingDetail.length,
        includedOrderRule: "All non-cancelled/non-rejected orders; accepted and completed filters narrow from that eligible set.",
      },
    });
  } catch (error) {
    console.error("[GET /api/reports/dealer-category]", error);
    if (error instanceof DealerCategoryReportError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: error.status }
      );
    }

    return NextResponse.json(
      { success: false, message: "Unable to fetch this dealer's order history." },
      { status: 500 }
    );
  }
}
