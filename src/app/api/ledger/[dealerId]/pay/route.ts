import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

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
    const { amount, paymentMode, narration, referenceId } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, message: "Valid amount is required" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Verify dealer exists
    const dealer = await db
      .collection("dealers")
      .findOne({ Dealer_Id: dealerId });

    if (!dealer) {
      return NextResponse.json(
        { success: false, message: "Dealer not found" },
        { status: 404 }
      );
    }

    // Create ledger transaction record
    const transaction = {
      Dealer_Id: dealerId,
      type: "payment",
      amount: parseFloat(amount),
      paymentMode: paymentMode || "Cash",
      narration: narration || `Payment received - ${paymentMode || "Cash"}`,
      referenceId: referenceId || "",
      date: new Date().toISOString(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db
      .collection("ledger_transactions")
      .insertOne(transaction);

    // Update dealer's wallet balance if mode is "Wallet"
    if (paymentMode === "Wallet") {
      await db
        .collection("dealers")
        .updateOne(
          { Dealer_Id: dealerId },
          {
            $inc: { walletBalance: parseFloat(amount) },
          }
        );
    }

    return NextResponse.json({
      success: true,
      message: "Payment recorded successfully",
      transactionId: result.insertedId.toString(),
      transaction,
    });
  } catch (error: any) {
    console.error("[POST /api/ledger/[dealerId]/pay]", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
