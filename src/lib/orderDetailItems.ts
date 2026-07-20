export type OrderDetailRow = Record<string, unknown> & {
  orderdata_id: string;
  orderdata_orderid: string;
  orderdata_cat_no: string;
};

export type OrderDetailOverlay = {
  effectiveItems?: Array<Record<string, unknown>>;
  itemContract?: "complete" | "partial";
  changeHistory?: Array<Record<string, unknown>>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeOrderDetailSku(value: unknown) {
  return text(value).replace(/\s+/g, " ").toLowerCase();
}

function responseData(payload: unknown) {
  const value = record(payload);
  return "data" in value ? value.data : payload;
}

function extractRows(data: unknown): { meta: Record<string, unknown>; rows: Record<string, unknown>[] } {
  if (Array.isArray(data)) {
    const records = data.map(record);
    const nested = records.flatMap((entry) => Array.isArray(entry.items) ? entry.items.map(record) : []);
    return { meta: records[0] ?? {}, rows: nested.length > 0 ? nested : records };
  }

  const meta = record(data);
  return {
    meta,
    rows: Array.isArray(meta.items) ? meta.items.map(record) : [],
  };
}

function canonicalRow(
  item: Record<string, unknown>,
  meta: Record<string, unknown>,
  orderId: string,
  occurrence: number
): OrderDetailRow {
  const sku = text(item.orderdata_cat_no ?? item.catNo ?? item.productId ?? item.sku);
  const lineId = text(item.orderdata_id ?? item.orderItemId ?? item.id)
    || `php:${orderId}:${normalizeOrderDetailSku(sku)}:${occurrence}`;

  return {
    ...item,
    orderdata_id: lineId,
    orderdata_orderid: text(item.orderdata_orderid ?? item.orderId ?? orderId),
    orderdata_cat_no: sku,
    orderdata_item_quantity: text(item.orderdata_item_quantity ?? item.quantityPacks ?? item.quantity ?? 0),
    orderdata_price: text(item.orderdata_price ?? item.unitPrice ?? item.unit_price ?? 0),
    orderdata_discount: text(item.orderdata_discount ?? item.discountAmount ?? item.discount_amount ?? 0),
    orderdata_afterDisPrice: text(item.orderdata_afterDisPrice ?? item.finalPrice ?? item.final_price ?? 0),
    orderdata_status: text(item.orderdata_status ?? item.status ?? "0"),
    orderdata_datetime: text(item.orderdata_datetime ?? item.documentDate ?? meta.order_date),
    product_name: text(item.product_name ?? item.productName),
    product_discription: text(item.product_discription ?? item.productDescription),
    product_unit: text(item.product_unit ?? item.unit ?? "Pcs"),
    readyquantity: text(item.readyquantity ?? item.readyQuantity ?? 0),
    remark: item.remark ?? item.remarks,
    remarks: item.remarks ?? item.remark,
    packSize: item.packSize ?? item.pack_size,
    totalPieces: item.totalPieces ?? item.total_pieces,
    discount: text(item.discount ?? item.totalDiscountPercent ?? 0),
    order_discount: text(item.order_discount ?? item.discountAmount ?? 0),
    del_status: text(item.del_status ?? meta.del_status ?? "0"),
    accept_order: text(item.accept_order ?? meta.accept_order),
    staffid: text(item.staffid ?? meta.staffid),
    assignedstaff: text(item.assignedstaff ?? meta.assignedstaff),
    orderdata_dealerid: text(item.orderdata_dealerid ?? meta.orderdata_dealerid),
    order_dealer: text(item.order_dealer ?? meta.order_dealer ?? item.orderdata_dealerid ?? meta.orderdata_dealerid),
    Dealer_Name: item.Dealer_Name ?? meta.Dealer_Name,
    Dealer_Address: item.Dealer_Address ?? meta.Dealer_Address,
    Dealer_Number: item.Dealer_Number ?? meta.Dealer_Number,
    gst: item.gst ?? meta.gst,
  };
}

export function normalizeOrderDetailResponse(payload: unknown, orderId: string) {
  const { meta, rows } = extractRows(responseData(payload));
  const occurrences = new Map<string, number>();
  const items = rows.map((item) => {
    const sku = normalizeOrderDetailSku(item.orderdata_cat_no ?? item.catNo ?? item.productId ?? item.sku);
    const occurrence = (occurrences.get(sku) ?? 0) + 1;
    occurrences.set(sku, occurrence);
    return canonicalRow(item, meta, orderId, occurrence);
  });
  return { meta, items };
}

function lineIdentity(item: Record<string, unknown>) {
  return text(item.orderdata_id ?? item.orderItemId ?? item.id);
}

/**
 * The v1 overlay API returns a complete effective snapshot. Partial support is
 * retained for old documents that expose only change records.
 */
export function resolveEffectiveOrderDetailItems(
  phpItems: OrderDetailRow[],
  overlay: OrderDetailOverlay | null
): OrderDetailRow[] {
  if (!overlay || !Array.isArray(overlay.effectiveItems)) return phpItems;
  if (overlay.itemContract !== "partial") return overlay.effectiveItems as OrderDetailRow[];

  const changes = Array.isArray(overlay.changeHistory) ? overlay.changeHistory : [];
  const removed = new Set(changes
    .filter((change) => change.type === "removed" || change.type === "replaced")
    .map((change) => text(change.originalLineId))
    .filter(Boolean));
  const changedById = new Map(overlay.effectiveItems
    .map((item) => [lineIdentity(item), item] as const)
    .filter(([identity]) => identity));

  const merged = phpItems
    .filter((item) => !removed.has(lineIdentity(item)))
    .map((item) => changedById.get(lineIdentity(item)) ?? item);
  const existing = new Set(merged.map(lineIdentity));
  for (const item of overlay.effectiveItems) {
    const identity = lineIdentity(item);
    if (!identity || !existing.has(identity)) merged.push(item as OrderDetailRow);
  }
  return merged as OrderDetailRow[];
}

export function mergeOrderSummarySources(
  summary: Record<string, unknown> | null,
  overlayTotals: Record<string, unknown> | null
) {
  const merged = { ...(summary ?? {}) };
  for (const key of ["grossAmount", "discountAmount", "netPayableAmount"] as const) {
    const value = overlayTotals?.[key];
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  }
  return merged;
}
