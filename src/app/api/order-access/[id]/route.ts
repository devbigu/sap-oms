import { NextResponse } from "next/server";
import { resolveOrderAccess } from "@/lib/orderAccess";
import { fetchStaffAssignedDealerIds, parseOrderActor } from "@/lib/orderScopeServer";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const dealerId = query.get("dealer_id") || undefined;
  const actor = parseOrderActor({
    role: query.get("role") || request.headers.get("x-omsons-actor-role"),
    actorId: query.get("actor_id") || request.headers.get("x-omsons-actor-id") || dealerId,
  });
  if (!actor) {
    return NextResponse.json({ success: false, message: "Missing order scope identity" }, { status: 401 });
  }

  try {
    let assignmentLookupFailed = false;
    const assignedDealerIds = actor.role === "staff"
      ? await fetchStaffAssignedDealerIds(actor.actorId).catch((error) => {
          assignmentLookupFailed = true;
          console.warn("[GET /api/order-access/[id]] staff assignment lookup failed", error);
          return [];
        })
      : [];
    const access = await resolveOrderAccess(id, {
      actor,
      assignedDealerIds,
      dealerId: actor.role === "dealer" ? actor.actorId : dealerId,
    });
    if (!access.visible) {
      const reason = assignmentLookupFailed && access.reason === "forbidden"
        ? "upstream_unavailable"
        : access.reason;
      const status = reason === "upstream_unavailable" ? 503 : reason === "forbidden" ? 403 : 404;
      const message = assignmentLookupFailed && access.reason === "forbidden"
        ? "Order verification is temporarily unavailable."
        : access.message;
      return NextResponse.json({ success: false, reason, message }, { status });
    }
    return NextResponse.json({ success: true, data: access.order });
  } catch (error) {
    console.error("[GET /api/order-access/[id]]", error);
    return NextResponse.json({ success: false, message: "Unable to verify order access" }, { status: 502 });
  }
}
