import { NextRequest, NextResponse } from "next/server";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { parseOrderActor } from "@/lib/orderScopeServer";
import walletUtils from "@/lib/wallet";

function text(value: unknown, max = 1000) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

export async function POST(req: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = parseOrderActor({ role: req.headers.get("x-omsons-actor-role"), actorId: req.headers.get("x-omsons-actor-id") });
    if (!actor) return NextResponse.json({ success: false, message: "Missing wallet identity." }, { status: 401 });
    if (actor.role !== "admin") return NextResponse.json({ success: false, message: "Only Admin can manage Dealer wallets." }, { status: 403 });
    const { dealerId } = await params;
    const body = await req.json();
    const action = text(body.action ?? body.type, 40).toLowerCase();
    const note = text(body.note);
    const transactionDate = text(body.transactionDate, 40);
    const idempotencyKey = text(req.headers.get("idempotency-key") || body.idempotencyKey, 240);
    if (!idempotencyKey) return NextResponse.json({ success: false, message: "Idempotency key is required." }, { status: 400 });
    if (!note) return NextResponse.json({ success: false, message: "A note is required." }, { status: 400 });
    const parsedDate = new Date(transactionDate);
    if (!transactionDate || Number.isNaN(parsedDate.getTime())) return NextResponse.json({ success: false, message: "A valid transaction date is required." }, { status: 400 });
    const db = await getDb();
    await walletUtils.ensureWalletIndexes(db);
    const common = {
      note, transactionDate: parsedDate, idempotencyKey,
      actorId: actor.actorId, actorRole: actor.role, actorName: text(req.headers.get("x-omsons-actor-name"), 160),
    };
    if (action === "disable" || action === "deactivate") {
      await walletUtils.setWalletStatus(db, dealerId, "inactive", common);
    } else if (action === "activate") {
      const existing = await walletUtils.getWalletSnapshot(db, dealerId, { limit: 1 });
      if (existing.balance <= 0 || body.amount !== undefined) {
        await walletUtils.applyWalletChange(db, dealerId, "activation", body.amount, { ...common, idempotencyKey: `${idempotencyKey}:credit`, reference: text(body.reference, 200) });
      }
      await walletUtils.setWalletStatus(db, dealerId, "active", { ...common, idempotencyKey: `${idempotencyKey}:status` });
    } else if (["topup", "credit"].includes(action)) {
      await walletUtils.applyWalletChange(db, dealerId, "credit", body.amount, { ...common, reference: text(body.reference, 200) });
    } else {
      return NextResponse.json({ success: false, message: "Unsupported wallet action." }, { status: 400 });
    }
    return NextResponse.json({ success: true, ...(await walletUtils.getWalletSnapshot(db, dealerId, { limit: 50 })) });
  } catch (error: any) {
    console.error("[POST /api/wallet/[dealerId]/adjust]", error);
    const status = Number(error?.status) || (isMongoDependencyError(error) ? 503 : 500);
    return NextResponse.json({ success: false, code: error?.code || "wallet_error", message: status >= 500 ? "Unable to update wallet." : error?.message }, { status });
  }
}
