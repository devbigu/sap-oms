import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

async function loadLedgerModule() {
  const filePath = path.resolve("src/lib/ledgerSystem.ts");
  const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const mongodbStub = dataModule(`export async function getDb(){throw new Error("unused")}`);
  const amountStub = dataModule(`export function resolveOrderAmounts(o){const gross=Number(o.order_amount||0);const discount=Number(o.order_discount||0);return {netPayable:Number(o.order_net_amount??(gross-discount))}};export function withDisplayOrderAmounts(o){return o}`);
  const headersStub = dataModule(`export async function loadOrderHeaders(){return {rows:[]}}`);
  const source = (await fs.readFile(filePath, "utf8"))
    .replace(/import\s+\{\s*Db\s*\}\s+from\s+["']mongodb["'];?/, "")
    .replace(/from\s+["']@\/lib\/mongodb["']/g, `from "${mongodbStub}"`)
    .replace(/from\s+["']@\/lib\/orderHeaders["']/g, `from "${headersStub}"`)
    .replace(/from\s+["']@\/lib\/orderAmounts["']/g, `from "${amountStub}"`);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const ledger = await loadLedgerModule();
const dealerId = "101";

const oldOrder = {
  order_id: 12001,
  order_dealer: 101,
  order_date: "2026-07-12 23:59:59",
  order_amount: 100000,
  accept_order: "1",
  del_status: "0",
};
const activeOrder = {
  order_id: "13001",
  order_dealer: "101",
  order_date: "2026-07-13 00:00:00",
  order_amount: 50000,
  accept_order: 1,
  del_status: 0,
};

test("ledger booked debit includes old orders with numeric or string identifiers", () => {
  const scoped = ledger.ordersForDealer([oldOrder, activeOrder], dealerId);
  assert.deepEqual(scoped.map((order) => String(order.order_id)), ["12001", "13001"]);
  assert.deepEqual(ledger.summarizeOrders([oldOrder, activeOrder]), {
    booked: 150000,
    bookedCount: 2,
    sentAndSettled: 0,
    sentAndSettledCount: 0,
    supposedToGo: 150000,
    supposedToGoCount: 2,
    awaiting: 0,
    awaitingCount: 0,
  });
});

test("active order debit minus a manual payment produces the dealer balance", () => {
  const bookedPaise = ledger.orderNetPaise(activeOrder);
  const paymentPaise = ledger.paymentCreditPaise({ type: "payment", amount: 20000 });
  assert.equal(bookedPaise, 5_000_000);
  assert.equal(paymentPaise, 2_000_000);
  assert.equal((bookedPaise - paymentPaise) / 100, 30000);
});

test("historical manual payments remain credits alongside older orders", () => {
  const activeOrders = ledger.ordersForDealer([oldOrder], dealerId);
  const bookedPaise = activeOrders.reduce((sum, order) => sum + ledger.orderNetPaise(order), 0);
  const historicalPaymentPaise = ledger.paymentCreditPaise({
    type: "payment",
    amount: 80000,
    date: "2026-07-01",
  });

  assert.equal(bookedPaise, 10_000_000);
  assert.equal(historicalPaymentPaise, 8_000_000);
  assert.equal((bookedPaise - historicalPaymentPaise) / 100, 20000);
});

test("cached ledger snapshots are versioned for all orders without date filtering", async () => {
  const source = await fs.readFile(path.resolve("src/lib/ledgerSystem.ts"), "utf8");
  assert.match(source, /collective_ledger_snapshot:all-orders-v1/);
  assert.match(source, /orders:\s*Array\.isArray\(doc\.orders\)/);
  assert.doesNotMatch(source, /filterActiveOrders/);
});
