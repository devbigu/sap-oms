import { normalizeOrderDetailSku } from "@/lib/orderDetailItems";

export const ORDER_MIRROR_COLLECTION = "order_mirrors";

export type OrderMirrorItem = {
  catNo: string;
  productName: string;
  quantity: number;
  price: number;
  discount: number;
  finalPrice: number;
};

export type OrderMirrorTotals = {
  subtotal: number;
  baseDiscountAmount: number;
  additionalDiscountAmount: number;
  discountAmount: number;
  finalPayableAmount: number;
};

export type OrderMirrorSnapshot = {
  itemCount: number;
  totalQuantity: number;
  items: OrderMirrorItem[];
  totals: OrderMirrorTotals;
};

export type OrderMirrorMismatch = {
  field: string;
  catNo?: string;
  expected: number | string;
  actual: number | string;
};

export type OrderMirrorVerification = {
  matches: boolean;
  mismatches: OrderMirrorMismatch[];
};

function num(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function text(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

/** Sum of every row's quantity/discount/etc, so one dropped line is visible in the totals too. */
function summarize(items: OrderMirrorItem[]) {
  return {
    itemCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

/**
 * Build the snapshot from exactly what the client submitted to PHP — the
 * `productorder` JSON plus the amount fields validated by the order route.
 */
export function buildOrderMirrorSnapshot(form: {
  get(name: string): unknown;
}): OrderMirrorSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(form.get("productorder"), 2_000_000));
  } catch {
    parsed = [];
  }
  const rows = Array.isArray(parsed) ? parsed : [];
  const items = rows.map((raw): OrderMirrorItem => {
    const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return {
      catNo: text(row.catNo ?? row.productname),
      productName: text(row.productName ?? row.productname),
      quantity: num(row.producQuanity),
      price: num(row.price),
      discount: num(row.discount),
      finalPrice: num(row.afterDiscountPrice),
    };
  });

  const base = num(form.get("baseDiscountAmount"));
  const additional = num(form.get("additionalDiscountAmount"));
  return {
    ...summarize(items),
    items,
    totals: {
      subtotal: num(form.get("subtotal")),
      baseDiscountAmount: base,
      additionalDiscountAmount: additional,
      discountAmount: Math.round((base + additional) * 100) / 100,
      finalPayableAmount: num(form.get("finalPayableAmount")),
    },
  };
}

/** PHP order detail rows (already normalized by normalizeOrderDetailResponse). */
export function snapshotFromOrderDetailRows(
  rows: Array<Record<string, unknown>>,
  meta: Record<string, unknown> = {}
): OrderMirrorSnapshot {
  const items = rows.map((row): OrderMirrorItem => ({
    catNo: text(row.orderdata_cat_no),
    productName: text(row.product_name),
    quantity: num(row.orderdata_item_quantity),
    price: num(row.orderdata_price),
    discount: num(row.orderdata_discount),
    finalPrice: num(row.orderdata_afterDisPrice),
  }));
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.quantity * item.price, 0) * 100) / 100;
  const discountAmount = Math.round(items.reduce((sum, item) => sum + item.discount, 0) * 100) / 100;
  return {
    ...summarize(items),
    items,
    totals: {
      subtotal: num(meta.order_amount) || subtotal,
      baseDiscountAmount: num(meta.baseDiscountAmount),
      additionalDiscountAmount: num(meta.additionalDiscountAmount),
      discountAmount: num(meta.order_discount_amount) || discountAmount,
      finalPayableAmount: num(meta.order_net_amount) || Math.round((subtotal - discountAmount) * 100) / 100,
    },
  };
}

function closeMoney(a: number, b: number) {
  return Math.abs(a - b) <= 0.02;
}

