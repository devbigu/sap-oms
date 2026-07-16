import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(path.resolve("src/lib/dealerStatus.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

const compiledModule = { exports: {} };
vm.runInNewContext(compiled, {
  module: compiledModule,
  exports: compiledModule.exports,
  require,
  URLSearchParams,
  console,
});

const {
  applyDealerStatusOverrides,
  isActiveDealerStatus,
} = compiledModule.exports;

test("dealer status overrides control active dealer visibility", () => {
  const dealers = [
    { Dealer_Id: "10", status: "1", Dealer_Name: "Raw active" },
    { Dealer_Id: "20", status: "0", Dealer_Name: "Raw inactive" },
    { Dealer_Id: "30", status: "1", Dealer_Name: "Overridden inactive" },
  ];
  const overrides = [
    { dealerId: "20", status: "active" },
    { dealerId: "30", status: "inactive" },
  ];

  const merged = applyDealerStatusOverrides(dealers, overrides);
  const visibleIds = merged
    .filter((dealer) => isActiveDealerStatus(dealer.status))
    .map((dealer) => dealer.Dealer_Id);

  assert.deepEqual(Array.from(visibleIds), ["10", "20"]);
});
