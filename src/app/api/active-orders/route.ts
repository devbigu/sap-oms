import { after, NextRequest, NextResponse } from "next/server";
import { ACTIVE_ORDER_PERIOD_VERSION } from "@/lib/activeOrderPeriod.js";
import {
  ACTIVE_ORDER_HEADER_SOURCES,
  ActiveOrderSnapshotUnavailableError,
  invalidateActiveOrderSnapshots,
  loadActiveOrderHeaders,
} from "@/lib/activeOrderSnapshot";
import { fetchStaffAssignedDealerIds, parseOrderActor } from "@/lib/orderScopeServer";
import { filterOrdersForActor, STAFF_ORDER_SCOPE_VERSION } from "@/lib/staffOrderScope.js";
import { buildActiveOrdersPage, scanScopedActiveOrders } from "@/lib/activeOrdersPagination";
import { isMongoDependencyError } from "@/lib/mongodb";

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
  const requestStartedAt = performance.now();
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
    let sourceRows: Record<string, unknown>[];
    let truncated = false;
    let totalIsExact = true;
    let snapshotState = "bypass";
    let upstreamCalls = 0;
    let upstreamHeaders = 0;

    if (ACTIVE_ORDER_HEADER_SOURCES.has(source)) {
      const loaded = await loadActiveOrderHeaders({ source, actor, assignedDealerIds });
      if (loaded.refreshPromise) after(() => loaded.refreshPromise ?? Promise.resolve(null));
      sourceRows = filterOrdersForActor({
        role: actor.role,
        actorId: actor.actorId,
        assignedDealerIds,
        orders: loaded.rows,
      });
      snapshotState = loaded.state;
      upstreamCalls = loaded.state === "refreshed" ? loaded.diagnostics.upstreamCalls : 0;
      upstreamHeaders = loaded.state === "refreshed" ? loaded.diagnostics.upstreamHeaders : 0;
    } else {
      const upstreamActorIds = actor.role === "staff" ? assignedDealerIds : [actorId];
      const scan = await scanScopedActiveOrders<Record<string, unknown>>({
        actor,
        assignedDealerIds,
        upstreamActorIds,
        upstreamPageSize: UPSTREAM_PAGE_SIZE,
        maxUpstreamPages: MAX_UPSTREAM_PAGES,
        fetchPage: async (upstreamActorId, page, pageSize) => {
          const params = new URLSearchParams({ page: String(page), limit: String(pageSize), search: "" });
          if (upstreamActorId) params.set("id", upstreamActorId);
          const response = await fetch(`${BACKEND_URL}/${source}?${params.toString()}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error(`${source} failed with ${response.status}`);
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
      sourceRows = scan.rows;
      truncated = scan.truncated;
      totalIsExact = scan.totalIsExact;
      upstreamCalls = scan.pageCalls.length;
    }
    const amountMin = req.nextUrl.searchParams.has("amount_min")
      ? Number(req.nextUrl.searchParams.get("amount_min"))
      : null;
    const amountMax = req.nextUrl.searchParams.has("amount_max")
      ? Number(req.nextUrl.searchParams.get("amount_max"))
      : null;
    const visiblePage = buildActiveOrdersPage({
      rows: sourceRows,
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
    const response = NextResponse.json({
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
      truncated,
      totalIsExact,
      snapshotState,
      activeOrderPeriodVersion: ACTIVE_ORDER_PERIOD_VERSION,
      staffOrderScopeVersion: STAFF_ORDER_SCOPE_VERSION,
    });
    if (process.env.NODE_ENV !== "production") {
      const durationMs = Math.round(performance.now() - requestStartedAt);
      response.headers.set(
        "Server-Timing",
        `active-orders;dur=${durationMs};desc="${snapshotState}, upstream=${upstreamCalls}, headers=${upstreamHeaders}"`,
      );
      console.info("[GET /api/active-orders]", {
        source,
        role: actor.role,
        snapshotState,
        upstreamCalls,
        upstreamHeaders,
        durationMs,
      });
    }
    return response;
  } catch (error) {
    console.error("[GET /api/active-orders]", error);
    if (error instanceof ActiveOrderSnapshotUnavailableError || isMongoDependencyError(error)) {
      return NextResponse.json(
        { success: false, message: "Active orders are synchronizing. Please try again shortly." },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    return NextResponse.json({ success: false, message: "Unable to load active orders" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({})) as { reason?: unknown };
    const reason = String(payload.reason ?? "order-header mutation").trim().slice(0, 120);
    const invalidated = await invalidateActiveOrderSnapshots(reason);
    return NextResponse.json({ success: true, invalidated });
  } catch (error) {
    console.error("[POST /api/active-orders]", error);
    return NextResponse.json({ success: false, message: "Unable to refresh active orders" }, { status: 503 });
  }
}
