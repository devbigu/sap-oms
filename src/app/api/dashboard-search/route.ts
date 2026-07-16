import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_ORDER_PERIOD_VERSION, filterActiveOrders } from "@/lib/activeOrderPeriod.js";
import catalogueProducts from "../../../../public/data/omsons_products_from_excel_with_images.json";
import dashboardSearch from "@/lib/dashboardSearch.js";
import { filterOrdersForActor } from "@/lib/staffOrderScope.js";

export const runtime = "nodejs";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const ORDER_ITEM_CACHE_TTL_MS = 5 * 60 * 1000;

type DashboardRole = "admin" | "staff" | "dealer";

type DashboardActor = {
  role: DashboardRole;
  actorId: string;
  roletype: string;
};

type SearchResponse = {
  success: boolean;
  query: string;
  results: unknown[];
  groups: Record<string, unknown[]>;
  limitation?: string;
};

type DealerRow = Record<string, unknown> & {
  Dealer_Id?: string;
  Dealer_Name?: string;
  Dealer_Dealercode?: string;
  Dealer_City?: string;
  staffname?: string;
};

type StaffRow = Record<string, unknown> & {
  staff_id?: string;
  staff_name?: string;
  staff_email?: string;
  staff_roletype?: string;
};

type OrderRow = Record<string, unknown> & {
  order_id?: string;
  order_date?: string;
  orderDate?: string;
  Dealer_Name?: string;
  order_status?: string;
  status?: string;
  order_amount?: string | number;
  order_net_amount?: string | number;
  netPayableAmount?: string | number;
  order_dealer?: string;
  orderdata_dealerid?: string;
  Dealer_Id?: string;
};

type StaffDealerResponse = {
  data?: DealerRow[];
};

const orderItemSummaryCache = new Map<string, {
  cachedAt: number;
  searchText: string;
}>();

function safeText(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseActor(req: NextRequest): DashboardActor | null {
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
    throw new Error(`External API failed with ${response.status}`);
  }

  if (/^\s*</.test(responseText)) {
    throw new Error("External API returned HTML instead of JSON");
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error("External API returned invalid JSON");
  }
}

async function fetchOrders(urls: string[]): Promise<OrderRow[]> {
  const settled = await Promise.allSettled(urls.map(async (url) => {
    const pages: OrderRow[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const pageUrl = url.replace(/([?&])page=\d+/, `$1page=${page}`);
      const response = await fetchJson<{ data?: OrderRow[]; last_page?: number }>(pageUrl);
      const pageRows = Array.isArray(response.data) ? response.data : [];
      pages.push(...pageRows);
      const lastPage = Number(response.last_page ?? 0);
      if (pageRows.length < 25 || (lastPage > 0 && page >= lastPage)) break;
    }
    return pages;
  }));
  const rows: OrderRow[] = [];
  const seen = new Set<string>();

  for (const entry of settled) {
    if (entry.status !== "fulfilled") continue;
    for (const row of entry.value) {
      const orderId = safeText(String(row.order_id ?? ""));
      if (!orderId || seen.has(orderId)) continue;
      seen.add(orderId);
      rows.push(row);
    }
  }

  return rows;
}

async function fetchStaffAssignedDealerIds(staffId: string) {
  const json = await fetchJson<StaffDealerResponse>(`${BACKEND_URL}/staffDealers?id=${encodeURIComponent(staffId)}`);
  return new Set(
    (Array.isArray(json.data) ? json.data : [])
      .map((dealer) => safeText(String(dealer.Dealer_Id ?? "")))
      .filter(Boolean)
  );
}

async function fetchCandidateOrders(actor: DashboardActor, query: string) {
  const queryInfo = dashboardSearch.getDashboardQueryInfo(query);
  const queryTerms = Array.from(new Set([
    queryInfo.rawQuery,
    queryInfo.orderInfo.exactOrderId,
  ].map((term) => safeText(term, 120)).filter(Boolean)));

  if (queryTerms.length === 0) return [];

  if (actor.role === "admin") {
    return fetchOrders(
      queryTerms.map((term) =>
        `${BACKEND_URL}/orderpegination?page=1&limit=25&search=${encodeURIComponent(term)}`
      )
    );
  }

  if (actor.role === "staff") {
    const [orders, assignedDealerIds] = await Promise.all([
      fetchOrders(
        queryTerms.map((term) =>
          `${BACKEND_URL}/staffOrderrPagination?page=1&limit=25&search=${encodeURIComponent(term)}&id=${encodeURIComponent(actor.actorId)}`
        )
      ),
      fetchStaffAssignedDealerIds(actor.actorId),
    ]);

    if (assignedDealerIds.size === 0) return [];

    return orders.filter((order) => {
      const dealerId = safeText(String(order.order_dealer ?? order.orderdata_dealerid ?? order.Dealer_Id ?? ""));
      return dealerId ? assignedDealerIds.has(dealerId) : false;
    });
  }

  const orders = await fetchOrders(
    queryTerms.map((term) =>
      `${BACKEND_URL}/orderhispegination?page=1&limit=25&search=${encodeURIComponent(term)}&id=${encodeURIComponent(actor.actorId)}`
    )
  );
  return filterOrdersForActor({ role: "dealer", actorId: actor.actorId, orders });
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string) {
  return collapseWhitespace(value.replace(/<[^>]*>/g, " "));
}

function normalizeText(value: string) {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9/+\-.()\s]+/g, " ");
}

