// Writes allorderdetails.json for migration: every order in PHP order_tbl with its effective lines,
// joined to the Mongo layers the app puts on top (edits, cancellation, mirror repair, dispatch, notes,
// amount overrides). Same rules as the order detail page / withOrderItems in src/lib/exportAll.ts.
// Run from frontend/: node --env-file=.env scripts/export-order-details.mjs [out.json]
import assert from "node:assert/strict";
import dns from "node:dns";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { MongoClient } from "mongodb";

dns.setServers(["8.8.8.8"]); // mongodb+srv does not resolve with this machine's default DNS

const FRONTEND = path.resolve(import.meta.dirname, "..");
const OUT = path.resolve(process.argv[2] ?? path.join(FRONTEND, "..", "allorderdetails.json"));
const PHP_API = "https://mirisoft.co.in/sas/dealerapi/api";
// Several PHP "write" endpoints answer GET, so only these verified read-only ones may be called.
const PHP_READ_ONLY = new Set(["orderlist", "productlist", "dealeraddress", "stafflist", "Orderstatusa", "getremark", "check_invoice_id"]);

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => (String(url).startsWith("/") // catalogueClient reads /data/*.json from public/
  ? new Response(readFileSync(path.join(FRONTEND, "public", String(url))))
  : realFetch(url, init));

const jiti = createJiti(import.meta.url, { alias: { "@": path.join(FRONTEND, "src") } });
const lib = (file) => jiti.import(path.join(FRONTEND, "src/lib", file));
const { withDisplayOrderAmounts } = await lib("orderAmounts.ts");
const { normalizeOrderDetailResponse } = await lib("orderDetailItems.ts");
const { mergeOrderItemsWithDispatchRecords } = await lib("orderDispatch.ts");
const { compareOrderSnapshot, repairOrderDetailRows, snapshotFromOrderDetailRows } = await lib("orderMirror.ts");
const { isOrderMongoDocumentVisible, ORDER_MONGO_DATA_CUTOFF_ISO } = await lib("orderMongoCutoff.ts");
const { mergeFallbackProductNotes } = await lib("orderProductNotes.mjs");
const { applyEditedLine, computeLineFromPieces, resolveLinePackSize, resolveLinePacks, resolveLinePieces } = await lib("orderEditPricing.ts");
const { buildCatalogueIndex } = await lib("catalogue.ts");
const { loadCatalogueProducts } = await lib("catalogueClient.ts");
const { orderLookupKey } = await lib("exportAll.ts");

const text = (v) => String(v ?? "").trim();
const num = (v) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (rows, f) => round2(rows.reduce((s, r) => s + f(r), 0));
const time = (d) => new Date(d.updatedAt ?? d.createdAt ?? 0).getTime() || 0;
const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
  return map;
};
const countBy = (rows, key) => Object.fromEntries(groupBy(rows, key).entries().map(([k, v]) => [k, v.length]));

async function php(endpoint, params = {}) {
  if (!PHP_READ_ONLY.has(endpoint)) throw new Error(`${endpoint} is not an allowlisted read endpoint`);
  const url = `${PHP_API}/${endpoint}?${new URLSearchParams(params)}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await realFetch(url, { signal: AbortSignal.timeout(60_000) });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = JSON.parse(body.slice(body.indexOf("{"))).data;
      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (attempt >= 3) throw new Error(`${url}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i]); }
  }));
  return out;
}

// ---- PHP (MySQL) ----
console.log("PHP: orders, products, dealers, staff…");
const [phpOrders, products, dealers, staff, invoiceRows] = await Promise.all(
  ["orderlist", "productlist", "dealeraddress", "stafflist", "check_invoice_id"].map((e) => php(e)),
);
if (invoiceRows.length) console.warn(`WARNING: invoice_tbl has ${invoiceRows.length} rows; invoices are not exported.`);
const ordersById = new Map(phpOrders.map((o) => [text(o.order_id), o]));
assert.equal(ordersById.size, phpOrders.length, "duplicate order_id in order_tbl");

