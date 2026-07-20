import { NextResponse } from "next/server";
import { messageForReason, resolveOrderAccess } from "@/lib/orderAccess";
import { fetchStaffAssignedDealerIds, parseOrderActor, scopeOrdersForActor } from "@/lib/orderScopeServer";

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
    const assignedDealerIds = actor.role === "staff"
      ? await fetchStaffAssignedDealerIds(actor.actorId)
      : [];
    const access = await resolveOrderAccess(id, {
      actor,
      assignedDealerIds,
      dealerId: actor.role === "dealer" ? actor.actorId : dealerId,
    });
    if (!access.visible) {
      const status = access.reason === "upstream_unavailable" ? 503 : access.reason === "forbidden" ? 403 : 404;
      return NextResponse.json({ success: false, reason: access.reason, message: access.message }, { status });
    }
    const scoped = await scopeOrdersForActor(access.order ? [access.order] : [], actor);
    if (scoped.length === 0) {
      return NextResponse.json(
        { success: false, reason: "forbidden", message: messageForReason("forbidden") },
        { status: 403 },
      );
    }
    return NextResponse.json({ success: true, data: scoped[0] });
  } catch (error) {
    console.error("[GET /api/order-access/[id]]", error);
    return NextResponse.json({ success: false, message: "Unable to verify order access" }, { status: 502 });
  }
}
