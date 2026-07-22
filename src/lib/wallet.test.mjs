import test from "node:test";
import assert from "node:assert/strict";
import wallet from "./wallet.js";

const {
  applyWalletChange,
  recordWalletPayment,
  WalletError,
} = wallet;

class FakeCursor {
  constructor(rows) {
    this.rows = rows;
  }
  sort(sortSpec) {
    const [[field, direction]] = Object.entries(sortSpec || {});
    this.rows.sort((a, b) => {
      const av = a?.[field] ?? "";
      const bv = b?.[field] ?? "";
      if (av < bv) return direction < 0 ? 1 : -1;
      if (av > bv) return direction < 0 ? -1 : 1;
      return 0;
    });
    return this;
  }
  limit(count) {
    this.rows = this.rows.slice(0, count);
    return this;
  }
  async toArray() {
    return this.rows.map((row) => ({ ...row }));
  }
}

class FakeCollection {
  constructor(rows = []) {
    this.rows = rows;
    this.nextId = 1;
  }

  cloneRow(row) {
    return row ? JSON.parse(JSON.stringify(row)) : null;
  }

  match(filter, row) {
    return Object.entries(filter || {}).every(([key, expected]) => {
      const actual = key.split(".").reduce((value, part) => value?.[part], row);
      if (expected && typeof expected === "object" && "$gte" in expected) {
        return Number(actual ?? 0) >= Number(expected.$gte);
      }
      if (expected && typeof expected === "object" && "$exists" in expected) {
        return (actual !== undefined) === expected.$exists;
      }
      return String(actual ?? "") === String(expected);
    });
  }

  setPath(row, key, value) {
    const parts = key.split(".");
    const last = parts.pop();
    const parent = parts.reduce((current, part) => current[part] ||= {}, row);
    if (last) parent[last] = value;
  }

  unsetPath(row, key) {
    const parts = key.split(".");
    const last = parts.pop();
    const parent = parts.reduce((current, part) => current?.[part], row);
    if (parent && last) delete parent[last];
  }

  async findOne(filter) {
    const row = this.rows.find((item) => this.match(filter, item));
    return this.cloneRow(row);
  }

  async findOneAndUpdate(filter, update, options = {}) {
    let row = this.rows.find((item) => this.match(filter, item));
    if (!row && !options.upsert) return { value: null };

    if (!row) {
      row = { _id: `fake-${this.nextId += 1}` };
      this.rows.push(row);
    }

    if (update.$setOnInsert && !row.createdAt) {
      Object.assign(row, update.$setOnInsert);
    }
    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) this.setPath(row, key, value);
    }
    if (update.$unset) for (const key of Object.keys(update.$unset)) this.unsetPath(row, key);
    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        row[key] = Number(row[key] ?? 0) + Number(value);
      }
    }

    return { value: this.cloneRow(row) };
  }

  async updateOne(filter, update, options = {}) {
    let row = this.rows.find((item) => this.match(filter, item));
    let inserted = false;
    if (!row && options.upsert) { row = { ...filter, _id: `fake-${this.nextId += 1}` }; this.rows.push(row); inserted = true; }
    if (!row) return { matchedCount: 0, modifiedCount: 0 };
    if (inserted && update.$setOnInsert) Object.assign(row, update.$setOnInsert);
    if (update.$set) for (const [key, value] of Object.entries(update.$set)) this.setPath(row, key, value);
    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        row[key] = Number(row[key] ?? 0) + Number(value);
      }
    }
    if (update.$unset) for (const key of Object.keys(update.$unset)) this.unsetPath(row, key);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async createIndex() { return "fake-index"; }

  async insertOne(doc) {
    const row = { ...doc, _id: `fake-${this.nextId += 1}` };
    this.rows.push(row);
    return { insertedId: row._id };
  }

  find(filter) {
    const rows = this.rows.filter((item) => this.match(filter, item)).map((row) => this.cloneRow(row));
    return new FakeCursor(rows);
  }
}

function createFakeDb(seed = {}) {
  const wallets = new FakeCollection(seed.wallets || []);
  const transactions = new FakeCollection(seed.transactions || []);
  const ledgerTransactions = new FakeCollection(seed.ledgerTransactions || []);

  const db = {
    collection(name) {
      if (name === "dealer_wallets") return wallets;
      if (name === "wallet_transactions") return transactions;
      if (name === "ledger_transactions") return ledgerTransactions;
      throw new Error(`Unknown collection: ${name}`);
    },
  };

  return { db, wallets, transactions, ledgerTransactions };
}

function createSessionSnapshot(store) {
  return JSON.parse(JSON.stringify({
    wallets: store.wallets.rows,
    transactions: store.transactions.rows,
    ledgerTransactions: store.ledgerTransactions.rows,
  }));
}

function restoreSessionSnapshot(store, snapshot) {
  store.wallets.rows = JSON.parse(JSON.stringify(snapshot.wallets));
  store.transactions.rows = JSON.parse(JSON.stringify(snapshot.transactions));
  store.ledgerTransactions.rows = JSON.parse(JSON.stringify(snapshot.ledgerTransactions));
}

function createFakeClient(store) {
  return {
    startSession() {
      return {
        async withTransaction(work) {
          const snapshot = createSessionSnapshot(store);
          try {
            return await work(this);
          } catch (error) {
            restoreSessionSnapshot(store, snapshot);
            throw error;
          }
        },
        async endSession() {},
      };
    },
  };
}