// orderdatalist INNER JOINs product_tbl and drops lines, so read raw orderdata_tbl per dealer id.
// Every id up to the max is asked, so lines of deleted dealers (hidden by orderlist's dealer join) surface as orphans.
const maxDealerId = Math.max(...dealers.map((d) => num(d.Dealer_Id)), ...phpOrders.map((o) => num(o.order_dealer)));
console.log(`PHP: orderdata_tbl lines for dealer ids 1..${maxDealerId}…`);
const phpLines = (await mapLimit(Array.from({ length: maxDealerId }, (_, i) => i + 1), 6, (id) => php("Orderstatusa", { id }))).flat();
assert.equal(new Set(phpLines.map((l) => text(l.orderdata_id))).size, phpLines.length, "duplicate orderdata_id");

// remark_tbl (legacy PHP dispatch log) is only written by the two PHP dispatch updates, which also
// bump readyquantity/orderdata_status/notification, so untouched lines can't have remarks.
const touched = phpLines.filter((l) => num(l.readyquantity) > 0 || text(l.orderdata_status) !== "0" || text(l.notification) !== "0");
console.log(`PHP: remark_tbl for ${touched.length} dispatched lines…`);
const remarksByLine = new Map(await mapLimit(touched, 6, async (l) => [text(l.orderdata_id), await php("getremark", { id: l.orderdata_id })]));

// ---- Mongo ----
console.log("Mongo: order collections…");
const client = await new MongoClient(process.env.MONGODB_URI.trim()).connect();
const db = client.db(process.env.MONGODB_DB_NAME?.trim() || "omsons");
const mongoStats = {};
async function mongoByOrder(name, { key = "orderId", dates } = {}) {
  const stats = (mongoStats[name] = { attached: 0, beforeCutoff: 0, notLinkedToPhpOrder: 0, dealerMismatch: [] });
  const byOrder = new Map();
  for (const { _id, ...doc } of await db.collection(name).find().toArray()) {
    const orderId = orderLookupKey(doc[key] || doc.order_id);
    const order = ordersById.get(orderId);
    if (!isOrderMongoDocumentVisible(doc, dates)) stats.beforeCutoff++;
    else if (!order) stats.notLinkedToPhpOrder++;
    else if (doc.dealerId && text(doc.dealerId) !== text(order.order_dealer)) {
      stats.dealerMismatch.push({ id: String(_id), orderId, mongoDealerId: text(doc.dealerId), phpDealerId: text(order.order_dealer) });
    } else {
      stats.attached++;
      byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), doc]);
    }
  }
  return byOrder;
}
const [mirrors, overlays, dispatchRecords, productNotes, orderNotes, overrides, walletTx, discountRequests] = await Promise.all([
  mongoByOrder("order_mirrors"),
  mongoByOrder("order_overlays", { dates: ["createdAt", "updatedAt", "cancellation.cancelledAt", "acceptance.acceptedAt"] }),
  mongoByOrder("order_dispatch_records"),
  mongoByOrder("order_product_notes"),
  mongoByOrder("order_notes"),
  mongoByOrder("order_summary_overrides"),
  mongoByOrder("wallet_transactions", { key: "relatedOrderId" }),
  mongoByOrder("custom_discount_requests"),
]);
await client.close();

// ---- Lookups ----
const productByCat = new Map(products.map((p) => [text(p.product_cat), p]));
const variants = buildCatalogueIndex(await loadCatalogueProducts()).variantsBySku;
const packLookup = {};
for (const [sku, { variant }] of Object.entries(variants)) if (variant.pack) packLookup[sku] = variant.pack;
const staffById = new Map(staff.map((s) => [text(s.staff_id), text(s.staff_name)]));
const dealerById = new Map(dealers.map((d) => [text(d.Dealer_Id), d]));
const linesByOrder = groupBy(phpLines, (l) => text(l.orderdata_orderid));
const latestOrderOfDealer = new Map();
for (const o of phpOrders) {
  if (num(o.order_id) > num(latestOrderOfDealer.get(text(o.order_dealer)))) latestOrderOfDealer.set(text(o.order_dealer), text(o.order_id));
}

