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
      if (expected && typeof expected === "object" && "$gte" in expected) {
        return Number(row?.[key] ?? 0) >= Number(expected.$gte);
      }
      return String(row?.[key] ?? "") === String(expected);
    });
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
      Object.assign(row, update.$set);
    }
    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        row[key] = Number(row[key] ?? 0) + Number(value);
      }
    }

    return { value: this.cloneRow(row) };
  }

  async updateOne(filter, update) {
    const row = this.rows.find((item) => this.match(filter, item));
    if (!row) return { matchedCount: 0, modifiedCount: 0 };
    if (update.$set) Object.assign(row, update.$set);
    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        row[key] = Number(row[key] ?? 0) + Number(value);
      }
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }

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
    (error) => error instanceof WalletError && error.status === 400
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
