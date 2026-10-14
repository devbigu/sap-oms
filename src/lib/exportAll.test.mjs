import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const stubUrl = `data:text/javascript;base64,${Buffer.from("export function withDisplayOrderAmounts(o){ return o; }").toString("base64")}`;
const source = (await fs.readFile(path.resolve("src/lib/exportAll.ts"), "utf8")).replace("@/lib/orderAmounts", stubUrl);
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { toSheets, orderLookupKey } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("flattens nested objects, strips passwords, moves object arrays to child sheets", () => {
  const sheets = toSheets({
    Staff: [{ staff_id: "7", staff_password: "secret", phone: "09876", meta: { a: { b: 1 }, Dealer_Password: "x" } }],
    Forms: [{ id: "f1", tags: ["x", "y"], when: new Date("2026-01-02T03:04:05Z"), products: [{ sku: "A", password: "p" }, { sku: "B" }] }],
  });
  assert.deepEqual(sheets.Staff, [{ staff_id: "7", phone: "09876", meta_a_b: 1 }]);
  assert.deepEqual(sheets.Forms, [{ id: "f1", tags: "x, y", when: "2026-01-02T03:04:05.000Z" }]);
  assert.deepEqual(sheets.Forms_products, [{ parent_id: "f1", sku: "A" }, { parent_id: "f1", sku: "B" }]);
  assert.ok(!JSON.stringify(sheets).includes("secret"));
});

test("order lookup key matches OM/2026/0042 to 42", () => {
  assert.equal(orderLookupKey("OM/2026/0042"), "42");
  assert.equal(orderLookupKey("42"), "42");
});