function cleanLine(line, index, source) {
  const sku = text(line.orderdata_cat_no);
  const tbl = productByCat.get(sku);
  const cat = variants[sku];
  const quantity = resolveLinePieces(line);
  const unitPrice = num(line.orderdata_price);
  const grossAmount = num(line.orderdata_totalprice) || round2(quantity * unitPrice);
  const discountAmount = num(line.orderdata_discount);
  const packSize = resolveLinePackSize(line, packLookup);
  const lineId = text(line.orderdata_id);
  return {
    lineNo: index + 1,
    lineId,
    sku,
    productName: text(line.product_name) || text(tbl?.product_name) || text(cat?.variant.name),
    productDescription: text(line.product_discription) || text(tbl?.product_discription) || text(cat?.variant.specsText),
    category: text(cat?.product.category),
    unit: text(line.product_unit) || text(tbl?.product_unit),
    productFoundIn: tbl ? "product_tbl" : cat ? "catalogue" : "none",
    quantity,
    packSize,
    packs: resolveLinePacks(line, packSize),
    unitPrice,
    grossAmount,
    discountAmount,
    discountPercent: grossAmount ? round2((discountAmount / grossAmount) * 100) : 0,
    netAmount: num(line.orderdata_afterDisPrice),
    remarks: text(line.remarks ?? line.remark),
    productNote: text(line.fallbackProductNote),
    lineCreatedAt: text(line.orderdata_datetime),
    source,
    ...(line.dispatchStatus && {
      dispatch: {
        status: line.dispatchStatus,
        orderedQuantity: line.orderedQuantity,
        dispatchedQuantity: line.dispatchedQuantity,
        remainingQuantity: line.remainingQuantity,
        updates: (line.dispatchHistory ?? []).map(({ id, ...update }) => update),
        legacyPhpRemarks: remarksByLine.get(lineId) ?? [],
      },
    }),
  };
}

