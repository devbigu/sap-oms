import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadAccessModule() {
  const filePath = path.resolve("src/lib/activeOrderAccess.ts");
  const activePeriodUrl = pathToFileURL(path.resolve("src/lib/activeOrderPeriod.js")).href;
  const snapshotStubUrl = `data:text/javascript,${encodeURIComponent(`
    export async function readActiveOrderHeadersSnapshot(input) {
      globalThis.__activeOrderSnapshotReads = (globalThis.__activeOrderSnapshotReads ?? []);
      globalThis.__activeOrderSnapshotReads.push(input);
      if (globalThis.__activeOrderSnapshotThrows) throw new Error("snapshot unavailable");
      return { key: "stub", state: globalThis.__activeOrderSnapshotState ?? "miss", rows: globalThis.__activeOrderSnapshotRows ?? [], diagnostics: null };
    }
  `)}`;
  const source = (await fs.readFile(filePath, "utf8")).replace(
    /from\s+["']@\/lib\/activeOrderPeriod\.js["']/g,
    `from "${activePeriodUrl}"`,
  ).replace(
    /from\s+["']@\/lib\/activeOrderSnapshot["']/g,
    `from "${snapshotStubUrl}"`,
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const access = await loadAccessModule();

async function withFetchRows(rows, callback) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ data: rows }) };
  };
  try {
    await callback(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("direct active-order resolution hides a pre-cutoff header without requesting order detail data", async () => {
  await withFetchRows(
    [{ order_id: "access-old-12001", order_date: "2026-07-12 23:59:59" }],
    async (calls) => {
      const result = await access.resolveActiveOrder("access-old-12001");
      assert.deepEqual({ visible: result.visible, order: result.order }, { visible: false, order: null });
      assert.equal(result.reason, "before_cutoff");
      assert.equal(result.message, "This order is outside the active order period.");
      assert.equal(calls.length, 1);
      assert.match(calls[0], /orderpegination/);
      assert.doesNotMatch(calls[0], /orderdatalist|notes|dispatch|invoice|override/);
    },
  );
});

test("direct active-order resolution includes the exact cutoff timestamp", async () => {
  await withFetchRows(
    [{ order_id: "access-cutoff-13001", order_date: "2026-07-13 00:00:00" }],
    async () => {
      const result = await access.resolveActiveOrder("access-cutoff-13001");
      assert.equal(result.visible, true);
      assert.equal(result.reason, "active");
      assert.equal(result.order.order_id, "access-cutoff-13001");
    },
  );
});

test("direct active-order resolution includes later orders and fails closed for malformed dates", async () => {
  await withFetchRows(
    [
      { order_id: "access-later-14001", order_date: "2026-07-14" },
      { order_id: "access-invalid-14002", order_date: "not-a-date" },
    ],
    async () => {
      assert.equal((await access.resolveActiveOrder("access-later-14001")).visible, true);
      const invalid = await access.resolveActiveOrder("access-invalid-14002");
      assert.equal(invalid.visible, false);
      assert.equal(invalid.reason, "invalid_date");
      assert.notEqual(invalid.message, "This order is outside the active order period.");
    },
  );
});

test("direct active-order resolution matches full display order ids to numeric upstream ids", async () => {
  await withFetchRows(
    [{ order_id: "3856", order_date: "2026-07-14" }],
    async () => {
      const result = await access.resolveActiveOrder("OM/2026/3856");
      assert.equal(result.visible, true);
      assert.equal(result.order.order_id, "3856");
    },
  );
});

test("missing date does not falsely display the active-period cutoff message", async () => {
  await withFetchRows(
    [{ order_id: "access-missing-date" }],
    async () => {
      const result = await access.resolveActiveOrder("access-missing-date");
      assert.equal(result.visible, false);
      assert.equal(result.reason, "missing_date");
      assert.notEqual(result.message, "This order is outside the active order period.");
    },
  );
});

test("created_at is accepted as an original creation date candidate", async () => {
  await withFetchRows(
    [{ order_id: "access-created-at", created_at: "2026-07-14 12:00:00" }],
    async () => {
      const result = await access.resolveActiveOrder("access-created-at");
      assert.equal(result.visible, true);
      assert.equal(result.diagnostics.authoritativeDateField, "created_at");
      assert.equal(result.diagnostics.parsedBusinessDate, "2026-07-14");
    },
  );
});

test("actor direct access reads the snapshot and falls back to one searched upstream lookup on a miss", async () => {
  globalThis.__activeOrderSnapshotRows = [];
  globalThis.__activeOrderSnapshotState = "hit";
  globalThis.__activeOrderSnapshotReads = [];
  await withFetchRows(
    [{ order_id: "snapshot-miss-new", order_date: "2026-07-14 09:00:00" }],
    async (calls) => {
      const result = await access.resolveActiveOrder("snapshot-miss-new", {
        actor: { role: "admin", actorId: "" },
      });
      assert.equal(result.visible, true);
      assert.equal(result.reason, "active");
      assert.equal(result.diagnostics.snapshotResult, "miss");
      assert.equal(result.diagnostics.directUpstreamResult, "hit");
      assert.equal(globalThis.__activeOrderSnapshotReads.length, 1);
      assert.equal(calls.length, 1);
      assert.match(calls[0], /search=snapshot-miss-new/);
      assert.doesNotMatch(calls[0], /page=2/);
    },
  );
});

test("snapshot hit can satisfy actor access without upstream fallback", async () => {
  globalThis.__activeOrderSnapshotRows = [{ order_id: "snapshot-hit", order_date: "2026-07-15" }];
  globalThis.__activeOrderSnapshotState = "hit";
  globalThis.__activeOrderSnapshotReads = [];
  await withFetchRows([], async (calls) => {
    const result = await access.resolveActiveOrder("snapshot-hit", {
      actor: { role: "admin", actorId: "" },
    });
    assert.equal(result.visible, true);
    assert.equal(result.reason, "active");
    assert.equal(result.diagnostics.snapshotResult, "hit");
    assert.equal(result.diagnostics.directUpstreamResult, "not_checked");
    assert.equal(calls.length, 0);
  });
});

test("snapshot miss and upstream failure do not display the active-period cutoff message", async () => {
  globalThis.__activeOrderSnapshotRows = [];
  globalThis.__activeOrderSnapshotState = "miss";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  try {
    const result = await access.resolveActiveOrder("upstream-down", {
      actor: { role: "admin", actorId: "" },
    });
    assert.equal(result.visible, false);
    assert.equal(result.reason, "upstream_unavailable");
    assert.notEqual(result.message, "This order is outside the active order period.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("order detail page verifies the header before loading product and related order data", async () => {
  const source = await fs.readFile(path.resolve("src/app/orders/[id]/page.tsx"), "utf8");
  const effectStart = source.indexOf("fetch(`/api/active-order/");
  const effectEnd = source.indexOf("}, [id, currentUser]);", effectStart);
  const effect = source.slice(effectStart, effectEnd);
  const verification = effect.indexOf("/api/active-order/");
  const productData = effect.indexOf("return fetch(url)");

  assert.ok(verification >= 0, "active-order verification endpoint is used");
  assert.ok(productData > verification, "product rows are loaded only after the header check exists in the flow");
  assert.match(effect, /setOrderPeriodVerified\(true\)/);
  assert.match(effect, /buildDispatchHeaders\(currentUser\)/);
});

test("Order Management preserves Admin accept controls through the existing handler", async () => {
  const source = await fs.readFile(path.resolve("src/app/Pages/Ordermanagement/page.tsx"), "utf8");
  const adminConfigStart = source.indexOf("admin: {");
  const adminConfigEnd = source.indexOf("dealer: {", adminConfigStart);
  const adminConfig = source.slice(adminConfigStart, adminConfigEnd);

  assert.match(adminConfig, /canAccept:\s*\(_s,\s*row\)\s*=>\s*row\.del_status === '0'/);
  assert.match(source, /acceptstatus_requst/);
  assert.match(source, /onAccept=\{\(\) => handleAccept\(order\.order_id, 1\)\}/);
  assert.match(source, /showAccept=\{showAccept\}/);
});
