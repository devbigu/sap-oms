import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/server";
import { getDb } from "@/lib/mongodb";
import {
  getLedgerSnapshot,
  normalizeDealer,
  ordersForDealer,
  paymentCreditPaise,
  paymentDebitPaise,
  summarizeOrders,
} from "@/lib/ledgerSystem";

/**
 * GET /api/ledger
 * Collective dealer ledger from the live billing API, with a single-document
 * MongoDB snapshot fallback for offline resilience.
 */
export async function GET(_req: NextRequest) {
  try {
    const session = requireApiSession(_req, {
      roles: ["admin", "staff", "accountant"],
      unauthenticatedMessage: "Authentication required for dealer ledger access",
      unauthorizedMessage: "Only admin, staff, and accountant users can view the dealer ledger",
    });
    if (session instanceof NextResponse) return session;

    const snapshot = await getLedgerSnapshot();
    let payments: any[] = [];
    let paymentsLive = true;

    try {
      const db = await getDb();
      payments = await db.collection("ledger_transactions").find({}).toArray();
    } catch (paymentError) {
      paymentsLive = false;
      console.error("[GET /api/ledger payments]", paymentError);
    }

    const paymentsByDealer = new Map<string, { creditPaise: number; debitPaise: number }>();
    for (const payment of payments) {
      const dealerId = String(payment.Dealer_Id ?? "");
      if (!dealerId) continue;
      const current = paymentsByDealer.get(dealerId) ?? { creditPaise: 0, debitPaise: 0 };
      current.creditPaise += paymentCreditPaise(payment);
      current.debitPaise += paymentDebitPaise(payment);
      paymentsByDealer.set(dealerId, current);
    }

    const ledgerSummaries = snapshot.dealers.map((rawDealer) => {
      const dealer = normalizeDealer(rawDealer);
      const dealerOrders = ordersForDealer(snapshot.orders, dealer.Dealer_Id);
      const accountBook = summarizeOrders(dealerOrders);
      const paymentTotals = paymentsByDealer.get(dealer.Dealer_Id) ?? { creditPaise: 0, debitPaise: 0 };
      const totalDebit = accountBook.booked + paymentTotals.debitPaise / 100;
      const totalCredit = paymentTotals.creditPaise / 100;

      return {
        ...dealer,
        totalDebit,
        totalCredit,
        netBalance: totalDebit - totalCredit,
        accountBook,
      };
    });

    return NextResponse.json({
      success: true,
      data: ledgerSummaries,
      total: ledgerSummaries.length,
      isLive: snapshot.isLive,
      updatedAt: snapshot.updatedAt,
      paymentsLive,
    });
  } catch (error: any) {
    console.error("[GET /api/ledger]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
