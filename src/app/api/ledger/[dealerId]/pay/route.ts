import { NextRequest, NextResponse } from "next/server";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { fetchExternalDealer, getLedgerSnapshot } from "@/lib/ledgerSystem";
import walletUtils from "@/lib/wallet";

/**
 * POST /api/ledger/[dealerId]/pay
 * Record a payment/money received from dealer
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealerId: string }> }
) {
  try {
    const { dealerId } = await params;
    const body = await req.json();
    const { amount, paymentMode, narration, referenceId, paymentDate } = body;
    const paymentAmount = Number(amount);

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return NextResponse.json(
        { success: false, message: "Valid amount is required" },
        { status: 400 }
      );
    }

    const db = await getDb();

    const dealer = await fetchExternalDealer(dealerId).catch(async () => {
      const snapshot = await getLedgerSnapshot();
      return snapshot.dealers.find((item) => String(item.Dealer_Id) === String(dealerId)) ?? null;
    });

    if (!dealer) {
      return NextResponse.json(
        { success: false, message: "Dealer not found" },
        { status: 404 }
      );
    }

    const date = paymentDate ? new Date(paymentDate) : new Date();

    const paymentTransaction = {
      Dealer_Id: dealerId,
      type: "payment",
      amount: paymentAmount,
      paymentMode: paymentMode || "Cash",
      narration: narration || `Payment received - ${paymentMode || "Cash"}`,
      referenceId: referenceId || "",
      date: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (paymentMode === "Wallet") {
      const client = await getMongoClient();
      try {
        await client.withSession(async (session) => {
          await session.withTransaction(async () => {
            const walletDebit = await walletUtils.applyWalletChange(db, dealerId, "debit", paymentAmount, {
              session,
              reference: referenceId || paymentTransaction.referenceId || "",
              note: narration || `Wallet payment - ${paymentMode || "Wallet"}`,
            });

            await db.collection("ledger_transactions").insertOne(
              {
                ...paymentTransaction,
                walletBalanceBefore: walletDebit.balanceBefore,
                walletBalanceAfter: walletDebit.balanceAfter,
              },
              { session }
            );
          });
        });
      } catch (walletError: any) {
        const status = Number(walletError?.status || walletError?.statusCode || 500);
        return NextResponse.json(
          { success: false, message: walletError.message },
          { status: Number.isFinite(status) ? status : 500 }
        );
      } finally {
        await client.close();
      }

      return NextResponse.json({
        success: true,
        message: "Wallet payment recorded successfully",
        transaction: paymentTransaction,
      });
    }

    const result = await db
      .collection("ledger_transactions")
      .insertOne(paymentTransaction);

    return NextResponse.json({
      success: true,
      message: "Payment recorded successfully",
      transactionId: result.insertedId.toString(),
      transaction: paymentTransaction,
    });
  } catch (error: any) {
    console.error("[POST /api/ledger/[dealerId]/pay]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
