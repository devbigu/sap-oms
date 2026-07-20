import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const source = await fs.readFile(path.resolve("src/lib/orderAccess.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const access = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

async function withRows(rows, callback) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ data: rows }) };
  };
  try { await callback(calls); } finally { globalThis.fetch = originalFetch; }
}

test("direct access includes existing orders regardless of date", async () => {
  for (const row of [
    { order_id: "old", order_date: "2026-07-12" },
    { order_id: "missing" },
    { order_id: "bad", order_date: "bad-date" },
  ]) {
    await withRows([row], async () => assert.equal((await access.resolveOrderAccess(row.order_id)).visible, true));
  }
});

test("display order IDs resolve numeric upstream IDs", async () => {
  await withRows([{ order_id: "3856", order_date: "2026-07-01" }], async () => {
    const result = await access.resolveOrderAccess("OM/2026/3856");
    assert.equal(result.visible, true);
    assert.equal(result.order.order_id, "3856");
  });
});

test("direct access checks the current source on every request", async () => {
  await withRows([{ order_id: "current" }], async (calls) => {
    await access.resolveOrderAccess("current");
    await access.resolveOrderAccess("current");
    assert.equal(calls.length, 2);
  });
});

test("upstream failure reports availability without a date message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  try {
    const result = await access.resolveOrderAccess("down");
    assert.equal(result.reason, "upstream_unavailable");
    assert.equal(result.message, "Order verification is temporarily unavailable.");
  } finally { globalThis.fetch = originalFetch; }
});

test("Order Details verifies role access before loading complete detail data", async () => {
  const page = await fs.readFile(path.resolve("src/app/orders/[id]/page.tsx"), "utf8");
  const accessIndex = page.indexOf("/api/order-access/");
  const detailIndex = page.indexOf("return fetch(url)", accessIndex);
  assert.ok(accessIndex >= 0);
  assert.ok(detailIndex > accessIndex);
  assert.match(page, /buildDispatchHeaders\(currentUser\)/);
});
