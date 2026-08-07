import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

async function loadCutoffModule() {
  const filePath = path.resolve("src/lib/orderMongoCutoff.ts");
  const source = await fs.readFile(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);
}

const cutoff = await loadCutoffModule();

test("order Mongo cutoff starts at 5 August 2026 in India time", () => {
  assert.equal(cutoff.ORDER_MONGO_DATA_CUTOFF_ISO, "2026-08-04T18:30:00.000Z");
  assert.equal(cutoff.isOrderMongoDocumentVisible({ createdAt: "2026-08-04T18:29:59.999Z" }), false);
  assert.equal(cutoff.isOrderMongoDocumentVisible({ createdAt: "2026-08-04T18:30:00.000Z" }), true);
  assert.equal(cutoff.isOrderMongoDocumentVisible({ updatedAt: new Date("2026-08-05T12:00:00.000Z") }), true);
  assert.equal(cutoff.isOrderMongoDocumentVisible({ createdAt: "2026-08-04" }), false);
});

test("order Mongo cutoff can check nested order overlay dates", () => {
  const oldCancelled = {
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    cancellation: { cancelledAt: "2026-08-04T18:29:59.999Z" },
  };
  const newCancelled = {
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    cancellation: { cancelledAt: "2026-08-04T18:30:00.000Z" },
  };

  assert.equal(cutoff.isOrderMongoDocumentVisible(oldCancelled, ["cancellation.cancelledAt", "updatedAt", "createdAt"]), false);
  assert.equal(cutoff.isOrderMongoDocumentVisible(newCancelled, ["cancellation.cancelledAt", "updatedAt", "createdAt"]), true);
});
