import { NextRequest, NextResponse } from "next/server";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { fetchStaffAssignedDealerIds, parseOrderActor } from "@/lib/orderScopeServer";
import walletUtils from "@/lib/wallet";

function actorFromRequest(req: NextRequest) {
  return parseOrderActor({
    role: req.headers.get("x-omsons-actor-role") || req.nextUrl.searchParams.get("role"),
    actorId: req.headers.get("x-omsons-actor-id") || req.nextUrl.searchParams.get("actor_id"),
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = actorFromRequest(req);
    if (!actor) return NextResponse.json({ success: false, message: "Missing wallet identity." }, { status: 401 });
    const { dealerId } = await params;
    if (actor.role === "dealer" && actor.actorId !== dealerId) {
      return NextResponse.json({ success: false, message: "This wallet belongs to another Dealer." }, { status: 403 });
    }
    if (actor.role === "staff") {
      const assigned = await fetchStaffAssignedDealerIds(actor.actorId);
      if (!assigned.includes(dealerId)) return NextResponse.json({ success: false, message: "This Dealer is outside your assignment." }, { status: 403 });
    }
    if (actor.role === "accountant") return NextResponse.json({ success: false, message: "Wallet access is not available for this role." }, { status: 403 });
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 50)));
    const data = await walletUtils.getWalletSnapshot(await getDb(), dealerId, { limit });
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    console.error("[GET /api/wallet/[dealerId]]", error);
    return NextResponse.json({ success: false, message: isMongoDependencyError(error) ? "Wallet database is unavailable." : "Unable to load wallet." }, { status: isMongoDependencyError(error) ? 503 : 500 });
  }
}
