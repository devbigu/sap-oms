import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

/**
 * GET /api/ledger/[dealerId]
 * Get dealer info and ledger summary
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealerId: string }> }
) {
  try {
    const { dealerId } = await params;
    const db = await getDb();

    // Fetch dealer info
    const dealer = await db
      .collection("dealers")
      .findOne({ Dealer_Id: dealerId });

    if (!dealer) {
      return NextResponse.json(
        { success: false, message: "Dealer not found" },
        { status: 404 }
      );
    }

    // Get all orders for this dealer
    const orders = await db
      .collection("orders")
      .find({ Dealer_Id: dealerId })
      .toArray();

    // Get all transactions (payments, etc.)
    const transactions = await db
      .collection("ledger_transactions")
      .find({ Dealer_Id: dealerId })
      .sort({ date: -1 })
      .toArray();

    // Calculate totals
    const totalDebit = orders.reduce((sum, o) => sum + (parseFloat(o.order_amount) || 0), 0);
    const totalCredit = transactions.reduce(
      (sum, t) => sum + (t.type === "payment" ? parseFloat(t.amount) || 0 : 0),
      0
    );
    const netBalance = totalDebit - totalCredit;

    return NextResponse.json({
      success: true,
      dealer: {
        Dealer_Id: dealer.Dealer_Id,
        Dealer_Name: dealer.Dealer_Name,
        Dealer_Email: dealer.Dealer_Email,
        Dealer_Number: dealer.Dealer_Number,
        Dealer_Address: dealer.Dealer_Address,
        Dealer_City: dealer.Dealer_City,
        Dealer_Pincode: dealer.Dealer_Pincode,
        walletBalance: dealer.walletBalance || 0,
      },
      summary: {
        totalDebit,
        totalCredit,
        netBalance,
      },
      transactionCount: transactions.length,
    });
  } catch (error: any) {
    console.error("[GET /api/ledger/[dealerId]]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
