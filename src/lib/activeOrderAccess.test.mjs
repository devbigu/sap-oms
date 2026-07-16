import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadAccessModule() {
  const filePath = path.resolve("src/lib/activeOrderAccess.ts");
  const activePeriodUrl = pathToFileURL(path.resolve("src/lib/activeOrderPeriod.js")).href;
  const source = (await fs.readFile(filePath, "utf8")).replace(
    /from\s+["']@\/lib\/activeOrderPeriod\.js["']/g,
    `from "${activePeriodUrl}"`,
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
      assert.equal((await access.resolveActiveOrder("access-invalid-14002")).visible, false);
    },
  );
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
