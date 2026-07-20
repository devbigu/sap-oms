import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const staffOrderScopeUrl = pathToFileURL(path.resolve("src/lib/staffOrderScope.js")).href;
const phpJsonSource = await fs.readFile(path.resolve("src/lib/phpJson.ts"), "utf8");
const phpJsonOutput = ts.transpileModule(phpJsonSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const phpJsonUrl = `data:text/javascript;base64,${Buffer.from(phpJsonOutput).toString("base64")}`;
const source = (await fs.readFile(path.resolve("src/lib/orderAccess.ts"), "utf8"))
  .replace("@/lib/staffOrderScope.js", staffOrderScopeUrl)
  .replace("@/lib/phpJson", phpJsonUrl);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const access = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

async function withRows(rows, callback) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ data: rows }), { status: 200 });
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
  globalThis.fetch = async () => new Response("{}", { status: 503 });
  try {
    const result = await access.resolveOrderAccess("down");
    assert.equal(result.reason, "upstream_unavailable");
    assert.equal(result.message, "Order verification is temporarily unavailable.");
  } finally { globalThis.fetch = originalFetch; }
});

test("order detail fallback preserves Staff assignment access when order listing is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes("orderpegination")) {
      return new Response("{}", { status: 500 });
    }
    if (path.includes("orderdatalist")) {
      return new Response(JSON.stringify({
          data: [
            {
              orderdata_orderid: "3860",
              orderdata_dealerid: "89",
              orderdata_datetime: "2026-07-18 23:38:37",
            },
          ],
        }), { status: 200 });
    }
    throw new Error(`Unexpected URL ${path}`);
  };

  try {
    const result = await access.resolveOrderAccess("3860", {
      actor: { role: "staff", actorId: "24" },
      assignedDealerIds: ["89"],
    });

    assert.equal(result.visible, true);
    assert.equal(result.order.order_id, "3860");
    assert.equal(result.order.order_dealer, "89");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unsearched order header fallback preserves Admin access when searched listing fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes("orderpegination") && path.includes("search=3862")) {
      return new Response("{}", { status: 500 });
    }
    if (path.includes("orderpegination") && path.includes("search=")) {
      return new Response(JSON.stringify({
          data: [
            {
              order_id: "3862",
              order_dealer: "225",
              staffid: "53",
              accept_order: "0",
              del_status: "0",
            },
          ],
        }), { status: 200 });
    }
    throw new Error(`Unexpected URL ${path}`);
  };

  try {
    const result = await access.resolveOrderAccess("3862", {
      actor: { role: "admin", actorId: "1" },
      assignedDealerIds: [],
    });

    assert.equal(result.visible, true);
    assert.equal(result.order.order_id, "3862");
    assert.equal(result.order.order_dealer, "225");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("order detail fallback does not bypass legacy dealer scoped access", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes("orderhispegination")) {
      return new Response("{}", { status: 500 });
    }
    if (path.includes("orderdatalist")) {
      return new Response(JSON.stringify({
          data: [
            {
              orderdata_orderid: "3860",
              orderdata_dealerid: "89",
            },
          ],
        }), { status: 200 });
    }
    throw new Error(`Unexpected URL ${path}`);
  };

  try {
    const result = await access.resolveOrderAccess("3860", "90");
    assert.equal(result.visible, false);
    assert.equal(result.reason, "not_found");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Admin can access any existing order without assignedstaff checks", async () => {
  await withRows([{ order_id: "7001", order_dealer: "101", assignedstaff: "29" }], async (calls) => {
    const result = await access.resolveOrderAccess("7001", {
      actor: { role: "admin", actorId: "admin-1" },
      assignedDealerIds: [],
    });

    assert.equal(result.visible, true);
    assert.equal(result.order.order_id, "7001");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/orderpegination\?/);
    assert.doesNotMatch(calls[0], /staffOrderrPagination|staffDealers|assignedstaff/);
  });
});

