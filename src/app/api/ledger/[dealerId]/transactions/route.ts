import { NextRequest, NextResponse } from "next/server";
import { canAccessDealerScopedResource, requireApiSession } from "@/lib/auth/server";
import { getDb } from "@/lib/mongodb";
import {
  classifyOrder,
  getLedgerSnapshot,
  orderNet,
  ordersForDealer,
  paymentCreditPaise,
  paymentDebitPaise,
} from "@/lib/ledgerSystem";

function orderMode(order: any) {
  const state = classifyOrder(order);
  if (state === "SentAndSettled") return "Sent & Settled";
  if (state === "SupposedToGo") return "Supposed to Go";
  if (state === "Awaiting") return "Awaiting Confirm";
  return "Cancelled";
}

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

/**
 * GET /api/ledger/[dealerId]/transactions
 * Unified chronological transaction ledger: live order debits + local credits.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealerId: string }> }
) {
  try {
    const { dealerId } = await params;
    const session = requireApiSession(req, {
      roles: ["admin", "staff", "dealer", "accountant"],
      unauthenticatedMessage: "Authentication required for ledger transactions",
      unauthorizedMessage: "Your signed-in role cannot view ledger transactions",
    });
    if (session instanceof NextResponse) return session;
    if (!canAccessDealerScopedResource(session, dealerId)) {
      return NextResponse.json({ success: false, message: "You are not allowed to view these dealer transactions" }, { status: 403 });
    }

    const searchParams = req.nextUrl.searchParams;
    const requestedPage = Math.max(1, positiveInt(searchParams.get("page"), 1));
    const pageSize = Math.min(100, Math.max(5, positiveInt(searchParams.get("limit"), 20)));
    const snapshot = await getLedgerSnapshot();
    const orders = ordersForDealer(snapshot.orders, dealerId);
    let ledgerTransactions: any[] = [];
    let paymentsLive = true;

    try {
      const db = await getDb();
      ledgerTransactions = await db
        .collection("ledger_transactions")
        .find({ Dealer_Id: dealerId })
        .sort({ date: -1 })
        .toArray();
    } catch (paymentError) {
      paymentsLive = false;
      console.error("[GET /api/ledger/[dealerId]/transactions payments]", paymentError);
    }

    const orderTransactions = orders.map((order) => ({
      id: String(order.order_id || `${dealerId}-${order.order_date || ""}`),
      debit: orderNet(order),
      credit: 0,
      narration: `Order ${order.order_id || ""}`.trim(),
      date: order.order_date || "",
      invoice: order.order_id || "",
      mode: orderMode(order),
      type: "debit",
      order,
    }));

    const formattedLedgerTransactions = ledgerTransactions.map((tx) => ({
      id: tx._id?.toString() || "",
      debit: paymentDebitPaise(tx) / 100,
      credit: paymentCreditPaise(tx) / 100,
      narration: tx.narration || "",
      date: tx.date || tx.createdAt || "",
      invoice: tx.referenceId || "",
      mode: tx.paymentMode || "",
      type: tx.type,
    }));

    const allTransactions = [...orderTransactions, ...formattedLedgerTransactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const total = allTransactions.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const start = (page - 1) * pageSize;

    return NextResponse.json({
      success: true,
      data: allTransactions.slice(start, start + pageSize),
      count: total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      isLive: snapshot.isLive,
      paymentsLive,
      updatedAt: snapshot.updatedAt,
    });
  } catch (error: any) {
    console.error("[GET /api/ledger/[dealerId]/transactions]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
