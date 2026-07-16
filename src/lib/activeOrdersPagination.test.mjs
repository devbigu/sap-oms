import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const activePeriodUrl = pathToFileURL(path.resolve("src/lib/activeOrderPeriod.js")).href;
const staffScopeUrl = pathToFileURL(path.resolve("src/lib/staffOrderScope.js")).href;
const source = (await fs.readFile(path.resolve("src/lib/activeOrdersPagination.ts"), "utf8"))
  .replace(/from\s+["']@\/lib\/activeOrderPeriod\.js["']/g, `from "${activePeriodUrl}"`)
  .replace(/from\s+["']@\/lib\/staffOrderScope\.js["']/g, `from "${staffScopeUrl}"`);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: "activeOrdersPagination.ts",
}).outputText;
const pagination = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

function order(id, date, dealerId = "101", extra = {}) {
  return Object.freeze({
    order_id: id,
    order_date: date,
    order_dealer: dealerId,
    accept_order: "1",
    del_status: "0",
    ...extra,
  });
}

function oldOrders(prefix, count) {
  return Array.from({ length: count }, (_, index) => order(`${prefix}-old-${index + 1}`, "2026-07-12 23:59:59"));
}

function activeOrders(prefix, count, extra = {}) {
  return Array.from({ length: count }, (_, index) => order(`${prefix}-active-${index + 1}`, "2026-07-14 10:30:00", "101", extra));
}

async function scanPages(pages, options = {}) {
  const calls = [];
  const scan = await pagination.scanScopedActiveOrders({
    actor: options.actor ?? { role: "admin", actorId: "admin" },
    assignedDealerIds: options.assignedDealerIds ?? [],
    upstreamActorIds: options.upstreamActorIds ?? [""],
    upstreamPageSize: options.upstreamPageSize ?? 10,
    maxUpstreamPages: options.maxUpstreamPages ?? 20,
    fetchPage: async (actorId, page) => {
      calls.push(`${actorId}:${page}`);
      return { rows: pages[page - 1] ?? [], lastPage: options.lastPage };
    },
  });
  return { scan, calls };
}

test("all-old upstream page 1 is replaced by active upstream page 2 in visible page 1", async () => {
  const old = oldOrders("p1", 10);
  const visible = activeOrders("p2", 10);
  const originalDates = [...old, ...visible].map((item) => item.order_date);
  const { scan, calls } = await scanPages([old, visible, []]);
  const page = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 1, pageSize: 10 });

  assert.deepEqual(page.items.map((item) => item.order_id), visible.map((item) => item.order_id));
  assert.equal(page.total, 10);
  assert.equal(page.totalPages, 1);
  assert.deepEqual(calls, [":1", ":2", ":3"]);
  assert.deepEqual([...old, ...visible].map((item) => item.order_date), originalDates);
});

test("mixed upstream pages rebuild two complete visible pages without duplicates or skipped IDs", async () => {
  const expected = [
    ...activeOrders("p1", 3),
    ...activeOrders("p2", 6),
    ...activeOrders("p3", 8),
  ];
  const pages = [
    [...oldOrders("p1", 7), ...expected.slice(0, 3)],
    [...oldOrders("p2", 4), ...expected.slice(3, 9)],
    expected.slice(9),
  ];
  const sourceOrder = pages.flat().map((item) => item.order_id);
  const sourceDates = pages.flat().map((item) => item.order_date);
  const { scan, calls } = await scanPages(pages);
  const page1 = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 1, pageSize: 10 });
  const page2 = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 2, pageSize: 10 });
  const visibleIds = [...page1.items, ...page2.items].map((item) => item.order_id);

  assert.equal(page1.total, 17);
  assert.equal(page1.totalPages, 2);
  assert.equal(page1.items.length, 10);
  assert.equal(page2.items.length, 7);
  assert.deepEqual(visibleIds, expected.map((item) => item.order_id));
  assert.equal(new Set(visibleIds).size, 17);
  assert.deepEqual(calls, [":1", ":2", ":3"]);
  assert.deepEqual(pages.flat().map((item) => item.order_id), sourceOrder);
  assert.deepEqual(pages.flat().map((item) => item.order_date), sourceDates);
});

test("role scope is applied before page totals for Admin, assigned Staff, and Dealer A", async () => {
  const rows = [
    order("A-active-1", "2026-07-13", 101),
    order("B-active-1", "2026-07-13", "202"),
    order("A-old", "2026-07-12", "101"),
    order("A-active-2", "2026-07-14", "101"),
    order("B-active-2", "2026-07-14", 202),
  ];
  const cases = [
    { actor: { role: "admin", actorId: "admin" }, assignedDealerIds: [], ids: ["A-active-1", "B-active-1", "A-active-2", "B-active-2"] },
    { actor: { role: "staff", actorId: "29" }, assignedDealerIds: [101], ids: ["A-active-1", "A-active-2"] },
    { actor: { role: "dealer", actorId: "101" }, assignedDealerIds: [], ids: ["A-active-1", "A-active-2"] },
  ];

  for (const item of cases) {
    const { scan } = await scanPages([rows], { actor: item.actor, assignedDealerIds: item.assignedDealerIds, upstreamPageSize: 10 });
    const page = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 1, pageSize: 2 });
    assert.deepEqual(scan.rows.map((row) => row.order_id), item.ids);
    assert.equal(page.total, item.ids.length);
    assert.equal(page.totalPages, Math.ceil(item.ids.length / 2));
    assert.deepEqual(page.items.map((row) => row.order_id), item.ids.slice(0, 2));
  }
});