/** Group by SKU so duplicated lines of the same product still reconcile. */
function bySku(items: OrderMirrorItem[]) {
  const map = new Map<string, OrderMirrorItem>();
  for (const item of items) {
    const key = normalizeOrderDetailSku(item.catNo);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, catNo: item.catNo || key });
      continue;
    }
    existing.quantity += item.quantity;
    existing.discount = Math.round((existing.discount + item.discount) * 100) / 100;
    existing.finalPrice = Math.round((existing.finalPrice + item.finalPrice) * 100) / 100;
  }
  return map;
}

/**
 * Compare the mirrored submission against what the PHP backend actually stored.
 * `expected` is always the Mongo snapshot; `actual` is the live PHP order.
 */
export function compareOrderSnapshot(
  expected: OrderMirrorSnapshot,
  actual: OrderMirrorSnapshot
): OrderMirrorVerification {
  const mismatches: OrderMirrorMismatch[] = [];
  const expectedItems = bySku(expected.items);
  const actualItems = bySku(actual.items);

  if (expectedItems.size !== actualItems.size) {
    mismatches.push({ field: "itemCount", expected: expectedItems.size, actual: actualItems.size });
  }

  for (const [sku, item] of expectedItems) {
    const match = actualItems.get(sku);
    if (!match) {
      mismatches.push({ field: "missingProduct", catNo: item.catNo, expected: item.catNo, actual: "" });
      continue;
    }
    if (item.quantity !== match.quantity) {
      mismatches.push({ field: "quantity", catNo: item.catNo, expected: item.quantity, actual: match.quantity });
    }
    if (!closeMoney(item.price, match.price)) {
      mismatches.push({ field: "price", catNo: item.catNo, expected: item.price, actual: match.price });
    }
    if (!closeMoney(item.discount, match.discount)) {
      mismatches.push({ field: "discount", catNo: item.catNo, expected: item.discount, actual: match.discount });
    }
  }

  for (const [sku, item] of actualItems) {
    if (!expectedItems.has(sku)) {
      mismatches.push({ field: "extraProduct", catNo: item.catNo, expected: "", actual: item.catNo });
    }
  }

  for (const key of ["subtotal", "discountAmount", "finalPayableAmount"] as const) {
    if (!closeMoney(expected.totals[key], actual.totals[key])) {
      mismatches.push({ field: key, expected: expected.totals[key], actual: actual.totals[key] });
    }
  }

  return { matches: mismatches.length === 0, mismatches };
}

/**
 * Rebuild the order lines from the mirror when PHP lost or garbled them.
 *
 * PHP rows stay the source for anything the mirror does not own (line ids,
 * dispatch/ready quantities, status), so only the fields that actually drifted
 * are replaced and a missing line is re-added from the submitted payload.
 */
export function repairOrderDetailRows(
  phpRows: Array<Record<string, unknown>>,
  snapshot: OrderMirrorSnapshot,
  orderId: string
): Array<Record<string, unknown>> {
  const phpBySku = new Map<string, Record<string, unknown>>();
  for (const row of phpRows) {
    const key = normalizeOrderDetailSku(row.orderdata_cat_no);
    if (key && !phpBySku.has(key)) phpBySku.set(key, row);
  }

  return snapshot.items.map((item, index) => {
    const key = normalizeOrderDetailSku(item.catNo);
    const phpRow = phpBySku.get(key);
    const base = phpRow ?? {
      orderdata_id: `mirror:${orderId}:${key || index}`,
      orderdata_orderid: orderId,
      orderdata_status: "0",
      readyquantity: "0",
      product_unit: "Pcs",
    };
    return {
      ...base,
      orderdata_cat_no: item.catNo,
      product_name: item.productName || text(base.product_name),
      orderdata_item_quantity: String(item.quantity),
      orderdata_price: String(item.price),
      orderdata_discount: String(item.discount),
      orderdata_afterDisPrice: String(item.finalPrice),
      orderdata_totalprice: String(Math.round(item.quantity * item.price * 100) / 100),
      mirrorRepaired: true,
      mirrorRepairSource: phpRow ? "corrected" : "restored",
    };
  });
}