// ---- Orders ----
const orders = phpOrders.toSorted((a, b) => num(a.order_id) - num(b.order_id)).map((php) => {
  const orderId = text(php.order_id);
  const dealerId = text(php.order_dealer);
  const dealer = dealerById.get(dealerId);
  const warnings = [];
  const latest = (map, name) => {
    const docs = map.get(orderId) ?? [];
    if (docs.length > 1) warnings.push(`${docs.length} ${name} docs for this order; using the latest`);
    return docs.toSorted((a, b) => time(a) - time(b)).at(-1);
  };
  const overlay = latest(overlays, "order_overlays");
  const mirror = latest(mirrors, "order_mirrors");
  const override = latest(overrides, "order_summary_overrides");

  const rawLines = linesByOrder.get(orderId) ?? [];
  for (const l of rawLines) {
    if (text(l.orderdata_dealerid) !== dealerId) warnings.push(`PHP line ${l.orderdata_id} has dealer ${l.orderdata_dealerid}, order has ${dealerId}`);
    if (text(l.del_status) !== text(php.del_status)) warnings.push(`PHP line ${l.orderdata_id} del_status ${l.del_status} differs from order del_status ${php.del_status}`);
  }

  // Effective lines, as the order detail page resolves them: the latest dealer edit wins; otherwise
  // the PHP lines, rebuilt from the Mongo submission mirror when PHP stored something different.
  const { meta, items: phpRows } = normalizeOrderDetailResponse({ data: rawLines }, orderId);
  const revision = overlay?.edits?.at(-1);
  let lines = phpRows;
  let lineSource = "php";
  let mirrorCheck = null;
  if (revision?.effectiveItems?.length) {
    // The edit screen loads lines through PHP orderdatalist, which drops cat nos missing from product_tbl.
    // Those lines were never shown to the editor, so nobody removed them: keep them as stored in PHP.
    const seenByEdit = new Set(overlay.edits.flatMap((e) => [...(e.originalItems ?? []), ...(e.effectiveItems ?? [])]).map((l) => text(l.orderdata_id)));
    const hidden = phpRows.filter((r) => !seenByEdit.has(text(r.orderdata_id))).map((r) => ({ ...r, hiddenFromEdit: true }));
    if (hidden.length) warnings.push(`PHP lines ${hidden.map((r) => r.orderdata_id).join(", ")} were hidden from the edit (cat no not in product_tbl); kept from PHP`);
    lines = [...revision.effectiveItems, ...hidden];
    lineSource = "edit_revision";
  } else if (mirror?.snapshot) {
    mirrorCheck = compareOrderSnapshot(mirror.snapshot, snapshotFromOrderDetailRows(phpRows, meta));
    if (!mirrorCheck.matches) {
      lines = repairOrderDetailRows(phpRows, mirror.snapshot, orderId);
      lineSource = "mirror_repaired";
    }
  }
  const merged = mergeOrderItemsWithDispatchRecords(
    mergeFallbackProductNotes(lines, productNotes.get(orderId) ?? []),
    dispatchRecords.get(orderId) ?? [],
  );
  const items = merged.map((line, i) => {
    const source = line.hiddenFromEdit ? "php_hidden_from_edit" : lineSource === "edit_revision" ? "edit_revision"
      : line.mirrorRepaired ? `mirror_${line.mirrorRepairSource}` : "php";
    const pieces = resolveLinePieces(line);
    // Older dealer edits saved the new quantity but kept the old line amounts (the revision totals are right).
    if (source === "edit_revision" && Math.abs(num(line.orderdata_totalprice) - pieces * num(line.orderdata_price)) > 1) {
      warnings.push(`line ${line.orderdata_id}: edit kept stale line amounts; recomputed for ${pieces} pieces`);
      line = applyEditedLine(line, computeLineFromPieces(line, pieces, resolveLinePackSize(line, packLookup)));
    }
    return cleanLine(line, i, source);
  });

  const lineIds = items.map((i) => i.lineId);
  const duplicateIds = [...new Set(lineIds.filter((id, i) => lineIds.indexOf(id) !== i))];
  if (duplicateIds.length) warnings.push(`duplicate lineIds in items: ${duplicateIds.join(", ")}`);
  const replacedByEdit = new Set((overlay?.edits ?? []).flatMap((e) => e.changes ?? []).filter((c) => c.type !== "quantity_changed").map((c) => text(c.originalLineId)));
  const unexplained = phpRows.filter((r) => !lineIds.includes(text(r.orderdata_id)) && !replacedByEdit.has(text(r.orderdata_id)));
  if (unexplained.length) warnings.push(`PHP lines missing from items without an edit removing them: ${unexplained.map((r) => r.orderdata_id).join(", ")} (see phpStoredItems)`);
  for (const i of items) {
    if (i.dispatch.orderedQuantity !== i.quantity) warnings.push(`line ${i.lineId}: dispatch orderedQuantity ${i.dispatch.orderedQuantity} != quantity ${i.quantity}`);
    if (Math.abs(i.grossAmount - i.quantity * i.unitPrice) > 1) warnings.push(`line ${i.lineId}: grossAmount ${i.grossAmount} != quantity ${i.quantity} x unitPrice ${i.unitPrice}`);
  }
  if (!items.length) warnings.push("order has no lines");

  const placed = withDisplayOrderAmounts(php, override);
  const asPlaced = {
    source: placed.priceSource,
    grossAmount: placed.grossAmount,
    baseDiscountPercent: placed.baseDiscountPercent ?? null,
    baseDiscountAmount: placed.baseDiscountAmount,
    additionalDiscountType: placed.additionalDiscountType,
    slabDiscountPercent: placed.slabDiscountPercent,
    slabDiscountAmount: placed.slabDiscountAmount,
    customDiscountPercent: placed.customDiscountPercent ?? null,
    customDiscountAmount: placed.customDiscountAmount,
    discountAmount: placed.discountAmount,
    netPayableAmount: placed.netPayableAmount,
  };
  const itemsGross = sum(items, (i) => i.grossAmount);
  // Edited orders total their lines (sumEditedTotals); some old revisions stored totals that don't match their own lines.
  const current = revision
    ? { grossAmount: itemsGross, discountAmount: sum(items, (i) => i.discountAmount), netPayableAmount: round2(itemsGross - sum(items, (i) => i.discountAmount)) }
    : asPlaced;
  if (revision && Math.abs(revision.totals.netPayableAmount - current.netPayableAmount) > 5) { // per-line discount rounding
    warnings.push(`stored edit totals (net ${revision.totals.netPayableAmount}) differ from the effective lines (net ${current.netPayableAmount}); amounts use the lines`);
  }
  if (!revision && items.length && Math.abs(itemsGross - current.grossAmount) > 1) warnings.push(`items gross ${itemsGross} != order grossAmount ${current.grossAmount}`);

  const cancellation = overlay?.status === "cancelled" ? overlay.cancellation ?? {} : null;
  const accepted = text(php.accept_order) === "1" || overlay?.acceptance?.status === "accepted";
  const deleted = text(php.del_status) === "1";
  const dispatched = sum(items, (i) => i.dispatch.dispatchedQuantity);
  const remaining = sum(items, (i) => i.dispatch.remainingQuantity);
  const fulfillment = !items.length ? "no_lines" : remaining === 0 ? "fully_dispatched" : dispatched > 0 ? "partially_dispatched" : "not_dispatched";
  const shipToFromMirror = text(mirror?.submittedForm?.Dealer_shipto);

  return {
    orderId,
    orderNumber: `OM/${text(php.orderDate || php.order_date).slice(0, 4)}/${orderId}`,
    orderDate: text(php.orderDate),
    createdAt: text(php.order_date),
    outstandingDate: text(php.outstandingDate),
    status: {
      current: cancellation ? "cancelled" : deleted ? "deleted" : fulfillment === "fully_dispatched" ? "completed"
        : fulfillment === "partially_dispatched" ? "partially_dispatched" : accepted ? "accepted" : "pending",
      accepted,
      fulfillment,
      deleted,
      deleteReason: text(php.reason),
      cancelled: !!cancellation,
      cancellation: cancellation && {
        reason: cancellation.reason ?? "",
        cancelledAt: cancellation.cancelledAt ?? overlay.updatedAt,
        cancelledBy: cancellation.cancelledBy ?? null,
      },
      edited: !!revision,
      latestRevision: overlay?.latestRevision ?? 0,
      phpOrderStatus: text(php.order_status),
    },
    dealer: {
      id: dealerId,
      name: text(dealer?.Dealer_Name ?? php.Dealer_Name),
      code: text(dealer?.Dealer_Dealercode),
      city: text(dealer?.Dealer_City),
      pincode: text(dealer?.Dealer_Pincode),
      gst: text(dealer?.gst),
      phone: text(dealer?.Dealer_Number),
      email: text(dealer?.Dealer_Email),
      address: text(dealer?.Dealer_Address),
    },
    shipTo: shipToFromMirror
      ? { address: shipToFromMirror, source: "order_mirror" }
      : latestOrderOfDealer.get(dealerId) === orderId && text(dealer?.Dealer_shipto)
        ? { address: text(dealer.Dealer_shipto), source: "dealer_tbl_current" }
        : { address: null, source: "not_recorded" },
    assignedStaff: text(php.staffid).split(",").map(text).filter(Boolean).map((id) => ({ id, name: staffById.get(id) ?? null })),
    amounts: {
      source: revision ? "edited_lines" : asPlaced.source,
      grossAmount: current.grossAmount,
      discountAmount: current.discountAmount,
      netPayableAmount: current.netPayableAmount,
      asPlaced,
    },
    itemsSource: lineSource,
    itemCount: items.length,
    totalQuantity: sum(items, (i) => i.quantity),
    items,
    phpStoredItems: lineSource === "php" ? [] : phpRows.map((r, i) => cleanLine(r, i, "php")),
    orderNotes: (orderNotes.get(orderId) ?? []).map(({ note, createdAt, updatedAt }) => ({ note, createdAt, updatedAt })),
    submission: mirror ? {
      submittedAt: mirror.createdAt,
      submittedBy: mirror.actor ?? null,
      idempotencyKey: mirror.idempotencyKey ?? null,
      phpMatchedSubmission: mirrorCheck ? mirrorCheck.matches : null,
      mismatches: mirrorCheck?.mismatches ?? [],
    } : null,
    editHistory: (overlay?.edits ?? []).map((e) => ({
      revision: e.revision,
      editedAt: e.editedAt,
      editedBy: e.editedBy,
      totals: e.totals,
      changes: (e.changes ?? []).map(({ original, current, ...change }) => change),
    })),
    customDiscountRequests: (discountRequests.get(orderId) ?? []).map((r) => ({
      status: r.status,
      discountScope: r.discountScope,
      currentDiscountPercent: r.currentDiscountPercent,
      requestedDiscountPercent: r.requestedDiscountPercent,
      requestedProductDiscounts: r.requestedProductDiscounts ?? null,
      requestedDiscountAmount: r.requestedDiscountAmount,
      requestedFinalPayable: r.requestedFinalPayable,
      refno: r.refno ?? "",
      shipto: r.shipto ?? "",
      adminNote: r.adminNote ?? "",
      reviewedBy: r.reviewedBy ?? null,
      reviewedAt: r.reviewedAt ?? null,
      requestedAt: r.createdAt,
    })),
    walletTransactions: (walletTx.get(orderId) ?? []).map((t) => ({
      type: t.type, amount: t.amount, balanceBefore: t.balanceBefore, balanceAfter: t.balanceAfter,
      reference: t.reference, note: t.note, transactionDate: t.transactionDate, actorRole: t.actorRole, actorName: t.actorName,
    })),
    warnings,
  };
});

