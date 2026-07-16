import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadModule() {
  const filePath = path.resolve("src/lib/orderScopeServer.ts");
  const scopeUrl = pathToFileURL(path.resolve("src/lib/staffOrderScope.js")).href;
  const source = (await fs.readFile(filePath, "utf8")).replace(
    /from\s+["']@\/lib\/staffOrderScope\.js["']/g,
    `from "${scopeUrl}"`,
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const orderScope = await loadModule();

test("missing or unknown role never defaults to Admin", () => {
  assert.equal(orderScope.parseOrderActor({ role: "", actorId: "101" }), null);
  assert.equal(orderScope.parseOrderActor({ actorId: "101" }), null);
  assert.equal(orderScope.parseOrderActor({ role: "unknown", actorId: "101" }), null);
});

test("Dealer and Staff identities fail closed when missing", () => {
  assert.equal(orderScope.parseOrderActor({ role: "dealer", actorId: "" }), null);
  assert.equal(orderScope.parseOrderActor({ role: "staff", actorId: null }), null);
});

test("numeric and string actor IDs normalize to stable strings", () => {
  assert.deepEqual(orderScope.parseOrderActor({ role: "dealer", actorId: 101 }), {
    role: "dealer",
    actorId: "101",
  });
});

test("active-orders adapter requires an explicit role instead of endpoint inference", async () => {
  const source = await fs.readFile(path.resolve("src/app/api/active-orders/route.ts"), "utf8");
  assert.match(source, /parseOrderActor\(\{ role: requestedRole, actorId \}\)/);
  assert.doesNotMatch(source, /fallbackRole/);
});

test("simultaneous Staff scope reads share one assignment request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  orderScope.invalidateStaffAssignmentCache("29");
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ data: [{ Dealer_Id: "101", assignedstaff: "29" }] }),
    };
  };
  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => orderScope.fetchStaffAssignedDealerIds("29")),
    );
    assert.equal(calls, 1);
    assert.equal(results.every((ids) => ids.length === 1 && ids[0] === "101"), true);
    assert.deepEqual(await orderScope.fetchStaffAssignedDealerIds("29"), ["101"]);
    assert.equal(calls, 1);
  } finally {
    orderScope.invalidateStaffAssignmentCache("29");
    globalThis.fetch = originalFetch;
  }
});
