import { NextRequest, NextResponse } from "next/server";
import { loadOrderHeaders, ORDER_HEADER_SOURCES } from "@/lib/orderHeaders";
import { buildOrdersPage } from "@/lib/orderPagination";
import { fetchStaffAssignedDealerIds, parseOrderActor } from "@/lib/orderScopeServer";
import { STAFF_ORDER_SCOPE_VERSION } from "@/lib/staffOrderScope.js";
import { getOrderOverlayCollection } from "@/lib/orderOverlays";

export const runtime = "nodejs";

function positiveInt(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, Math.floor(parsed))) : fallback;
}

export async function GET(req: NextRequest) {
  const requestStartedAt = performance.now();
  const source = String(req.nextUrl.searchParams.get("source") || "");
  if (!ORDER_HEADER_SOURCES.has(source)) {
    return NextResponse.json({ success: false, message: "Unsupported order source" }, { status: 400 });
  }

  const requestedPage = positiveInt(req.nextUrl.searchParams.get("page"), 1, 100_000);
  const requestedLimit = positiveInt(req.nextUrl.searchParams.get("limit"), 10, 1000);
  const actorId = String(req.nextUrl.searchParams.get("id") || "").slice(0, 120);
  const actor = parseOrderActor({
    role: String(req.nextUrl.searchParams.get("role") || "").toLowerCase(),
    actorId,
  });
  if (!actor) {
    return NextResponse.json({ success: false, message: "Missing order scope identity" }, { status: 401 });
  }

  try {
    const assignedDealerIds = actor.role === "staff"
      ? await fetchStaffAssignedDealerIds(actor.actorId)
      : [];
    const loaded = await loadOrderHeaders({ source, actor, assignedDealerIds });
    const cancelledOrderIds = await getOrderOverlayCollection()
      .then((collection) => collection
        .find({ status: "cancelled" }, { projection: { orderId: 1 } })
        .limit(5000)
        .toArray())
      .then((rows) => new Set(rows.map((row) => String(row.orderId ?? "").trim()).filter(Boolean)))
      .catch(() => new Set<string>());
    const activeRows = loaded.rows.filter((row) => {
      const orderId = String(row.order_id ?? row.orderId ?? "").trim();
      return !orderId || !cancelledOrderIds.has(orderId);
    });
    const amountMin = req.nextUrl.searchParams.has("amount_min")
      ? Number(req.nextUrl.searchParams.get("amount_min"))
      : null;
    const amountMax = req.nextUrl.searchParams.has("amount_max")
      ? Number(req.nextUrl.searchParams.get("amount_max"))
      : null;
    const page = buildOrdersPage({
      rows: activeRows,
      page: requestedPage,
      pageSize: requestedLimit,
      filters: {
        search: String(req.nextUrl.searchParams.get("search") || "").slice(0, 200),
        accepted: req.nextUrl.searchParams.get("accepted") ?? "",
        orderStatus: req.nextUrl.searchParams.get("order_status") ?? "",
        mtStatus: req.nextUrl.searchParams.get("mt_status") ?? "",
        orderId: req.nextUrl.searchParams.get("order_id") ?? "",
        dateFrom: req.nextUrl.searchParams.get("date_from") ?? "",
        dateTo: req.nextUrl.searchParams.get("date_to") ?? "",
        amountMin: amountMin !== null && Number.isFinite(amountMin) ? amountMin : null,
        amountMax: amountMax !== null && Number.isFinite(amountMax) ? amountMax : null,
        targetDealerId: req.nextUrl.searchParams.get("target_dealer") ?? "",
      },
    });
    const response = NextResponse.json({
      success: true,
      status: true,
      data: page.items,
      count: page.total,
      total: page.total,
      recordsTotal: page.total,
      recordsFiltered: page.total,
      last_page: page.totalPages,
      lastPage: page.totalPages,
      page: requestedPage,
      truncated: loaded.truncated,
      totalIsExact: loaded.totalIsExact,
      staffOrderScopeVersion: STAFF_ORDER_SCOPE_VERSION,
    });
    if (process.env.NODE_ENV !== "production") {
      const durationMs = Math.round(performance.now() - requestStartedAt);
      response.headers.set(
        "Server-Timing",
        `orders-data;dur=${durationMs};desc="upstream=${loaded.diagnostics.upstreamCalls}, headers=${loaded.diagnostics.upstreamHeaders}"`,
      );
    }
    return response;
  } catch (error) {
    console.error("[GET /api/orders-data]", error);
    return NextResponse.json({ success: false, message: "Unable to load orders" }, { status: 502 });
  }
}
