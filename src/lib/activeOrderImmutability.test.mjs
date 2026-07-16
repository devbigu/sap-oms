import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import activePeriod from "./activeOrderPeriod.js";
import { filterOrdersForActor } from "./staffOrderScope.js";

async function transpileModule(filePath, replacements) {
  const source = (await fs.readFile(filePath, "utf8"));
  const rewritten = replacements.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), source);
  const output = ts.transpileModule(rewritten, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const activePeriodUrl = pathToFileURL(path.resolve("src/lib/activeOrderPeriod.js")).href;
const staffScopeUrl = pathToFileURL(path.resolve("src/lib/staffOrderScope.js")).href;
const snapshotStubUrl = `data:text/javascript,${encodeURIComponent(`
  export async function readActiveOrderHeadersSnapshot() {
    return { key: "stub", state: "miss", rows: [], diagnostics: null };
  }
`)}`;
const paginationUrl = await transpileModule(path.resolve("src/lib/activeOrdersPagination.ts"), [
  [/from\s+["']@\/lib\/activeOrderPeriod\.js["']/g, `from "${activePeriodUrl}"`],
  [/from\s+["']@\/lib\/staffOrderScope\.js["']/g, `from "${staffScopeUrl}"`],
]);
const dealerViewUrl = await transpileModule(path.resolve("src/lib/dealerOrderView.ts"), [
  [/from\s+["']@\/lib\/staffOrderScope\.js["']/g, `from "${staffScopeUrl}"`],
]);
const accessUrl = await transpileModule(path.resolve("src/lib/activeOrderAccess.ts"), [
  [/from\s+["']@\/lib\/activeOrderPeriod\.js["']/g, `from "${activePeriodUrl}"`],
  [/from\s+["']@\/lib\/activeOrderSnapshot["']/g, `from "${snapshotStubUrl}"`],
]);
const pagination = await import(paginationUrl);
const dealerView = await import(dealerViewUrl);
const activeAccess = await import(accessUrl);

let dateSetterCalls = 0;
class SetterGuardDate extends Date {
  setDate() { dateSetterCalls += 1; throw new Error("setDate called"); }
  setUTCDate() { dateSetterCalls += 1; throw new Error("setUTCDate called"); }
  setTime() { dateSetterCalls += 1; throw new Error("setTime called"); }
  setFullYear() { dateSetterCalls += 1; throw new Error("setFullYear called"); }
  setUTCFullYear() { dateSetterCalls += 1; throw new Error("setUTCFullYear called"); }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function snapshotOrder(order) {
  return {
    keys: Object.keys(order),
    values: Object.fromEntries(Object.entries(order).map(([key, value]) => [
      key,
      value instanceof Date ? { dateMs: value.getTime(), constructor: value.constructor.name } : value,
    ])),
  };
}

function assertOrderUnchanged(order, snapshot) {
  assert.deepEqual(Object.keys(order), snapshot.keys);
  for (const [key, expected] of Object.entries(snapshot.values)) {
    if (order[key] instanceof Date) {
      assert.deepEqual({ dateMs: order[key].getTime(), constructor: order[key].constructor.name }, expected);
    } else {
      assert.deepEqual(order[key], expected);
    }
  }
  assert.equal("normalized_order_date" in order, false);
  assert.equal("normalizedDate" in order, false);
  assert.equal("activeOrderDate" in order, false);
}

function fixture(id, orderDate, dealerId = "101", extra = {}) {
  return deepFreeze({
    order_id: id,
    order_date: orderDate,
    order_dealer: dealerId,
    accept_order: "1",
    del_status: "0",
    ...extra,
  });
}

test("date extraction and visibility never rewrite supported original date values", () => {
  dateSetterCalls = 0;
  const orders = [
    fixture("old-sql", "2026-07-12 23:59:59"),
    fixture("cutoff-sql", "2026-07-13 00:00:00"),
    fixture("later-sql", "2026-07-14 10:30:00"),
    fixture("date-only", "2026-07-14"),
    fixture("slash-dmy", "14/07/2026"),
    fixture("dash-dmy", "14-07-2026"),
    fixture("date-object", new SetterGuardDate("2026-07-14T04:30:00.000Z")),
  ];
  const snapshots = orders.map(snapshotOrder);

  for (const order of orders) {
    activePeriod.getOriginalOrderDate(order);
    activePeriod.isActiveOrder(order);
  }

  orders.forEach((order, index) => assertOrderUnchanged(order, snapshots[index]));
  assert.equal(dateSetterCalls, 0);
});

test("array filtering, role scoping, sorting, and pagination leave frozen inputs and ordering unchanged", () => {
  const orders = deepFreeze([
    fixture("old", "2026-07-12 23:59:59"),
    fixture("cutoff", "2026-07-13 00:00:00"),
    fixture("later", "2026-07-14 10:30:00"),
    fixture("foreign", "2026-07-15", "202"),
  ]);
  const originalArray = [...orders];
  const snapshots = orders.map(snapshotOrder);

  const active = activePeriod.filterActiveOrders(orders);
  const scoped = filterOrdersForActor({ role: "dealer", actorId: 101, orders });
  const view = dealerView.buildDealerOrderView(orders, "101");
  const page = pagination.buildActiveOrdersPage({ rows: scoped, page: 1, pageSize: 1 });

  assert.deepEqual(active.map((order) => order.order_id), ["cutoff", "later", "foreign"]);
  assert.deepEqual(scoped.map((order) => order.order_id), ["cutoff", "later"]);
  assert.deepEqual(view.recentOrders.map((order) => order.order_id), ["later", "cutoff"]);
  assert.deepEqual(page.items.map((order) => order.order_id), ["cutoff"]);
  assert.deepEqual([...orders], originalArray);
  assert.deepEqual(orders.map((order) => order.order_id), ["old", "cutoff", "later", "foreign"]);
  orders.forEach((order, index) => assertOrderUnchanged(order, snapshots[index]));
});

test("direct access verification reads a frozen order header without persistence or date mutation", async () => {
  const order = fixture("immutability-direct-14001", "2026-07-14 10:30:00");
  const snapshot = snapshotOrder(order);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    return { ok: true, status: 200, json: async () => ({ data: [order] }) };
  };

  try {
    const result = await activeAccess.resolveActiveOrder(order.order_id, order.order_dealer);
    assert.equal(result.visible, true);
    assert.equal(result.order, order);
    assert.deepEqual(calls.map((call) => call.method), ["GET"]);
    assert.equal(calls.some((call) => /update|save|insert|delete/i.test(call.url)), false);
    assertOrderUnchanged(order, snapshot);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cutoff implementation contains no source-date assignments, mutating array methods, setters, or persistence writes", async () => {
  const source = await fs.readFile(path.resolve("src/lib/activeOrderPeriod.js"), "utf8");
  assert.doesNotMatch(source, /\b(?:order_date|orderDate|order_datetime|orderDatetime)\s*=/);
  assert.doesNotMatch(source, /\.(?:setDate|setUTCDate|setTime|setFullYear|setUTCFullYear|sort|splice)\s*\(/);
  assert.doesNotMatch(source, /updateOne|updateMany|findOneAndUpdate|insertOne|fetch\s*\(/);
});
