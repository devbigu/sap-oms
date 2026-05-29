import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

/**
 * GET /api/ledger/[dealerId]/transactions
 * Get all transactions for a specific dealer
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealerId: string }> }
) {
  try {
    const { dealerId } = await params;
    const db = await getDb();

    // Combine orders (debits) and ledger transactions (credits/payments)
    const orders = await db
      .collection("orders")
      .find({ Dealer_Id: dealerId })
      .sort({ order_date: -1 })
      .toArray();

    const ledgerTransactions = await db
      .collection("ledger_transactions")
      .find({ Dealer_Id: dealerId })
      .sort({ date: -1 })
      .toArray();

    // Format orders as transactions
    const orderTransactions = orders.map((order) => ({
      id: order._id?.toString() || "",
      debit: parseFloat(order.order_amount) || 0,
      credit: 0,
      narration: `Order ${order.order_id}`,
      date: order.order_date || "",
      invoice: order.order_id || "",
      mode: "Order",
      type: "debit",
    }));

    // Format ledger transactions
    const formattedLedgerTransactions = ledgerTransactions.map((lt) => ({
      id: lt._id?.toString() || "",
      debit: lt.type === "debit" ? parseFloat(lt.amount) || 0 : 0,
      credit: lt.type === "payment" ? parseFloat(lt.amount) || 0 : 0,
      narration: lt.narration || "",
      date: lt.date || "",
      invoice: lt.referenceId || "",
      mode: lt.paymentMode || "",
      type: lt.type,
    }));

    // Combine and sort by date (newest first)
    const allTransactions = [...orderTransactions, ...formattedLedgerTransactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return NextResponse.json({
      success: true,
      data: allTransactions,
      count: allTransactions.length,
    });
  } catch (error: any) {
    console.error("[GET /api/ledger/[dealerId]/transactions]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
