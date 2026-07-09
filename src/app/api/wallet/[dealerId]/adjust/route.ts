import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import walletUtils from "@/lib/wallet";

function safeText(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealerId: string }> }
) {
  try {
    const { dealerId } = await params;
    const body = await req.json();
    const type = body.type === "debit" ? "debit" : "credit";
    const amount = Number(body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, message: "Valid amount is required" }, { status: 400 });
    }

    const db = await getDb();
    const result = await walletUtils.applyWalletChange(db, dealerId, type, amount, {
      reference: safeText(body.reference, 200),
      note: safeText(body.note, 1000),
    });

    const snapshot = await walletUtils.getWalletSnapshot(db, dealerId, { limit: 50 });

    return NextResponse.json({
      success: true,
      ...result,
      balance: snapshot.balance,
      transactions: snapshot.transactions,
    });
  } catch (error: any) {
    const status = Number(error?.status || error?.statusCode || 500);
    console.error("[POST /api/wallet/[dealerId]/adjust]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: Number.isFinite(status) ? status : 500 }
    );
  }
}
