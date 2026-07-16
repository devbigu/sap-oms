import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_ORDER_PERIOD_VERSION } from "@/lib/activeOrderPeriod.js";
import { fetchStaffAssignedDealerIds, parseOrderActor } from "@/lib/orderScopeServer";
import { STAFF_ORDER_SCOPE_VERSION } from "@/lib/staffOrderScope.js";
import { buildActiveOrdersPage, scanScopedActiveOrders } from "@/lib/activeOrdersPagination";

export const runtime = "nodejs";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const SOURCES = new Set([
  "orderpegination",
  "orderhispegination",
  "orderpeginationnew",
  "staffOrderrPagination",
  "Orderstspegination",
]);
const UPSTREAM_PAGE_SIZE = 200;
const MAX_UPSTREAM_PAGES = 100;

function positiveInt(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, Math.floor(parsed))) : fallback;
}

export async function GET(req: NextRequest) {
  const source = String(req.nextUrl.searchParams.get("source") || "");
  if (!SOURCES.has(source)) {
    return NextResponse.json({ success: false, message: "Unsupported order source" }, { status: 400 });
  }

  const requestedPage = positiveInt(req.nextUrl.searchParams.get("page"), 1, 100_000);
  const requestedLimit = positiveInt(req.nextUrl.searchParams.get("limit"), 10, 1000);
  const search = String(req.nextUrl.searchParams.get("search") || "").slice(0, 200);
  const actorId = String(req.nextUrl.searchParams.get("id") || "").slice(0, 120);
  const targetDealerId = String(req.nextUrl.searchParams.get("target_dealer") || "").trim().slice(0, 120);
  const requestedRole = String(req.nextUrl.searchParams.get("role") || "").toLowerCase();
  const actor = parseOrderActor({ role: requestedRole, actorId });
  if (!actor) {
    return NextResponse.json({ success: false, message: "Missing order scope identity" }, { status: 401 });
  }
  try {
    const assignedDealerIds = actor.role === "staff"
      ? await fetchStaffAssignedDealerIds(actor.actorId)
      : [];
    const upstreamActorIds = actor.role === "staff"
      ? source === "staffOrderrPagination"
        ? [actor.actorId]
        : source === "Orderstspegination" || source === "orderhispegination"
          ? assignedDealerIds
          : [""]
      : [actorId];

    const scan = await scanScopedActiveOrders<Record<string, unknown>>({
      actor,
      assignedDealerIds,
      upstreamActorIds,
      upstreamPageSize: UPSTREAM_PAGE_SIZE,
      maxUpstreamPages: MAX_UPSTREAM_PAGES,
      fetchPage: async (upstreamActorId, page, pageSize) => {
        const params = new URLSearchParams({ page: String(page), limit: String(pageSize), search: "" });
        if (upstreamActorId) params.set("id", upstreamActorId);
        const response = await fetch(`${BACKEND_URL}/${source}?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`${source} failed with ${response.status}`);
        const payload = await response.json();
        const rows: Record<string, unknown>[] = Array.isArray(payload?.data)
          ? payload.data.filter((row: unknown): row is Record<string, unknown> => !!row && typeof row === "object")
          : [];
        return {
          rows,
          lastPage: Number(payload?.last_page ?? payload?.lastPage ?? 0),
        };
      },
    });
    const amountMin = req.nextUrl.searchParams.has("amount_min")
      ? Number(req.nextUrl.searchParams.get("amount_min"))
      : null;
    const amountMax = req.nextUrl.searchParams.has("amount_max")
      ? Number(req.nextUrl.searchParams.get("amount_max"))
      : null;
    const visiblePage = buildActiveOrdersPage({
      rows: scan.rows,
      page: requestedPage,
      pageSize: requestedLimit,
      filters: {
        search,
        accepted: req.nextUrl.searchParams.get("accepted") ?? "",
        orderStatus: req.nextUrl.searchParams.get("order_status") ?? "",
        mtStatus: req.nextUrl.searchParams.get("mt_status") ?? "",
        orderId: req.nextUrl.searchParams.get("order_id") ?? "",
        dateFrom: req.nextUrl.searchParams.get("date_from") ?? "",
        dateTo: req.nextUrl.searchParams.get("date_to") ?? "",
        amountMin: amountMin !== null && Number.isFinite(amountMin) ? amountMin : null,
        amountMax: amountMax !== null && Number.isFinite(amountMax) ? amountMax : null,
        targetDealerId,
      },
    });
    return NextResponse.json({
      success: true,
      status: true,
      data: visiblePage.items,
      count: visiblePage.total,
      total: visiblePage.total,
      recordsTotal: visiblePage.total,
      recordsFiltered: visiblePage.total,
      last_page: visiblePage.totalPages,
      lastPage: visiblePage.totalPages,
      page: requestedPage,
      truncated: scan.truncated,
      totalIsExact: scan.totalIsExact,
      activeOrderPeriodVersion: ACTIVE_ORDER_PERIOD_VERSION,
      staffOrderScopeVersion: STAFF_ORDER_SCOPE_VERSION,
    });
  } catch (error) {
    console.error("[GET /api/active-orders]", error);
    return NextResponse.json({ success: false, message: "Unable to load active orders" }, { status: 502 });
  }
}
