const DEFAULT_HISTORY_LIMIT = 50;
const WALLETS_COLLECTION = "dealer_wallets";
const TRANSACTIONS_COLLECTION = "wallet_transactions";

class WalletError extends Error {
  constructor(message, status = 400, code = "wallet_error") {
    super(message);
    this.name = "WalletError";
    this.status = status;
    this.code = code;
  }
}

function roundMoney(value) {
  const n = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toPaise(value) {
  const n = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fromPaise(value) {
  return roundMoney(Number(value || 0) / 100);
}

function toPositiveAmount(value) {
  const paise = toPaise(value);
  return paise > 0 ? fromPaise(paise) : 0;
}

function safeText(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nowDate() {
  return new Date();
}

function walletBalancePaise(doc) {
  if (Number.isSafeInteger(doc?.balancePaise)) return doc.balancePaise;
  return toPaise(doc?.balance ?? 0);
}

function updatedDocument(result) {
  return result?.value !== undefined ? result.value : result;
}

async function migrateWalletMoney(wallets, doc) {
  if (!doc || Number.isSafeInteger(doc.balancePaise)) return doc;
  const balancePaise = toPaise(doc.balance ?? 0);
  await wallets.updateOne({ dealerId: doc.dealerId }, { $set: { balancePaise, balance: fromPaise(balancePaise), reservedPaise: Number(doc.reservedPaise || 0) } });
  return { ...doc, balancePaise, reservedPaise: Number(doc.reservedPaise || 0) };
}

function normalizeWalletTransaction(doc) {
  return {
    id: doc?._id?.toString?.() || doc?.id || "",
    dealerId: String(doc?.dealerId ?? ""),
    type: safeText(doc?.type, 40) || "credit",
    amount: fromPaise(doc?.amountPaise ?? toPaise(doc?.amount)),
    balanceBefore: fromPaise(doc?.balanceBeforePaise ?? toPaise(doc?.balanceBefore)),
    balanceAfter: fromPaise(doc?.balanceAfterPaise ?? toPaise(doc?.balanceAfter)),
    relatedOrderId: safeText(doc?.relatedOrderId, 120),
    relatedOrderNumber: safeText(doc?.relatedOrderNumber, 120),
    reference: safeText(doc?.reference, 200),
    note: safeText(doc?.note, 1000),
    transactionDate: doc?.transactionDate ?? null,
    actorId: safeText(doc?.actorId, 120),
    actorRole: safeText(doc?.actorRole, 40),
    actorName: safeText(doc?.actorName, 160),
    idempotencyKey: safeText(doc?.idempotencyKey, 240),
    createdAt: doc?.createdAt ?? null,
  };
}

function buildWalletTransaction(input) {
  const amountPaise = input.amountPaise ?? toPaise(input.amount);
  const balanceBeforePaise = input.balanceBeforePaise ?? toPaise(input.balanceBefore);
  const balanceAfterPaise = input.balanceAfterPaise ?? toPaise(input.balanceAfter);
  return {
    dealerId: String(input.dealerId ?? ""),
    type: safeText(input.type, 40) || "credit",
    amountPaise,
    amount: fromPaise(amountPaise),
    balanceBeforePaise,
    balanceBefore: fromPaise(balanceBeforePaise),
    balanceAfterPaise,
    balanceAfter: fromPaise(balanceAfterPaise),
    relatedOrderId: safeText(input.relatedOrderId, 120) || null,
    relatedOrderNumber: safeText(input.relatedOrderNumber, 120) || null,
    reference: safeText(input.reference, 200),
    note: safeText(input.note, 1000),
    transactionDate: input.transactionDate || nowDate(),
    actorId: safeText(input.actorId, 120),
    actorRole: safeText(input.actorRole, 40),
    actorName: safeText(input.actorName, 160),
    idempotencyKey: safeText(input.idempotencyKey, 240),
    createdAt: nowDate(),
  };
}

async function ensureWalletIndexes(db) {
  await Promise.all([
    db.collection(WALLETS_COLLECTION).createIndex?.({ dealerId: 1 }, { unique: true }),
    db.collection(TRANSACTIONS_COLLECTION).createIndex?.(
      { dealerId: 1, idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
    ),
  ]);
}

async function getWalletSnapshot(db, dealerId, options = {}) {
  const dealerKey = safeText(String(dealerId ?? ""), 120);
  const limit = Math.min(200, Math.max(1, Number(options.limit ?? DEFAULT_HISTORY_LIMIT)));
  const wallets = db.collection(WALLETS_COLLECTION);
  const walletDoc = await migrateWalletMoney(wallets, await wallets.findOne({ dealerId: dealerKey }));
  const history = await db.collection(TRANSACTIONS_COLLECTION).find({ dealerId: dealerKey })
    .sort({ createdAt: -1 }).limit(limit).toArray();
  const balancePaise = walletBalancePaise(walletDoc);
  const reservedPaise = Number(walletDoc?.reservedPaise || 0);
  const totals = history.reduce((out, row) => {
    const amount = Number(row.amountPaise ?? toPaise(row.amount));
    if (["credit", "activation", "refund"].includes(row.type)) out.credited += amount;
    if (["order_debit", "debit"].includes(row.type)) out.consumed += amount;
    return out;
  }, { credited: 0, consumed: 0 });
  return {
    dealerId: dealerKey,
    status: walletDoc?.status === "active" ? "active" : "inactive",
    balance: fromPaise(balancePaise),
    availableBalance: fromPaise(Math.max(0, balancePaise - reservedPaise)),
    totalCredited: fromPaise(totals.credited),
    totalConsumed: fromPaise(totals.consumed),
    createdAt: walletDoc?.createdAt ?? null,
    updatedAt: walletDoc?.updatedAt ?? null,
    transactions: history.map(normalizeWalletTransaction),
  };
}

async function findExistingTransaction(db, dealerId, idempotencyKey) {
  if (!idempotencyKey) return null;
  return db.collection(TRANSACTIONS_COLLECTION).findOne({ dealerId, idempotencyKey });
}

async function applyWalletChange(db, dealerId, type, amountInput, options = {}) {
  const dealerKey = safeText(String(dealerId ?? ""), 120);
  const amountPaise = toPaise(amountInput);
  if (!dealerKey) throw new WalletError("Dealer id is required", 400, "invalid_dealer");
  if (amountPaise <= 0) throw new WalletError("A valid positive wallet amount is required", 422, "invalid_amount");
  const idempotencyKey = safeText(options.idempotencyKey, 240);
  const prior = await findExistingTransaction(db, dealerKey, idempotencyKey);
  if (prior) return { duplicate: true, transaction: normalizeWalletTransaction(prior), balanceAfter: fromPaise(prior.balanceAfterPaise) };

  const isCredit = ["credit", "activation", "refund"].includes(type);
  const wallets = db.collection(WALLETS_COLLECTION);
  if (!isCredit) await migrateWalletMoney(wallets, await wallets.findOne({ dealerId: dealerKey }));
  const now = nowDate();
  const filter = isCredit
    ? { dealerId: dealerKey }
    : { dealerId: dealerKey, balancePaise: { $gte: amountPaise } };
  const update = isCredit ? {
    $setOnInsert: { dealerId: dealerKey, balance: 0, balancePaise: 0, reservedPaise: 0, status: "inactive", createdAt: now },
    $inc: { balancePaise: amountPaise },
    $set: { updatedAt: now },
  } : {
    $inc: { balancePaise: -amountPaise },
    $set: { updatedAt: now },
  };
  const walletDoc = updatedDocument(await wallets.findOneAndUpdate(filter, update, { upsert: isCredit, returnDocument: "after" }));
  if (!walletDoc) throw new WalletError("Insufficient wallet balance", 409, "insufficient_balance");
  const balanceAfterPaise = walletBalancePaise(walletDoc);
  await wallets.updateOne({ dealerId: dealerKey }, { $set: { balance: fromPaise(balanceAfterPaise) } });
  const transaction = buildWalletTransaction({
    ...options, dealerId: dealerKey, type, amountPaise,
    balanceBeforePaise: isCredit ? balanceAfterPaise - amountPaise : balanceAfterPaise + amountPaise,
    balanceAfterPaise, idempotencyKey,
  });
  try {
    const inserted = await db.collection(TRANSACTIONS_COLLECTION).insertOne(transaction);
    return { amount: fromPaise(amountPaise), balanceBefore: transaction.balanceBefore, balanceAfter: transaction.balanceAfter, transaction: normalizeWalletTransaction({ ...transaction, _id: inserted.insertedId }) };
  } catch (error) {
    await wallets.updateOne({ dealerId: dealerKey }, { $inc: { balancePaise: isCredit ? -amountPaise : amountPaise } });
    const duplicate = await findExistingTransaction(db, dealerKey, idempotencyKey);
    if (duplicate) return { duplicate: true, transaction: normalizeWalletTransaction(duplicate), balanceAfter: fromPaise(duplicate.balanceAfterPaise) };
    throw error;
  }
}

async function setWalletStatus(db, dealerId, status, options = {}) {
  const dealerKey = safeText(String(dealerId ?? ""), 120);
  if (!dealerKey || !["active", "inactive"].includes(status)) throw new WalletError("Invalid wallet status", 400, "invalid_status");
  const idempotencyKey = safeText(options.idempotencyKey, 240);
  const prior = await findExistingTransaction(db, dealerKey, idempotencyKey);
  if (prior) return getWalletSnapshot(db, dealerKey);
  const now = nowDate();
  const wallets = db.collection(WALLETS_COLLECTION);
  const existing = await wallets.findOne({ dealerId: dealerKey });
  const balancePaise = walletBalancePaise(existing);
  await wallets.updateOne({ dealerId: dealerKey }, {
    $setOnInsert: { dealerId: dealerKey, balance: 0, balancePaise: 0, reservedPaise: 0, createdAt: now },
    $set: { status, updatedAt: now },
  }, { upsert: true });
  await db.collection(TRANSACTIONS_COLLECTION).insertOne(buildWalletTransaction({
    ...options, dealerId: dealerKey, type: status === "active" ? "activation" : "deactivation",
    amountPaise: 0, balanceBeforePaise: balancePaise, balanceAfterPaise: balancePaise, idempotencyKey,
  }));
  return getWalletSnapshot(db, dealerKey);
}

async function reserveOrderFunds(db, dealerId, amountInput, options = {}) {
  const dealerKey = safeText(String(dealerId ?? ""), 120);
  const amountPaise = toPaise(amountInput);
  const reservationKey = safeText(options.idempotencyKey, 240);
  if (!reservationKey) throw new WalletError("Order idempotency key is required", 400, "missing_idempotency_key");
  const existingDebit = await findExistingTransaction(db, dealerKey, reservationKey);
  if (existingDebit) return { active: true, duplicate: true, amount: fromPaise(existingDebit.amountPaise), balanceAfter: fromPaise(existingDebit.balanceAfterPaise) };
  const wallets = db.collection(WALLETS_COLLECTION);
  const wallet = await migrateWalletMoney(wallets, await wallets.findOne({ dealerId: dealerKey }));
  if (wallet?.status !== "active") return { active: false };
  if (amountPaise <= 0) throw new WalletError("Authoritative Net Payable is invalid", 422, "invalid_net_payable");
  const availablePaise = walletBalancePaise(wallet) - Number(wallet.reservedPaise || 0);
  const updated = updatedDocument(await wallets.findOneAndUpdate(
    { dealerId: dealerKey, status: "active", balancePaise: { $gte: Number(wallet.reservedPaise || 0) + amountPaise }, [`reservations.${reservationKey}`]: { $exists: false } },
    { $inc: { reservedPaise: amountPaise }, $set: { [`reservations.${reservationKey}`]: { amountPaise, createdAt: nowDate() }, updatedAt: nowDate() } },
    { returnDocument: "after" }
  ));
  if (!updated) throw new WalletError(`Insufficient wallet balance. Available: ₹${fromPaise(Math.max(0, availablePaise)).toLocaleString("en-IN")}. Required: ₹${fromPaise(amountPaise).toLocaleString("en-IN")}.`, 409, "insufficient_balance");
  return { active: true, amount: fromPaise(amountPaise), availableBalance: fromPaise(walletBalancePaise(updated) - Number(updated.reservedPaise || 0)) };
}

async function releaseOrderReservation(db, dealerId, idempotencyKey) {
  const dealerKey = String(dealerId);
  const wallets = db.collection(WALLETS_COLLECTION);
  const wallet = await migrateWalletMoney(wallets, await wallets.findOne({ dealerId: dealerKey }));
  const amountPaise = Number(wallet?.reservations?.[idempotencyKey]?.amountPaise || 0);
  if (!amountPaise) return;
  await db.collection(WALLETS_COLLECTION).updateOne(
    { dealerId: dealerKey, [`reservations.${idempotencyKey}`]: { $exists: true } },
    { $inc: { reservedPaise: -amountPaise }, $unset: { [`reservations.${idempotencyKey}`]: "" }, $set: { updatedAt: nowDate() } }
  );
}

async function finalizeOrderDebit(db, dealerId, idempotencyKey, order = {}, actor = {}) {
  const dealerKey = String(dealerId);
  const prior = await findExistingTransaction(db, dealerKey, idempotencyKey);
  if (prior) return normalizeWalletTransaction(prior);
  const wallets = db.collection(WALLETS_COLLECTION);
  const wallet = await wallets.findOne({ dealerId: dealerKey });
  const amountPaise = Number(wallet?.reservations?.[idempotencyKey]?.amountPaise || 0);
  if (!amountPaise) throw new WalletError("Wallet order reservation was not found", 409, "reservation_missing");
  const beforePaise = walletBalancePaise(wallet);
  const afterPaise = beforePaise - amountPaise;
  const updated = updatedDocument(await wallets.findOneAndUpdate(
    { dealerId: dealerKey, balancePaise: { $gte: amountPaise }, [`reservations.${idempotencyKey}.amountPaise`]: amountPaise },
    { $inc: { balancePaise: -amountPaise, reservedPaise: -amountPaise }, $unset: { [`reservations.${idempotencyKey}`]: "" }, $set: { balance: fromPaise(afterPaise), updatedAt: nowDate() } },
    { returnDocument: "after" }
  ));
  if (!updated) throw new WalletError("Unable to finalize wallet debit", 409, "debit_conflict");
  const transaction = buildWalletTransaction({
    dealerId: dealerKey, type: "order_debit", amountPaise, balanceBeforePaise: beforePaise, balanceAfterPaise: afterPaise,
    relatedOrderId: order.id, relatedOrderNumber: order.number, reference: order.number || order.id,
    note: "Order Net Payable", idempotencyKey, ...actor,
  });
  try {
    const result = await db.collection(TRANSACTIONS_COLLECTION).insertOne(transaction);
    return normalizeWalletTransaction({ ...transaction, _id: result.insertedId });
  } catch (error) {
    const duplicate = await findExistingTransaction(db, dealerKey, idempotencyKey);
    if (duplicate) return normalizeWalletTransaction(duplicate);
    throw error;
  }
}

async function recordWalletPayment(db, dealerId, amountInput, options = {}) {
  const work = async () => {
    const wallet = await applyWalletChange(db, dealerId, "debit", amountInput, options);
    const ledger = await options.createLedgerEntry({ amount: wallet.amount, balanceBefore: wallet.balanceBefore, balanceAfter: wallet.balanceAfter, reference: options.reference, note: options.note });
    return { wallet, ledger };
  };
  if (options.client?.startSession) {
    const session = options.client.startSession();
    try { return await session.withTransaction(work); } finally { await session.endSession?.(); }
  }
  try { return await work(); } catch (error) {
    await applyWalletChange(db, dealerId, "refund", amountInput, { reference: options.rollbackReference, note: options.rollbackNote || "Wallet payment rollback", idempotencyKey: `${options.idempotencyKey || Date.now()}:rollback` });
    throw error;
  }
}

module.exports = {
  DEFAULT_HISTORY_LIMIT, WALLETS_COLLECTION, TRANSACTIONS_COLLECTION, WalletError,
  applyWalletChange, buildWalletTransaction, ensureWalletIndexes, finalizeOrderDebit,
  fromPaise, getWalletSnapshot, normalizeWalletTransaction, recordWalletPayment,
  releaseOrderReservation, reserveOrderFunds, roundMoney, setWalletStatus, toPaise, toPositiveAmount,
};
