// Re-runs the Orders page "Export all" admin pipeline headlessly and writes allproductdata.json.
import { createJiti } from "jiti";
import { writeFileSync } from "node:fs";
import path from "node:path";
const [frontend, out, base] = process.argv.slice(2);
globalThis.window = { location: { origin: base } };
const realFetch = fetch;
globalThis.fetch = async (url, init) => {
  for (let i = 0; ; i++) {
    try { return await realFetch(new URL(String(url), base), init); }
    catch (e) { if (i >= 5) throw e; await new Promise((r) => setTimeout(r, 1000 * (i + 1))); }
  }
};
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(frontend, "src") } });
const lib = await jiti.import(path.join(frontend, "src/lib/exportAll.ts"));
const url = "/api/orders-data?source=orderpegination&role=admin&page=1&limit=10&search=";
const orders = await lib.withOrderItems(await lib.fetchAllOrdersWithAmounts(url), { id: "1", role: "admin" });
const rows = lib.allOrderedProducts(orders);
writeFileSync(out, JSON.stringify(rows, (k, v) => (/pass(word)?$/i.test(k) ? undefined : v), 2));
console.log([...new Set(orders.filter((o) => o.items_error).map((o) => o.items_error))]);
console.log(`orders=${orders.length} rows=${rows.length} itemErrors=${orders.filter((o) => o.items_error).length}`);
