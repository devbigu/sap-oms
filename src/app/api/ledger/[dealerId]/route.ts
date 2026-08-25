import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { normalizeDealerStatus } from "@/lib/dealerStatus";
import {
  fetchExternalDealer,
  getLedgerSnapshot,
  normalizeDealer,
  ordersForDealer,
  paymentCreditPaise,
  paymentDebitPaise,
  summarizeOrders,
} from "@/lib/ledgerSystem";

/**
 * GET /api/ledger/[dealerId]
 * Dealer info, live external order debit summary, and local payment credits.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealerId: string }> }
) {
  try {
    const { dealerId } = await params;
    const snapshot = await getLedgerSnapshot();
    let dealerLive = true;
    let dealer = await fetchExternalDealer(dealerId).catch((error) => {
      dealerLive = false;
      console.error("[ledger dealer live]", error);
      return null;
    });

    if (!dealer) {
      dealer = snapshot.dealers.find((item) => String(item.Dealer_Id) === String(dealerId)) ?? null;
    }

    if (!dealer) {
      return NextResponse.json(
        { success: false, message: "Dealer not found" },
        { status: 404 }
      );
    }

    const dealerOrders = ordersForDealer(snapshot.orders, dealerId);
    let transactions: any[] = [];
    let paymentsLive = true;
    let statusOverride: string | null = null;

    try {
      const db = await getDb();
      const [transactionRows, statusDoc] = await Promise.all([
        db
          .collection("ledger_transactions")
          .find({ Dealer_Id: dealerId })
          .sort({ date: -1 })
          .toArray(),
        db.collection("dealer_statuses").findOne({ dealerId }),
      ]);
      transactions = transactionRows;
      statusOverride = statusDoc ? normalizeDealerStatus(statusDoc.status) : null;
    } catch (paymentError) {
      paymentsLive = false;
      console.error("[GET /api/ledger/[dealerId] payments]", paymentError);
    }

    const accountBook = summarizeOrders(dealerOrders);
    const creditPaise = transactions.reduce((sum, tx) => sum + paymentCreditPaise(tx), 0);
    const debitPaise = transactions.reduce((sum, tx) => sum + paymentDebitPaise(tx), 0);
    const totalDebit = accountBook.booked + debitPaise / 100;
    const totalCredit = creditPaise / 100;

    return NextResponse.json({
      success: true,
      dealer: {
        ...normalizeDealer(dealer),
        ...(statusOverride ? { status: statusOverride } : {}),
      },
      summary: {
        totalDebit,
        totalCredit,
        netBalance: totalDebit - totalCredit,
      },
      summaryStats: accountBook,
      orders: dealerOrders,
      transactionCount: transactions.length,
      isLive: snapshot.isLive && dealerLive,
      paymentsLive,
      updatedAt: snapshot.updatedAt,
    });
  } catch (error: any) {
    console.error("[GET /api/ledger/[dealerId]]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