test("page beyond the final visible page is empty with accurate metadata", async () => {
  const { scan } = await scanPages([activeOrders("visible", 7)]);
  const page = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 3, pageSize: 10 });
  assert.deepEqual(page.items, []);
  assert.equal(page.total, 7);
  assert.equal(page.totalPages, 1);
});

test("missing and malformed dates never count or fill visible pages", async () => {
  const rows = [
    order("missing", undefined),
    order("malformed", "July-ish"),
    order("visible", "2026-07-13 00:00:00"),
  ];
  const { scan } = await scanPages([rows]);
  const page = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 1, pageSize: 10 });
  assert.deepEqual(page.items.map((item) => item.order_id), ["visible"]);
  assert.equal(page.total, 1);
  assert.equal(rows[0].order_date, undefined);
  assert.equal(rows[1].order_date, "July-ish");
});

test("search and status totals are calculated after cutoff filtering", async () => {
  const active = Array.from({ length: 40 }, (_, index) => order(
    `active-${index + 1}`,
    "2026-07-14",
    index % 2 === 0 ? "101" : "202",
    {
      product_marker: index < 12 ? "Flask" : "Beaker",
      accept_order: index < 10 ? "0" : "1",
      order_status: index < 10 ? "pending" : index < 15 ? "rejected" : "accepted",
    },
  ));
  const allRows = [...oldOrders("history", 60), ...active];
  const pages = Array.from({ length: 4 }, (_, index) => allRows.slice(index * 25, index * 25 + 25));
  const { scan } = await scanPages(pages, { upstreamPageSize: 25, lastPage: 4 });

  const flask = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 1, pageSize: 10, filters: { search: "Flask" } });
  const pending = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 1, pageSize: 10, filters: { orderStatus: "pending" } });
  const accepted = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 1, pageSize: 10, filters: { accepted: "1" } });
  const rejected = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 1, pageSize: 10, filters: { orderStatus: "rejected" } });

  assert.deepEqual({ total: flask.total, totalPages: flask.totalPages }, { total: 12, totalPages: 2 });
  assert.deepEqual({ total: pending.total, totalPages: pending.totalPages }, { total: 10, totalPages: 1 });
  assert.deepEqual({ total: accepted.total, totalPages: accepted.totalPages }, { total: 30, totalPages: 3 });
  assert.deepEqual({ total: rejected.total, totalPages: rejected.totalPages }, { total: 5, totalPages: 1 });
});

test("Staff and Dealer search totals remain scoped before pagination", async () => {
  const rows = [
    ...activeOrders("A-flask", 8, { product_marker: "Flask" }),
    ...Array.from({ length: 9 }, (_, index) => order(`B-flask-${index}`, "2026-07-14", "202", { product_marker: "Flask" })),
  ];
  for (const scope of [
    { actor: { role: "staff", actorId: "29" }, assignedDealerIds: ["101"] },
    { actor: { role: "dealer", actorId: "101" }, assignedDealerIds: [] },
  ]) {
    const { scan } = await scanPages([rows], { ...scope, upstreamPageSize: 20 });
    const page = pagination.buildActiveOrdersPage({ rows: scan.rows, page: 1, pageSize: 5, filters: { search: "Flask" } });
    assert.equal(page.total, 8);
    assert.equal(page.totalPages, 2);
    assert.equal(page.items.every((item) => String(item.order_dealer) === "101"), true);
  }
});

test("scanner stops on exhaustion without duplicate page requests", async () => {
  const { scan, calls } = await scanPages([activeOrders("full", 10), activeOrders("short", 4)]);
  assert.deepEqual(calls, [":1", ":2"]);
  assert.equal(new Set(calls).size, calls.length);
  assert.equal(scan.truncated, false);
  assert.equal(scan.totalIsExact, true);
});

test("scanner respects the safety limit and marks totals as inexact", async () => {
  const pages = [activeOrders("one", 10), activeOrders("two", 10), activeOrders("three", 10), activeOrders("unread", 10)];
  const { scan, calls } = await scanPages(pages, { maxUpstreamPages: 3 });
  assert.deepEqual(calls, [":1", ":2", ":3"]);
  assert.equal(scan.rows.length, 30);
  assert.equal(scan.truncated, true);
  assert.equal(scan.totalIsExact, false);
});

test("duplicate upstream order IDs are emitted once in stable first-seen order", async () => {
  const duplicate = order("duplicate", "2026-07-14");
  const { scan } = await scanPages([
    [duplicate, ...activeOrders("first", 9)],
    [duplicate, ...activeOrders("second", 2)],
  ]);
  const ids = scan.rows.map((item) => item.order_id);
  assert.equal(ids.filter((id) => id === "duplicate").length, 1);
  assert.equal(ids[0], "duplicate");
});

test("real route delegates scanning and visible pagination to the tested adapter", async () => {
  const route = await fs.readFile(path.resolve("src/app/api/active-orders/route.ts"), "utf8");
  assert.match(route, /scanScopedActiveOrders/);
  assert.match(route, /buildActiveOrdersPage/);
  assert.match(route, /totalIsExact: scan\.totalIsExact/);
});
