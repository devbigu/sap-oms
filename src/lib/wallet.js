const DEFAULT_HISTORY_LIMIT = 50;

class WalletError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "WalletError";
    this.status = status;
  }
}

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toPositiveAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return roundMoney(n);
}

function safeText(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeWalletDoc(doc, dealerId) {
  return {
    dealerId: String(doc?.dealerId ?? dealerId ?? ""),
    balance: roundMoney(doc?.balance ?? 0),
    createdAt: doc?.createdAt ?? null,
    updatedAt: doc?.updatedAt ?? null,
  };
}

function normalizeWalletTransaction(doc) {
  return {
    id: doc?._id?.toString?.() || doc?.id || "",
    dealerId: String(doc?.dealerId ?? ""),
    type: doc?.type === "debit" ? "debit" : "credit",
    amount: roundMoney(doc?.amount ?? 0),
    balanceBefore: roundMoney(doc?.balanceBefore ?? 0),
    balanceAfter: roundMoney(doc?.balanceAfter ?? 0),
    reference: safeText(doc?.reference, 200),
    note: safeText(doc?.note, 1000),
    createdAt: doc?.createdAt ?? null,
  };
}

function buildWalletTransaction({ dealerId, type, amount, balanceBefore, balanceAfter, reference, note }) {
  return {
    dealerId: String(dealerId ?? ""),
    type: type === "debit" ? "debit" : "credit",
    amount: roundMoney(amount),
    balanceBefore: roundMoney(balanceBefore),
    balanceAfter: roundMoney(balanceAfter),
    reference: safeText(reference, 200),
    note: safeText(note, 1000),
    createdAt: nowIso(),
  };
}

function getMongoClientFromDb(db, client) {
  if (client && typeof client.startSession === "function") return client;
  if (db?.client && typeof db.client.startSession === "function") return db.client;
  if (db?.s?.client && typeof db.s.client.startSession === "function") return db.s.client;
  return null;
}

async function withOptionalSession(db, client, work) {
  const mongoClient = getMongoClientFromDb(db, client);
  if (!mongoClient) return work(null);

  const session = mongoClient.startSession();
  try {
    if (typeof session.withTransaction === "function") {
      return await session.withTransaction(() => work(session));
    }
    return await work(session);
  } finally {
    if (typeof session.endSession === "function") {
      await session.endSession();
    }
  }
}

async function getWalletSnapshot(db, dealerId, options = {}) {
  const session = options.session ?? null;
  const limit = Math.min(200, Math.max(1, Number(options.limit ?? DEFAULT_HISTORY_LIMIT)));
  const wallets = db.collection("dealer_wallets");
  const transactions = db.collection("wallet_transactions");

  const walletDoc = await wallets.findOne(
    { dealerId: String(dealerId) },
    session ? { session } : undefined
  );
  const history = await transactions
    .find({ dealerId: String(dealerId) }, session ? { session } : undefined)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return {
    dealerId: String(dealerId),
    balance: roundMoney(walletDoc?.balance ?? 0),
    createdAt: walletDoc?.createdAt ?? null,
    updatedAt: walletDoc?.updatedAt ?? null,
    transactions: history.map(normalizeWalletTransaction),
  };
}

async function applyWalletChange(db, dealerId, type, amountInput, options = {}) {
  const amount = toPositiveAmount(amountInput);
  if (!amount) throw new WalletError("Valid wallet amount is required", 400);

  const dealerKey = String(dealerId ?? "").trim();
  if (!dealerKey) throw new WalletError("Dealer id is required", 400);

  const session = options.session ?? null;
  const reference = safeText(options.reference, 200);
  const note = safeText(options.note, 1000);
  const now = nowIso();
  const wallets = db.collection("dealer_wallets");
  const transactions = db.collection("wallet_transactions");

  let walletResult;
  if (type === "credit") {
    walletResult = await wallets.findOneAndUpdate(
      { dealerId: dealerKey },
      {
        $setOnInsert: { dealerId: dealerKey, balance: 0, createdAt: now },
        $set: { updatedAt: now },
        $inc: { balance: amount },
      },
      { upsert: true, returnDocument: "after", ...(session ? { session } : {}) }
    );
  } else {
    walletResult = await wallets.findOneAndUpdate(
      { dealerId: dealerKey, balance: { $gte: amount } },
      {
        $set: { updatedAt: now },
        $inc: { balance: -amount },
      },
      { returnDocument: "after", ...(session ? { session } : {}) }
    );
    if (!walletResult?.value) {
      throw new WalletError("Insufficient wallet balance", 400);
    }
  }

  const balanceAfter = roundMoney(walletResult?.value?.balance ?? 0);
  const balanceBefore = type === "credit"
    ? roundMoney(balanceAfter - amount)
    : roundMoney(balanceAfter + amount);

  const transaction = buildWalletTransaction({
    dealerId: dealerKey,
    type,
    amount,
    balanceBefore,
    balanceAfter,
    reference,
    note,
  });

  try {
    await transactions.insertOne(transaction, session ? { session } : undefined);
  } catch (error) {
    if (!session) {
      await wallets.updateOne(
        { dealerId: dealerKey },
        { $inc: { balance: type === "credit" ? -amount : amount }, $set: { updatedAt: nowIso() } }
      );
    }
    throw error;
  }

  return {
    dealerId: dealerKey,
    amount,
    balanceBefore,
    balanceAfter,
    transaction,
  };
}

async function recordWalletPayment(db, dealerId, amountInput, options = {}) {
  const amount = toPositiveAmount(amountInput);
  if (!amount) throw new WalletError("Valid wallet amount is required", 400);

  const client = options.client ?? null;
  const note = safeText(options.note, 1000);
  const reference = safeText(options.reference, 200);
  const rollbackReference = safeText(options.rollbackReference ?? reference, 200);
  const rollbackNote = safeText(options.rollbackNote ?? "Wallet payment rollback", 1000);

  return withOptionalSession(db, client, async (session) => {
    const debit = await applyWalletChange(db, dealerId, "debit", amount, {
      session,
      reference,
      note: note || "Wallet payment",
    });

    try {
      const ledgerResult = await options.createLedgerEntry({
        session,
        amount,
        balanceBefore: debit.balanceBefore,
        balanceAfter: debit.balanceAfter,
        reference,
        note,
      });

      return {
        wallet: debit,
        ledger: ledgerResult,
      };
    } catch (error) {
      if (!session) {
        await applyWalletChange(db, dealerId, "credit", amount, {
          reference: rollbackReference,
          note: rollbackNote,
        });
      }
      throw error;
    }
  });
}

module.exports = {
  DEFAULT_HISTORY_LIMIT,
  WalletError,
  applyWalletChange,
  buildWalletTransaction,
  getWalletSnapshot,
  normalizeWalletDoc,
  normalizeWalletTransaction,
  recordWalletPayment,
  roundMoney,
  toPositiveAmount,
  withOptionalSession,
};
