import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

// orderDetailItems only contributes normalizeOrderDetailSku here; inline it so
// the module loads without the "@/" path alias.
const SKU_PRELUDE = `function normalizeOrderDetailSku(v){return String(v ?? "").trim().replace(/\s+/g," ").toLowerCase();}
`;

async function loadModule(relativePath) {
  const filePath = path.resolve(relativePath);
  const source = await fs.readFile(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText.replace(/^import .*orderDetailItems.*$/m, "");
  const code = SKU_PRELUDE + transpiled;
  return import(`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`);
}

const mirror = await loadModule("src/lib/orderMirror.ts");

function form(entries) {
  return { get: (key) => entries[key] ?? null };
}

const submitted = form({
  productorder: JSON.stringify([
    { catNo: "A-1", productName: "Beaker", producQuanity: "10", price: "100", discount: "100", afterDiscountPrice: "900" },
    { catNo: "B-2", productName: "Flask", producQuanity: "5", price: "200", discount: "100", afterDiscountPrice: "900" },
  ]),
  subtotal: "2000",
  baseDiscountAmount: "200",
  additionalDiscountAmount: "0",
  finalPayableAmount: "1800",
});

test("snapshot captures items, quantities, discounts and totals", () => {
  const snapshot = mirror.buildOrderMirrorSnapshot(submitted);
  assert.equal(snapshot.itemCount, 2);
  assert.equal(snapshot.totalQuantity, 15);
  assert.equal(snapshot.totals.finalPayableAmount, 1800);
  assert.equal(snapshot.totals.discountAmount, 200);
  assert.deepEqual(snapshot.items[0], {
    catNo: "A-1", productName: "Beaker", quantity: 10, price: 100, discount: 100, finalPrice: 900,
  });
});

function phpRows(rows) {
  return rows.map((r) => ({
    orderdata_cat_no: r.catNo,
    product_name: r.catNo,
    orderdata_item_quantity: String(r.quantity),
    orderdata_price: String(r.price),
    orderdata_discount: String(r.discount ?? 100),
    orderdata_afterDisPrice: "0",
  }));
}

const meta = { order_amount: "2000", order_discount_amount: "200", order_net_amount: "1800" };

test("identical PHP order verifies clean", () => {
  const expected = mirror.buildOrderMirrorSnapshot(submitted);
  const actual = mirror.snapshotFromOrderDetailRows(
    phpRows([{ catNo: "A-1", quantity: 10, price: 100 }, { catNo: "B-2", quantity: 5, price: 200 }]),
    meta
  );
  assert.deepEqual(mirror.compareOrderSnapshot(expected, actual), { matches: true, mismatches: [] });
});

test("a dropped item is reported", () => {
  const expected = mirror.buildOrderMirrorSnapshot(submitted);
  const actual = mirror.snapshotFromOrderDetailRows(phpRows([{ catNo: "A-1", quantity: 10, price: 100 }]), meta);
  const { matches, mismatches } = mirror.compareOrderSnapshot(expected, actual);
  assert.equal(matches, false);
  assert.ok(mismatches.some((m) => m.field === "itemCount" && m.expected === 2 && m.actual === 1));
  assert.ok(mismatches.some((m) => m.field === "missingProduct" && m.catNo === "B-2"));
});

test("a wrong quantity, price or discount is reported per product", () => {
  const expected = mirror.buildOrderMirrorSnapshot(submitted);
  const actual = mirror.snapshotFromOrderDetailRows(
    phpRows([{ catNo: "A-1", quantity: 1, price: 100 }, { catNo: "B-2", quantity: 5, price: 250, discount: 500 }]),
    meta
  );
  const { matches, mismatches } = mirror.compareOrderSnapshot(expected, actual);
  assert.equal(matches, false);
  assert.ok(mismatches.some((m) => m.field === "quantity" && m.catNo === "A-1" && m.expected === 10 && m.actual === 1));
  assert.ok(mismatches.some((m) => m.field === "price" && m.catNo === "B-2"));
  assert.ok(mismatches.some((m) => m.field === "discount" && m.catNo === "B-2"));
});

test("an unexpected extra product and wrong totals are reported", () => {
  const expected = mirror.buildOrderMirrorSnapshot(submitted);
  const actual = mirror.snapshotFromOrderDetailRows(
    phpRows([
      { catNo: "A-1", quantity: 10, price: 100 },
      { catNo: "B-2", quantity: 5, price: 200 },
      { catNo: "C-3", quantity: 1, price: 50 },
    ]),
    { order_amount: "2050", order_discount_amount: "200", order_net_amount: "1850" }
  );
  const { matches, mismatches } = mirror.compareOrderSnapshot(expected, actual);
  assert.equal(matches, false);
  assert.ok(mismatches.some((m) => m.field === "extraProduct" && m.catNo === "C-3"));
  assert.ok(mismatches.some((m) => m.field === "finalPayableAmount"));
});

test("SKU casing and whitespace do not create false mismatches", () => {
  const expected = mirror.buildOrderMirrorSnapshot(submitted);
  const actual = mirror.snapshotFromOrderDetailRows(
    phpRows([{ catNo: " a-1 ", quantity: 10, price: 100 }, { catNo: "b-2", quantity: 5, price: 200 }]),
    meta
  );
  assert.equal(mirror.compareOrderSnapshot(expected, actual).matches, true);
});
