import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

/**
 * GET /api/ledger
 * Get summary of all dealers' ledger accounts
 * Includes: dealer name, total debit, total credit, net balance, wallet balance
 */
export async function GET(req: NextRequest) {
  try {
    const db = await getDb();

    // Fetch all dealers
    const dealers = await db
      .collection("dealers")
      .find({})
      .project({
        Dealer_Id: 1,
        Dealer_Name: 1,
        Dealer_Email: 1,
        Dealer_Number: 1,
        Dealer_Address: 1,
        Dealer_City: 1,
        Dealer_Pincode: 1,
        walletBalance: 1,
      })
      .toArray();

    // Calculate ledger summary for each dealer
    const ledgerSummaries = await Promise.all(
      dealers.map(async (dealer) => {
        // Get transactions (orders, payments, etc.)
        const orders = await db
          .collection("orders")
          .find({ Dealer_Id: dealer.Dealer_Id })
          .toArray();

        const payments = await db
          .collection("ledger_transactions")
          .find({ Dealer_Id: dealer.Dealer_Id })
          .toArray();

        // Calculate totals
        const totalDebit = orders.reduce((sum, o) => sum + (parseFloat(o.order_amount) || 0), 0);
        const totalCredit = payments.reduce(
          (sum, p) => sum + (p.type === "payment" ? parseFloat(p.amount) || 0 : 0),
          0
        );
        const netBalance = totalDebit - totalCredit;

        return {
          Dealer_Id: dealer.Dealer_Id,
          Dealer_Name: dealer.Dealer_Name,
          Dealer_Email: dealer.Dealer_Email,
          Dealer_Number: dealer.Dealer_Number,
          Dealer_City: dealer.Dealer_City,
          totalDebit,
          totalCredit,
          netBalance,
          walletBalance: dealer.walletBalance || 0,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: ledgerSummaries,
      total: ledgerSummaries.length,
    });
  } catch (error: any) {
    console.error("[GET /api/ledger]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
