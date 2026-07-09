import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import walletUtils from "@/lib/wallet";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealerId: string }> }
) {
  try {
    const { dealerId } = await params;
    const limitParam = Number(req.nextUrl.searchParams.get("limit") || 50);
    const limit = Number.isFinite(limitParam) ? Math.min(200, Math.max(1, limitParam)) : 50;
    const db = await getDb();
    const data = await walletUtils.getWalletSnapshot(db, dealerId, { limit });

    return NextResponse.json({
      success: true,
      dealerId,
      balance: data.balance,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      transactions: data.transactions,
    });
  } catch (error: any) {
    console.error("[GET /api/wallet/[dealerId]]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