function collectItemSearchText(rows: Record<string, unknown>[]) {
  return normalizeText(
    rows
      .map((row) => [
        safeText(String(row.orderdata_cat_no ?? row.catNo ?? row.productId ?? ""), 120),
        safeText(String(row.product_name ?? row.productName ?? row.order_item_description ?? ""), 240),
      ].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(" ")
  );
}

async function fetchOrderItemSearchText(orderId: string, actor: DashboardActor) {
  const cacheKey = `${ACTIVE_ORDER_PERIOD_VERSION}:${actor.role}:${actor.actorId || "admin"}:${orderId}`;
  const cached = orderItemSummaryCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < ORDER_ITEM_CACHE_TTL_MS) {
    return cached.searchText;
  }

  const json = await fetchJson<{ data?: unknown }>(
    `${BACKEND_URL}/orderdatalist?id=${encodeURIComponent(orderId)}`
  );
  const raw = json.data;

  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    if (raw.length > 0 && typeof raw[0] === "object" && raw[0] && Array.isArray((raw[0] as { items?: unknown[] }).items)) {
      rows = ((raw[0] as { items?: unknown[] }).items ?? []).filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
    } else {
      rows = raw.filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
    }
  } else if (typeof raw === "object" && raw !== null && Array.isArray((raw as { items?: unknown[] }).items)) {
    rows = ((raw as { items?: unknown[] }).items ?? []).filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
  }

  const searchText = collectItemSearchText(rows);
  orderItemSummaryCache.set(cacheKey, { cachedAt: Date.now(), searchText });
  return searchText;
}

async function buildItemSummariesByOrderId(orders: OrderRow[], query: string, actor: DashboardActor) {
  const queryInfo = dashboardSearch.getDashboardQueryInfo(query);
  const orderIds = orders
    .map((order) => safeText(String(order.order_id ?? "")))
    .filter(Boolean)
    .slice(0, 12);

  const settled = await Promise.allSettled(
    orderIds.map(async (orderId) => {
      const searchText = await fetchOrderItemSearchText(orderId, actor);
      const normalizedQuery = normalizeText(queryInfo.normalizedText);
      const matchedByItemText = Boolean(
        normalizedQuery &&
        searchText.includes(normalizedQuery)
      );

      let matchedLabel = "";
      if (matchedByItemText) {
        const prettyWords = queryInfo.keywords.slice(0, 3).join(" ");
        matchedLabel = prettyWords || queryInfo.rawQuery;
      }

      return [
        orderId,
        {
          searchText,
          matchedByItemText,
          matchedLabel,
        },
      ] as const;
    })
  );

  const map: Record<string, { searchText?: string; matchedByItemText?: boolean; matchedLabel?: string }> = {};
  for (const entry of settled) {
    if (entry.status !== "fulfilled") continue;
    const [orderId, summary] = entry.value;
    map[orderId] = summary;
  }
  return map;
}

async function fetchAdminDealers(query: string) {
  const json = await fetchJson<{ data?: DealerRow[] }>(
    `${BACKEND_URL}/dealerpegination?page=1&limit=10&search=${encodeURIComponent(query)}`
  );
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchAdminStaff(query: string) {
  const json = await fetchJson<{ data?: StaffRow[] }>(
    `${BACKEND_URL}/staffpegination?page=1&limit=10&search=${encodeURIComponent(query)}`
  );
  return Array.isArray(json.data) ? json.data : [];
}

function emptyResponse(query: string, limitation?: string): SearchResponse {
  return {
    success: true,
    query,
    results: [],
    groups: {
      products: [],
      orders: [],
      dealers: [],
      staff: [],
    },
    ...(limitation ? { limitation } : {}),
  };
}

export async function GET(req: NextRequest) {
  const query = safeText(req.nextUrl.searchParams.get("q"), 240);
  const actor = parseActor(req);

  if (!actor) {
    return NextResponse.json(
      { success: false, message: "Missing dashboard search identity" },
      { status: 401 }
    );
  }

  const queryInfo = dashboardSearch.getDashboardQueryInfo(query);
  if (!queryInfo.canSearch) {
    return NextResponse.json(emptyResponse(query));
  }

  try {
    const candidateOrdersPromise = fetchCandidateOrders(actor, query);
    const dealersPromise = actor.role === "admin" ? fetchAdminDealers(query) : Promise.resolve([]);
    const staffPromise = actor.role === "admin" ? fetchAdminStaff(query) : Promise.resolve([]);
    const candidateOrders = filterActiveOrders(await candidateOrdersPromise);
    const [dealers, staff, itemSummariesByOrderId] = await Promise.all([
      dealersPromise,
      staffPromise,
      buildItemSummariesByOrderId(candidateOrders, query, actor),
    ]);

    const response = dashboardSearch.buildDashboardSearchResponse({
      role: actor.role,
      query,
      products: Array.isArray(catalogueProducts) ? catalogueProducts : [],
      orders: candidateOrders,
      dealers,
      staff,
      itemSummariesByOrderId,
    });

    return NextResponse.json({
      success: true,
      query,
      results: response.results,
      groups: response.groups,
      limitation:
        "Results are filtered in this Next.js API, but the current app does not expose a server-verifiable login session for stronger authorization.",
    } satisfies SearchResponse);
  } catch (error) {
    console.error("[GET /api/dashboard-search]", error);
    return NextResponse.json(
      { success: false, message: "Dashboard search is unavailable right now." },
      { status: 500 }
    );
  }
}
