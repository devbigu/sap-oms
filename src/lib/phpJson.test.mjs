import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

async function loadModule() {
  const source = await fs.readFile(path.resolve("src/lib/phpJson.ts"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const phpJson = await loadModule();

test("parsePhpJsonResponse parses normal JSON", async () => {
  const parsed = await phpJson.parsePhpJsonResponse(new Response('{"success":true,"data":[1]}'));
  assert.deepEqual(parsed, { success: true, data: [1] });
});

test("parsePhpJsonResponse skips legacy PHP warning HTML before JSON", async () => {
  const parsed = await phpJson.parsePhpJsonResponse(new Response(`
    <div style="border:1px solid #990000">A PHP Error was encountered</div>
    {"msg":"Success","status":true,"data":[]}
  `));
  assert.deepEqual(parsed, { msg: "Success", status: true, data: [] });
});
