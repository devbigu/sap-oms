import { NextResponse } from "next/server";
import { resolveActiveOrder } from "@/lib/activeOrderAccess";
import { parseOrderActor, scopeOrdersForActor } from "@/lib/orderScopeServer";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const access = await resolveActiveOrder(id, actor.role === "dealer" ? actor.actorId : undefined);
    if (!access.visible) {
      return NextResponse.json({ success: false, message: access.reason }, { status: 404 });
    }
    const scoped = await scopeOrdersForActor(access.order ? [access.order] : [], actor);
    if (scoped.length === 0) {
      return NextResponse.json({ success: false, message: "Order is outside your assigned dealer scope" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: scoped[0] });
  } catch (error) {
    console.error("[GET /api/active-order/[id]]", error);
    return NextResponse.json({ success: false, message: "Unable to verify the active order period" }, { status: 502 });
  }
}
