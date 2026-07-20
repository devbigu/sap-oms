import { NextRequest, NextResponse } from "next/server";
import { fetchStaffAssignedDealerIds, parseOrderActor } from "@/lib/orderScopeServer";
import { isMongoDependencyError } from "@/lib/mongodb";
import { listCancelledOrderOverlays, toSafeOverlay } from "@/lib/orderOverlays";

export const runtime = "nodejs";

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, Math.floor(parsed))) : fallback;
}

export async function GET(req: NextRequest) {
  const actor = parseOrderActor({
    role: req.nextUrl.searchParams.get("role") || req.headers.get("x-omsons-actor-role"),
    actorId: req.nextUrl.searchParams.get("id") || req.nextUrl.searchParams.get("actor_id") || req.headers.get("x-omsons-actor-id"),
  });
  if (!actor) {
    return NextResponse.json({ success: false, message: "Missing cancelled-order identity." }, { status: 401 });
  }
  if (actor.role === "accountant") {
    return NextResponse.json({ success: false, message: "Cancelled orders are not available for this role." }, { status: 403 });
  }

  try {
    const assignedDealerIds = actor.role === "staff"
      ? await fetchStaffAssignedDealerIds(actor.actorId)
      : [];
    const page = positiveInt(req.nextUrl.searchParams.get("page"), 1, 100_000);
    const limit = positiveInt(req.nextUrl.searchParams.get("limit"), 10, 100);
    const result = await listCancelledOrderOverlays({
      role: actor.role,
      actorId: actor.actorId,
      assignedDealerIds,
      search: req.nextUrl.searchParams.get("search") || "",
      page,
      limit,
    });

    return NextResponse.json({
      success: true,
      data: result.rows.map(toSafeOverlay),
      count: result.total,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      last_page: result.totalPages,
    });
  } catch (error) {
    console.error("[GET /api/order-overlays/cancelled]", error);
    return NextResponse.json(
      {
        success: false,
        message: isMongoDependencyError(error)
          ? "Order overlay database is currently unavailable."
          : "Unable to load cancelled orders.",
      },
      { status: isMongoDependencyError(error) ? 503 : 500 }
    );
  }
}
