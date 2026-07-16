import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const activePeriodUrl = pathToFileURL(path.resolve("src/lib/activeOrderPeriod.js")).href;
const staffScopeUrl = pathToFileURL(path.resolve("src/lib/staffOrderScope.js")).href;

function moduleUrl(source, fileName) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName,
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const paginationSource = (await fs.readFile(path.resolve("src/lib/activeOrdersPagination.ts"), "utf8"))
  .replace(/from\s+["']@\/lib\/activeOrderPeriod\.js["']/g, `from "${activePeriodUrl}"`)
  .replace(/from\s+["']@\/lib\/staffOrderScope\.js["']/g, `from "${staffScopeUrl}"`);
const paginationUrl = moduleUrl(paginationSource, "activeOrdersPagination.ts");
const mongoStubUrl = `data:text/javascript,${encodeURIComponent("export async function getDb(){throw new Error('unused mongo stub')}")}`;
const snapshotSource = (await fs.readFile(path.resolve("src/lib/activeOrderSnapshot.ts"), "utf8"))
  .replace(/from\s+["']@\/lib\/activeOrderPeriod\.js["']/g, `from "${activePeriodUrl}"`)
  .replace(/from\s+["']@\/lib\/activeOrdersPagination["']/g, `from "${paginationUrl}"`)
  .replace(/from\s+["']@\/lib\/mongodb["']/g, `from "${mongoStubUrl}"`);
const snapshots = await import(moduleUrl(snapshotSource, "activeOrderSnapshot.ts"));
const pagination = await import(paginationUrl);
const staffScope = await import(staffScopeUrl);

function order(id, dealer = "101", extra = {}) {
  return Object.freeze({
    order_id: id,
    order_date: "2026-07-14 10:30:00",
    order_dealer: dealer,
    order_status: "pending",
    accept_order: "0",
    Dealer_Name: dealer === "101" ? "Dealer A" : "Dealer B",
    ...extra,
  });
}

function build(rows, exact = true) {
  return {
    rows,
    exact,
    diagnostics: { upstreamCalls: 1, upstreamHeaders: rows.length, fetchMs: 5, filterMs: 1 },
  };
}

class MemoryRepository {
  snapshots = new Map();
  locks = new Map();
  commits = 0;
  lockAttempts = 0;
  invalidations = 0;
  lastLease = null;

  async ensureIndexes() {}
  async read(key) { return this.snapshots.get(key) ?? null; }
  async commit(key, generation, result, syncedAt, staleAt) {
    this.commits += 1;
    this.snapshots.set(key, {
      key, generation, rows: result.rows, syncedAt, staleAt,
      exact: result.exact, diagnostics: result.diagnostics,
    });
  }
  async acquireLock(key, token, now, expiresAt) {
    this.lockAttempts += 1;
    this.lastLease = { now, expiresAt };
    const current = this.locks.get(key);
    if (current && current.expiresAt > now) return false;
    this.locks.set(key, { token, expiresAt });
    return true;
  }
  async releaseLock(key, token) {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
  }
  async markAllStale(reason, at) {
    for (const [key, value] of this.snapshots) {
      this.snapshots.set(key, { ...value, staleAt: new Date(0), invalidationReason: reason, invalidatedAt: at });
    }
    this.invalidations += 1;
    return this.snapshots.size;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("cold sync runs once, warm requests run zero scans, and ten cold callers share one sync", async () => {
  const repository = new MemoryRepository();
  const coordinator = snapshots.createActiveOrderSnapshotCoordinator(repository);
  let scans = 0;
  const builder = async () => { scans += 1; return build([order("warm")]); };

  assert.equal((await coordinator.load("admin", builder)).state, "refreshed");
  assert.equal((await coordinator.load("admin", builder)).state, "fresh");
  assert.equal(scans, 1);

  const concurrentRepository = new MemoryRepository();
  const concurrent = snapshots.createActiveOrderSnapshotCoordinator(concurrentRepository);
  const gate = deferred();
  let concurrentScans = 0;
  const sharedBuilder = async () => {
    concurrentScans += 1;
    await gate.promise;
    return build([order("shared")]);
  };
  const requests = Array.from({ length: 10 }, () => concurrent.load("staff-29", sharedBuilder));
  gate.resolve();
  const results = await Promise.all(requests);

  assert.equal(concurrentScans, 1);
  assert.equal(concurrentRepository.commits, 1);
  assert.equal(concurrentRepository.lockAttempts, 1);
  assert.equal(results.every((result) => result.snapshot.rows[0].order_id === "shared"), true);
});

test("stale data is served immediately while one refresh replaces it", async () => {
  const repository = new MemoryRepository();
  let clock = new Date("2026-07-16T10:00:00.000Z");
  const coordinator = snapshots.createActiveOrderSnapshotCoordinator(repository, {
    now: () => clock,
    freshMs: 1_000,
  });
  await coordinator.load("dealer-a", async () => build([order("previous")]));
  clock = new Date(clock.getTime() + 2_000);

  const gate = deferred();
  let refreshes = 0;
  const refresh = async () => {
    refreshes += 1;
    await gate.promise;
    return build([order("current")]);
  };
  const first = await coordinator.load("dealer-a", refresh);
  const second = await coordinator.load("dealer-a", refresh);
  assert.equal(first.state, "stale");
  assert.equal(first.snapshot.rows[0].order_id, "previous");
  assert.equal(second.snapshot.rows[0].order_id, "previous");
  assert.equal(refreshes, 1);

  gate.resolve();
  await Promise.all([first.refreshPromise, second.refreshPromise]);
  assert.equal((await repository.read("dealer-a")).rows[0].order_id, "current");
});

test("failed and inexact refreshes never replace a valid snapshot", async () => {
  const repository = new MemoryRepository();
  let clock = new Date("2026-07-16T10:00:00.000Z");
  const coordinator = snapshots.createActiveOrderSnapshotCoordinator(repository, {
    now: () => clock,
    freshMs: 1_000,
  });
  await coordinator.load("admin", async () => build([order("valid")]));
  clock = new Date(clock.getTime() + 2_000);
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const failed = await coordinator.load("admin", async () => { throw new Error("upstream failed"); });
    await failed.refreshPromise;
    const partial = await coordinator.load("admin", async () => build([order("partial")], false));
    await partial.refreshPromise;
  } finally {
    console.error = originalError;
  }
  assert.equal(repository.commits, 1);
  assert.equal((await repository.read("admin")).rows[0].order_id, "valid");
});

test("snapshot keys isolate Admin, Staff, Dealer A, and Dealer B", () => {
  const key = (source, actor, assignedDealerIds, upstreamActorIds) => snapshots.buildActiveOrderSnapshotKey({
    source, actor, assignedDealerIds, upstreamActorIds,
  });
  const keys = [
    key("orderpegination", { role: "admin", actorId: "" }, [], [""]),
    key("staffOrderrPagination", { role: "staff", actorId: "29" }, ["101"], ["29"]),
    key("orderhispegination", { role: "dealer", actorId: "101" }, [], ["101"]),
    key("orderhispegination", { role: "dealer", actorId: "202" }, [], ["202"]),
  ];
  assert.equal(new Set(keys).size, 4);
  assert.equal(keys.every((value) => value.includes("orders-from-2026-07-13-v1")), true);
});

test("storage boundary excludes old and malformed dates and preserves source values", () => {
  const active = order("active");
  const old = Object.freeze({ ...order("old"), order_date: "2026-07-12 23:59:59" });
  const malformed = Object.freeze({ ...order("bad"), order_date: "bad-date" });
  const dates = [active.order_date, old.order_date, malformed.order_date];

  assert.equal(snapshots.sanitizeActiveOrderHeader(active).order_date, active.order_date);
  assert.equal(snapshots.sanitizeActiveOrderHeader(old), null);
  assert.equal(snapshots.sanitizeActiveOrderHeader(malformed), null);
  assert.deepEqual([active.order_date, old.order_date, malformed.order_date], dates);
});

test("role filtering, exact 10/10/8 pagination, search, and status all use snapshot rows", () => {
  const dealerA = Array.from({ length: 28 }, (_, index) => order(`A-${index + 1}`, "101", {
    marker: index < 12 ? "Flask" : "Beaker",
    order_status: index < 8 ? "pending" : "accepted",
  }));
  const dealerB = Array.from({ length: 9 }, (_, index) => order(`B-${index + 1}`, "202"));
  const staffRows = staffScope.filterOrdersForActor({
    role: "staff", actorId: "29", assignedDealerIds: ["101"], orders: [...dealerA, ...dealerB],
  });
  const pages = [1, 2, 3].map((page) => pagination.buildActiveOrdersPage({ rows: staffRows, page, pageSize: 10 }));
  const flask = pagination.buildActiveOrdersPage({ rows: staffRows, page: 1, pageSize: 10, filters: { search: "Flask" } });
  const pending = pagination.buildActiveOrdersPage({ rows: staffRows, page: 1, pageSize: 10, filters: { orderStatus: "pending" } });

  assert.deepEqual(pages.map((result) => result.items.length), [10, 10, 8]);
  assert.deepEqual({ total: pages[0].total, totalPages: pages[0].totalPages }, { total: 28, totalPages: 3 });
  assert.equal(new Set(pages.flatMap((result) => result.items.map((row) => row.order_id))).size, 28);
  assert.deepEqual({ total: flask.total, pages: flask.totalPages }, { total: 12, pages: 2 });
  assert.deepEqual({ total: pending.total, pages: pending.totalPages }, { total: 8, pages: 1 });
});

test("mutation invalidation and expiring refresh leases are bounded", async () => {
  const repository = new MemoryRepository();
  let clock = new Date("2026-07-16T10:00:00.000Z");
  const coordinator = snapshots.createActiveOrderSnapshotCoordinator(repository, {
    now: () => clock,
    lockMs: 5_000,
  });
  await coordinator.load("admin", async () => build([order("1")]));
  await coordinator.load("dealer", async () => build([order("2")]));
  assert.equal(await coordinator.invalidate("order accepted"), 2);
  assert.equal(repository.invalidations, 1);
  assert.equal((await repository.read("admin")).staleAt.getTime(), 0);
  assert.equal(repository.lastLease.expiresAt.getTime() - repository.lastLease.now.getTime(), 5_000);

  repository.snapshots.delete("admin");
  repository.locks.set("admin", { token: "abandoned", expiresAt: new Date(clock.getTime() - 1) });
  clock = new Date(clock.getTime() + 1);
  await coordinator.load("admin", async () => build([order("3")]));
  assert.equal(repository.lockAttempts, 3);
});

test("production consumers share header snapshots and mutations invalidate them", async () => {
  const files = await Promise.all([
    "src/lib/activeOrderSnapshot.ts",
    "src/app/api/active-orders/route.ts",
    "src/app/api/pending-products/route.ts",
    "src/app/api/dashboard-search/route.ts",
    "src/app/api/reports/dealer-category/route.ts",
    "src/lib/ledgerSystem.ts",
    "src/app/api/dealer-order/route.ts",
    "src/app/Pages/Ordermanagement/page.tsx",
  ].map((file) => fs.readFile(path.resolve(file), "utf8")));
  const [snapshot, route, pending, search, report, ledger, dealerOrder, orderList] = files;

  for (const source of [route, pending, search, report, ledger]) assert.match(source, /loadActiveOrderHeaders/);
  assert.match(pending, /cached\?\.refreshToken !== refreshToken/);
  assert.match(dealerOrder, /invalidateActiveOrderSnapshots/);
  assert.match(orderList, /invalidateActiveOrderSnapshot\('order deleted'/);
  assert.match(orderList, /invalidateActiveOrderSnapshot\(status === 1/);
  assert.doesNotMatch(snapshot, /orderdatalist|invoice_(?:document|pdf)|product[_ -]notes|dispatchHistory/i);
  for (const index of [
    "snapshot_generation_order_unique",
    "snapshot_generation_position",
    "snapshot_generation_dealer_position",
    "expired_snapshot_locks",
  ]) assert.match(snapshot, new RegExp(index));
});
