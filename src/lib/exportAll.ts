import { buildCatalogueIndex } from "@/lib/catalogue";
import { loadCatalogueProducts } from "@/lib/catalogueClient";
import { withDisplayOrderAmounts } from "@/lib/orderAmounts";
import { normalizeOrderDetailResponse } from "@/lib/orderDetailItems";
import { mergeOrderItemsWithDispatchRecords } from "@/lib/orderDispatch";
import { compareOrderSnapshot, repairOrderDetailRows, snapshotFromOrderDetailRows, type OrderMirrorSnapshot } from "@/lib/orderMirror";
import { mergeFallbackProductNotes } from "@/lib/orderProductNotes.mjs";
import { parsePackSizes, resolveLinePackSize, resolveLinePacks, resolveLinePieces } from "@/lib/orderEditPricing";

type Row = Record<string, unknown>;
export type ExportSheets = Record<string, unknown[]>;

const PHP_API = "https://mirisoft.co.in/sas/dealerapi/api";

// Never export credentials: staff_password, Dealer_Password, password, ...
const SECRET_KEY = /pass(word)?$/i;

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: "no-store", ...init });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url.split("?")[0]} failed (HTTP ${res.status})`);
  return JSON.parse(text.slice(text.indexOf("{")));
}

/** Walks a paged endpoint until its last page. Works with last_page, totalPages or count. */
export async function fetchAllPages(url: string, init?: RequestInit, limit = 100): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 1; page <= 10_000; page++) {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("page", String(page));
    u.searchParams.set("limit", String(limit));
    const json = await getJson(u.toString(), init);
    const data: Row[] = Array.isArray(json?.data) ? json.data : [];
    rows.push(...data);
    const lastPage = Number(json?.last_page ?? json?.totalPages ?? 0)
      || Math.ceil(Number(json?.count ?? json?.total ?? 0) / (data.length || 1));
    if (data.length === 0 || page >= lastPage) break;
  }
  return rows;
}

export function orderLookupKey(value: unknown) {
  const text = String(value ?? "").trim();
  const trailing = text.match(/(\d+)(?!.*\d)/)?.[1];
  if (!trailing) return text;
  const normalized = String(Number(trailing));
  return normalized === "NaN" ? trailing : normalized;
}

/** All orders from /api/orders-data with the same summary-override amounts the order tables show. */
export async function fetchAllOrdersWithAmounts(ordersDataUrl: string, dealerId?: string) {
  const orders = await fetchAllPages(ordersDataUrl, undefined, 1000);
  const overrides: Record<string, Row> = {};
  const ids = orders.map((o) => String(o.order_id ?? "").trim()).filter(Boolean);
  for (let i = 0; i < ids.length; i += 200) { // route caps order_ids at 200
    const params = new URLSearchParams({ order_ids: ids.slice(i, i + 200).join(",") });
    if (dealerId) params.set("dealer_id", dealerId);
    const json = await getJson(`/api/order-summary-overrides?${params}`);
    for (const item of json?.data ?? []) {
      for (const id of [item.orderId, item.order_id]) {
        if (String(id ?? "").trim()) overrides[String(id).trim()] = overrides[orderLookupKey(id)] = item;
      }
    }
  }
  return orders.map((o) => withDisplayOrderAmounts(o, overrides[String(o.order_id)] ?? overrides[orderLookupKey(o.order_id)]));
}

/**
 * Adds each order's line items as `items`: every raw orderdata_tbl line (edits applied), product
 * name/description from product_tbl or the catalogue, pack size/packs/pieces, dispatch progress.
 */
export async function withOrderItems(orders: Row[], actor: { id: string; role: string; roletype?: string }) {
  const [tblProducts, catalogue, packProducts] = await Promise.all([
    getJson(`${PHP_API}/productlist`).then((j) => (Array.isArray(j?.data) ? j.data as Row[] : [])).catch(() => []),
    loadCatalogueProducts().catch(() => []),
    fetch("/data/products.json").then((r) => r.json() as Promise<Row[]>).catch(() => []),
  ]);
  const productByCat = new Map(tblProducts.map((p) => [String(p.product_cat ?? "").trim(), p]));
  const variants = buildCatalogueIndex(catalogue).variantsBySku;
  // Catalogue packs fill gaps; products.json wins, as on the order detail page.
  const packLookup: Record<string, number> = {};
  for (const [sku, { variant }] of Object.entries(variants)) if (variant.pack) packLookup[sku] = variant.pack;
  for (const product of packProducts) Object.assign(packLookup, parsePackSizes(String(product.Description ?? "")));

  // PHP orderdatalist INNER JOINs product_tbl, so lines whose cat no isn't in product_tbl vanish
  // (82 of 236 orders lost lines). Orderstatusa returns a dealer's raw orderdata_tbl rows: one call per dealer.
  const dealerRows = new Map<string, Promise<Row[]>>();
  const rowsForDealer = (dealerId: string) => {
    if (!dealerRows.has(dealerId)) {
      dealerRows.set(dealerId, getJson(`${PHP_API}/Orderstatusa?id=${encodeURIComponent(dealerId)}`)
        .then((j) => (Array.isArray(j?.data) ? j.data as Row[] : [])));
    }
    return dealerRows.get(dealerId)!;
  };

  const withProduct = (line: Row) => {
    const sku = String(line.orderdata_cat_no ?? "").trim();
    const php = productByCat.get(sku);
    const cat = variants[sku];
    return {
      ...line,
      product_name: line.product_name || php?.product_name || cat?.variant.name || "",
      product_discription: line.product_discription || php?.product_discription || cat?.variant.specsText || "",
      product_unit: line.product_unit || php?.product_unit || "",
      product_price: line.product_price || php?.product_price || cat?.variant.price || "",
      category: cat?.product.category ?? "",
    };
  };

  const headers = {
    "x-omsons-actor-id": actor.id,
    "x-omsons-actor-role": actor.role,
    ...(actor.roletype ? { "x-omsons-actor-roletype": actor.roletype } : {}),
  };

  const notesByOrder = new Map<string, Row[]>();
  const orderIds = orders.map((o) => String(o.order_id ?? "").trim()).filter(Boolean);
  for (let i = 0; i < orderIds.length; i += 50) { // route caps a response at 500 notes
    const json = await getJson(`/api/order-product-notes?orderIds=${encodeURIComponent(orderIds.slice(i, i + 50).join(","))}`).catch(() => null);
    for (const note of json?.data ?? []) {
      const key = String(note.orderId ?? "").trim();
      notesByOrder.set(key, [...(notesByOrder.get(key) ?? []), note]);
    }
  }

  const loadItems = async (order: Row): Promise<Row> => {
    const orderId = String(order.order_id ?? "").trim();
    const id = encodeURIComponent(orderId);
    const dealerId = String(order.order_dealer ?? "").trim();
    const [raw, overlay, dispatch, mirror] = await Promise.all([
      rowsForDealer(dealerId)
        .then((rows) => rows.filter((row) => String(row.orderdata_orderid ?? "").trim() === orderId))
        .catch((e: Error) => e),
      getJson(`/api/order-overlays/${id}`).catch(() => null), // edits + cancellation
      getJson(`/api/order-dispatch?orderId=${id}`, { headers }).catch(() => null), // no access → legacy readyquantity
      getJson(`/api/order-mirror?orderId=${id}`).catch(() => null),
    ]);
    const edits = overlay?.data?.effectiveItems;
    const edited = overlay?.data?.isEdited && Array.isArray(edits) && edits.length > 0 ? edits as Row[] : null;
    let source = edited ?? (Array.isArray(raw) ? raw : null);
    if (!source) return { ...order, items: [], items_error: raw instanceof Error ? raw.message : "Items unavailable" };

    // As on the order detail page: when PHP drifted from what was submitted, restore the lines
    // from the Mongo mirror. An admin edit is newer than the submission, so edited orders keep theirs.
    const snapshot = mirror?.snapshot as OrderMirrorSnapshot | undefined;
    if (!edited && snapshot) {
      const { meta, items: rows } = normalizeOrderDetailResponse({ data: source }, orderId);
      if (!compareOrderSnapshot(snapshot, snapshotFromOrderDetailRows(rows, meta)).matches) {
        source = repairOrderDetailRows(rows, snapshot, orderId);
      }
    }

    const withNotes = mergeFallbackProductNotes(source.map(withProduct), notesByOrder.get(orderId) ?? []) as Row[];
    const lines = mergeOrderItemsWithDispatchRecords(withNotes, dispatch?.data ?? []);
    const items = lines.map((line) => {
      const packSize = resolveLinePackSize(line, packLookup);
      return { ...line, packSize, packs: resolveLinePacks(line, packSize), pieces: resolveLinePieces(line) };
    });
    return { ...order, cancelled: !!overlay?.data?.isCancelled, edited: !!edited, items };
  };

  // ponytail: overlay + dispatch + mirror call per order, 6 orders at a time; add a bulk endpoint if exports get slow.
  const out: Row[] = new Array(orders.length);
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < orders.length) {
      const i = next++;
      out[i] = await loadItems(orders[i]);
    }
  }));
  return out;
}

/** One row per ordered product across all orders, tagged with its order's id, date and dealer. */
export function allOrderedProducts(orders: Row[]) {
  return orders.flatMap((order) => (Array.isArray(order.items) ? order.items : []).map((item: Row) => ({
    order_id: order.order_id,
    order_date: order.orderDate ?? order.order_date,
    dealer_id: order.order_dealer,
    dealer_name: order.Dealer_Name,
    order_cancelled: order.cancelled,
    order_edited: order.edited,
    ...item,
  })));
}

export function downloadJson(filename: string, data: unknown) {
  const json = JSON.stringify(data, (key, value) => (SECRET_KEY.test(key) ? undefined : value), 2);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function rowId(row: Row, index: number) {
  for (const key of ["id", "_id", "orderdata_id", "order_id", "orderId", "staff_id", "Dealer_Id", "leadNo"]) {
    if (row?.[key] !== undefined && row[key] !== "") return String(row[key]);
  }
  return String(index + 1);
}

/** Flattens a.b -> a_b; arrays of objects become child sheets keyed by parent_id. */
function addRows(sheets: Record<string, Row[]>, sheet: string, rows: unknown[], parentId?: string) {
  const out = (sheets[sheet] ??= []);
  rows.forEach((raw, index) => {
    const flat: Row = parentId === undefined ? {} : { parent_id: parentId };
    const id = rowId(raw as Row, index);
    const walk = (value: unknown, prefix: string) => {
      if (value instanceof Date) flat[prefix] = value.toISOString();
      else if (Array.isArray(value)) {
        if (value.some((v) => v && typeof v === "object")) addRows(sheets, `${sheet}_${prefix}`.slice(0, 31), value, id);
        else flat[prefix] = value.join(", ");
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (!SECRET_KEY.test(key)) walk(child, prefix ? `${prefix}_${key}` : key);
        }
      } else flat[prefix || "value"] = value ?? "";
    };
    walk(raw, "");
    out.push(flat);
  });
}

export function toSheets(data: ExportSheets) {
  const sheets: Record<string, Row[]> = {};
  for (const [sheet, rows] of Object.entries(data)) addRows(sheets, sheet.slice(0, 31), rows);
  return sheets;
}

/** Downloads <name>-<date>.json (raw rows) and <name>-<date>.xlsx (one sheet per entity). */
export async function exportAll(name: string, data: ExportSheets) {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadJson(`${name}-${stamp}.json`, data);

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const [sheet, rows] of Object.entries(toSheets(data))) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), sheet);
  }
  XLSX.writeFile(wb, `${name}-${stamp}.xlsx`);
}