const orphanPhpLines = phpLines.filter((l) => !ordersById.has(text(l.orderdata_orderid)))
  .map((l, i) => ({ orderId: text(l.orderdata_orderid), dealerId: text(l.orderdata_dealerid), ...cleanLine(l, i, "php") }));

// Self-check: every order_tbl row is exported once and every orderdata_tbl line lands in exactly one place.
assert.equal(orders.length, phpOrders.length);
for (const o of orders) {
  const stored = (o.itemsSource === "php" ? o.items : o.phpStoredItems).map((i) => i.lineId).sort();
  assert.deepEqual(stored, (linesByOrder.get(o.orderId) ?? []).map((l) => text(l.orderdata_id)).sort(), `order ${o.orderId} lost PHP lines`);
}
assert.equal(sum(orders, (o) => (linesByOrder.get(o.orderId) ?? []).length) + orphanPhpLines.length, phpLines.length);

const output = {
  generatedAt: new Date().toISOString(),
  sources: { php: PHP_API, mongoDb: db.databaseName, mongoCutoff: ORDER_MONGO_DATA_CUTOFF_ISO },
  counts: {
    orders: orders.length,
    ordersByStatus: countBy(orders, (o) => o.status.current),
    ordersByItemsSource: countBy(orders, (o) => o.itemsSource),
    items: sum(orders, (o) => o.itemCount),
    phpLines: phpLines.length,
    orphanPhpLines: orphanPhpLines.length,
    ordersWithWarnings: orders.filter((o) => o.warnings.length).length,
  },
  mongo: mongoStats,
  fieldNotes: {
    items: "Effective lines (what the app shows): the latest dealer edit if any, else PHP orderdata_tbl lines, rebuilt from the Mongo submission mirror where PHP stored them differently.",
    "items[].lineId": "orderdata_tbl.orderdata_id; 'mirror:<order>:<sku>' for a line PHP never stored.",
    "items[].quantity": "Pieces (orderdata_item_quantity). packs = quantity / packSize.",
    "items[].unitPrice": "Per-piece price at order time (orderdata_price).",
    "items[].grossAmount|discountAmount|netAmount": "orderdata_totalprice | orderdata_discount | orderdata_afterDisPrice.",
    "items[].dispatch": "Mongo order_dispatch_records, else legacy PHP readyquantity; legacyPhpRemarks = remark_tbl.",
    phpStoredItems: "Raw MySQL lines, filled only when items differ from them (edited or mirror-repaired orders).",
    amounts: "Current totals: sum of the effective lines for edited orders, else Mongo order_summary_overrides, else PHP order_tbl. asPlaced = the breakdown when placed. Raw PHP order_discount holds the net payable, not a discount.",
    "items[].source": "php | mirror_corrected | mirror_restored | edit_revision | php_hidden_from_edit (PHP line the edit screen never loaded).",
    dealer: "Current dealer_tbl values; PHP keeps no per-order copy.",
    shipTo: "Per-order ship-to exists only in order_mirrors; PHP overwrites dealer_tbl.Dealer_shipto on every order, so that is used for the dealer's latest order only.",
    mongo: "Mongo docs dated before mongoCutoff, not linked to a PHP order, or whose dealerId differs from the PHP order were left out (counted per collection).",
  },
  orders,
  orphanPhpLines,
};
writeFileSync(OUT, JSON.stringify(output, (k, v) => (/pass(word)?$/i.test(k) ? undefined : v), 2));
console.log(JSON.stringify(output.counts, null, 2));
console.log(`wrote ${OUT}`);