test("credit wallet adds balance and writes a transaction", async () => {
  const store = createFakeDb();
  const result = await applyWalletChange(store.db, "D-1", "credit", 2500, {
    reference: "TOPUP-1",
    note: "Opening balance",
  });

  assert.equal(result.balanceBefore, 0);
  assert.equal(result.balanceAfter, 2500);
  assert.equal(store.wallets.rows[0].balance, 2500);
  assert.equal(store.transactions.rows.length, 1);
  assert.equal(store.transactions.rows[0].type, "credit");
});

test("debit wallet subtracts balance and writes a transaction", async () => {
  const store = createFakeDb({
    wallets: [{ dealerId: "D-1", balance: 1000, createdAt: "2026-07-08T00:00:00.000Z" }],
  });

  const result = await applyWalletChange(store.db, "D-1", "debit", 400, {
    reference: "PAY-1",
    note: "Wallet payment",
  });

  assert.equal(result.balanceBefore, 1000);
  assert.equal(result.balanceAfter, 600);
  assert.equal(store.wallets.rows[0].balance, 600);
  assert.equal(store.transactions.rows[0].type, "debit");
});

test("debit wallet rejects insufficient balance", async () => {
  const store = createFakeDb({
    wallets: [{ dealerId: "D-1", balance: 100, createdAt: "2026-07-08T00:00:00.000Z" }],
  });

  await assert.rejects(
    () => applyWalletChange(store.db, "D-1", "debit", 400, { reference: "PAY-FAIL" }),
    (error) => error instanceof WalletError && error.status === 409
  );

  assert.equal(store.wallets.rows[0].balance, 100);
  assert.equal(store.transactions.rows.length, 0);
});

test("wallet payment rolls back when the ledger insert fails", async () => {
  const store = createFakeDb({
    wallets: [{ dealerId: "D-1", balance: 1000, createdAt: "2026-07-08T00:00:00.000Z" }],
  });
  const client = createFakeClient(store);

  await assert.rejects(
    () => recordWalletPayment(store.db, "D-1", 300, {
      client,
      reference: "BILL-1",
      note: "Payment from dealer",
      createLedgerEntry: async () => {
        throw new Error("ledger failed");
      },
    }),
    /ledger failed/
  );

  assert.equal(store.wallets.rows[0].balance, 1000);
  assert.equal(store.transactions.rows.length, 0);
  assert.equal(store.ledgerTransactions.rows.length, 0);
});

test("concurrent debit requests only allow the first debit to succeed", async () => {
  const store = createFakeDb({
    wallets: [{ dealerId: "D-1", balance: 500, createdAt: "2026-07-08T00:00:00.000Z" }],
  });

  const results = await Promise.allSettled([
    applyWalletChange(store.db, "D-1", "debit", 400, { reference: "PAY-A" }),
    applyWalletChange(store.db, "D-1", "debit", 200, { reference: "PAY-B" }),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(store.wallets.rows[0].balance, 100);
});

test("activation, top-up, and disable preserve balance and history", async () => {
  const store = createFakeDb();
  await applyWalletChange(store.db, "D-2", "activation", 5000, { idempotencyKey: "activate-credit", note: "Advance payment received" });
  await wallet.setWalletStatus(store.db, "D-2", "active", { idempotencyKey: "activate-status", note: "Advance payment received" });
  await applyWalletChange(store.db, "D-2", "credit", 800, { idempotencyKey: "topup-1", note: "Bank transfer received" });
  await wallet.setWalletStatus(store.db, "D-2", "inactive", { idempotencyKey: "disable-1", note: "Admin disabled wallet" });
  const snapshot = await wallet.getWalletSnapshot(store.db, "D-2");
  assert.equal(snapshot.status, "inactive");
  assert.equal(snapshot.balance, 5800);
  assert.equal(snapshot.transactions.length, 4);
});

test("top-up idempotency key credits only once", async () => {
  const store = createFakeDb();
  await applyWalletChange(store.db, "D-3", "credit", 1000, { idempotencyKey: "topup-same" });
  await applyWalletChange(store.db, "D-3", "credit", 1000, { idempotencyKey: "topup-same" });
  assert.equal((await wallet.getWalletSnapshot(store.db, "D-3")).balance, 1000);
  assert.equal(store.transactions.rows.length, 1);
});

test("active order reservation prevents overspend and final debit is linked once", async () => {
  const store = createFakeDb({ wallets: [{ dealerId: "D-4", status: "active", balancePaise: 500000, balance: 5000, reservedPaise: 0 }] });
  await wallet.reserveOrderFunds(store.db, "D-4", 4200, { idempotencyKey: "order:D-4:1" });
  await assert.rejects(() => wallet.reserveOrderFunds(store.db, "D-4", 1000, { idempotencyKey: "order:D-4:2" }), /Insufficient wallet balance/);
  const debit = await wallet.finalizeOrderDebit(store.db, "D-4", "order:D-4:1", { id: "101", number: "OM/2026/0101" }, { actorId: "D-4", actorRole: "dealer" });
  assert.equal(debit.amount, 4200);
  assert.equal(debit.balanceAfter, 800);
  assert.equal(debit.relatedOrderId, "101");
  assert.equal(store.transactions.rows.length, 1);
});

test("failed order releases reservation without consuming funds", async () => {
  const store = createFakeDb({ wallets: [{ dealerId: "D-5", status: "active", balancePaise: 100000, balance: 1000, reservedPaise: 0 }] });
  await wallet.reserveOrderFunds(store.db, "D-5", 600, { idempotencyKey: "order:D-5:1" });
  await wallet.releaseOrderReservation(store.db, "D-5", "order:D-5:1");
  const snapshot = await wallet.getWalletSnapshot(store.db, "D-5");
  assert.equal(snapshot.balance, 1000);
  assert.equal(snapshot.availableBalance, 1000);
  assert.equal(store.transactions.rows.length, 0);
});