test("Assigned Staff can access the Dealer order by assigned dealer id", async () => {
  await withRows([{ order_id: "7002", order_dealer: "101", assignedstaff: "88" }], async () => {
    const result = await access.resolveOrderAccess("7002", {
      actor: { role: "staff", actorId: "29" },
      assignedDealerIds: ["101"],
    });

    assert.equal(result.visible, true);
    assert.equal(result.order.order_id, "7002");
  });
});

test("Assigned Staff can access when assignedstaff matches with numeric and string IDs", async () => {
  await withRows([{ order_id: "7003", order_dealer: 101, assignedstaff: "29, 31" }], async () => {
    const result = await access.resolveOrderAccess("7003", {
      actor: { role: "staff", actorId: 29 },
      assignedDealerIds: [],
    });

    assert.equal(result.visible, true);
    assert.equal(result.order.order_id, "7003");
  });
});

test("Unassigned Staff receives forbidden access", async () => {
  await withRows([{ order_id: "7004", order_dealer: "202", assignedstaff: "88" }], async () => {
    const result = await access.resolveOrderAccess("7004", {
      actor: { role: "staff", actorId: "29" },
      assignedDealerIds: ["101"],
    });

    assert.equal(result.visible, false);
    assert.equal(result.reason, "forbidden");
    assert.equal(result.message, "This order is outside your assigned order scope.");
  });
});

test("Dealer can access own order and cannot access another Dealer order", async () => {
  await withRows([{ order_id: "7005", order_dealer: 101 }], async () => {
    const allowed = await access.resolveOrderAccess("7005", {
      actor: { role: "dealer", actorId: "101" },
      dealerId: 101,
    });
    const denied = await access.resolveOrderAccess("7005", {
      actor: { role: "dealer", actorId: "202" },
      dealerId: "202",
    });

    assert.equal(allowed.visible, true);
    assert.equal(denied.visible, false);
    assert.equal(denied.reason, "forbidden");
  });
});

test("Missing order reports Order not found", async () => {
  await withRows([{ order_id: "present", order_dealer: "101" }], async () => {
    const result = await access.resolveOrderAccess("missing", {
      actor: { role: "admin", actorId: "admin-1" },
    });

    assert.equal(result.visible, false);
    assert.equal(result.reason, "not_found");
    assert.equal(result.message, "Order not found.");
  });
});

test("Order Details loads the PHP detail source without an access gate", async () => {
  const page = await fs.readFile(path.resolve("src/app/orders/[id]/page.tsx"), "utf8");
  assert.doesNotMatch(page, /\/api\/order-access\//);
  assert.match(page, /fetch\(url\)[\s\S]*normalizeOrderDetailResponse\(d, id\)/);
});

test("Order Details uses the raw order ID for detail fetching after successful access", async () => {
  const page = await fs.readFile(path.resolve("src/app/orders/[id]/page.tsx"), "utf8");
  assert.match(page, /const url = `\$\{BACKEND\}\/orderdatalist\?id=\$\{id\}`/);
  assert.doesNotMatch(page, /orderdatalist\?id=\$\{[^}]*formatted/i);
});

test("Order Details keeps supplemental failures separate from order items", async () => {
  const page = await fs.readFile(path.resolve("src/app/orders/[id]/page.tsx"), "utf8");
  assert.match(page, /Order changes could not be loaded; original order items are shown\./);
  assert.match(page, /Discount metadata could not be loaded; stored order totals remain visible\./);
  assert.match(page, /Dispatch data could not be verified\./);
});

test("Successful access loads complete product lines and preserves discount and overlay flows", async () => {
  const page = await fs.readFile(path.resolve("src/app/orders/[id]/page.tsx"), "utf8");
  assert.match(page, /normalizeOrderDetailResponse\(d, id\)/);
  assert.match(page, /getOrderDiscountSummaryRows\(discountBreakdown\)/);
  assert.match(page, /\/api\/order-overlays\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(page, /displayOrders\.map/);
});
