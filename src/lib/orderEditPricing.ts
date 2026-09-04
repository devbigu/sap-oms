/**
 * Shared line math for the order edit dialog and the overlay apply path.
 *
 * Backend contract (see orderRowPricing.test.mjs): `orderdata_item_quantity` is
 * a PIECE count and `orderdata_price` its unit price. The dialog lets a dealer
 * edit packs because that is how orders are placed, so packs are converted back
 * to pieces here — pieces stay the stored unit everywhere else.
 */

export type EditableLine = Record<string, unknown>;

export function num(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Catalogue pack size wins; a line only falls back to its own stored value. */
export function resolveLinePackSize(item: EditableLine, packLookup: Record<string, number> = {}) {
  const catNo = String(item.orderdata_cat_no ?? "").trim();
  return Math.max(1, num(packLookup[catNo]) || num(item.packSize ?? item.pack_size) || 1);
}

export function resolveLinePieces(item: EditableLine) {
  return num(item.totalPieces ?? item.total_pieces) || num(item.orderdata_item_quantity);
}

/** Packs shown in the dialog, derived from the stored piece count. */
export function resolveLinePacks(item: EditableLine, packSize: number) {
  const pieces = resolveLinePieces(item);
  if (pieces <= 0) return 0;
  return packSize > 1 ? Math.max(1, Math.round(pieces / packSize)) : pieces;
}

/**
 * The line's effective discount rate, taken from the order as originally placed
 * so that changing quantity scales the discount instead of dropping it.
 */
export function resolveLineDiscountPercent(item: EditableLine) {
  const explicit = num(item.totalDiscountPercent ?? item.total_discount_percentage ?? item.discountPercent);
  if (explicit > 0) return explicit;

  const originalPieces = resolveLinePieces(item);
  const originalGross = num(item.listPriceTotal ?? item.list_price_total)
    || num(item.orderdata_totalprice)
    || originalPieces * num(item.orderdata_price);
  const originalDiscount = num(item.orderdata_discount ?? item.discountAmount);
  return originalGross > 0 && originalDiscount > 0 ? (originalDiscount / originalGross) * 100 : 0;
}

export type EditedLineMoney = {
  packs: number;
  packSize: number;
  pieces: number;
  unitPrice: number;
  gross: number;
  discountPercent: number;
  discount: number;
  final: number;
};

/**
 * Recompute one line from a piece count. Amount = pieces * unit price.
 * Packs are reported back but never round-trip the piece count, so a line whose
 * pieces are not a whole multiple of the pack size keeps its exact quantity.
 */
export function computeLineFromPieces(item: EditableLine, pieces: number, packSize: number): EditedLineMoney {
  const safePackSize = Math.max(1, Math.floor(num(packSize)) || 1);
  const safePieces = Math.max(0, Math.round(num(pieces)));
  const safePacks = safePackSize > 1 ? Math.max(safePieces > 0 ? 1 : 0, Math.round(safePieces / safePackSize)) : safePieces;
  const unitPrice = num(item.unitPrice ?? item.unit_price ?? item.orderdata_price);
  const discountPercent = resolveLineDiscountPercent(item);
  const gross = roundMoney(safePieces * unitPrice);
  const discount = roundMoney(gross * (discountPercent / 100));
  return {
    packs: safePacks,
    packSize: safePackSize,
    pieces: safePieces,
    unitPrice,
    gross,
    discountPercent,
    discount,
    final: roundMoney(Math.max(0, gross - discount)),
  };
}

/** Dialog entry point: Qty is edited in packs, so pieces = packs * pack size. */
export function computeEditedLine(item: EditableLine, packs: number, packSize: number): EditedLineMoney {
  const safePackSize = Math.max(1, Math.floor(num(packSize)) || 1);
  const safePacks = Math.max(0, Math.floor(num(packs)));
  return computeLineFromPieces(item, safePacks * safePackSize, safePackSize);
}

/**
 * Apply the recomputed money back onto the line in the shape the overlay and
 * PHP both expect — quantity in pieces, and no stale per-line totals left over.
 */
export function applyEditedLine(item: EditableLine, money: EditedLineMoney): EditableLine {
  return {
    ...item,
    orderdata_item_quantity: String(money.pieces),
    totalPieces: String(money.pieces),
    quantityPacks: String(money.packs),
    packSize: String(money.packSize),
    orderdata_price: String(money.unitPrice),
    orderdata_totalprice: String(money.gross),
    listPriceTotal: String(money.gross),
    orderdata_discount: String(money.discount),
    orderdata_afterDisPrice: String(money.final),
  };
}

export function sumEditedTotals(lines: EditedLineMoney[]) {
  const grossAmount = roundMoney(lines.reduce((sum, line) => sum + line.gross, 0));
  const discountAmount = roundMoney(lines.reduce((sum, line) => sum + line.discount, 0));
  return {
    grossAmount,
    discountAmount,
    netPayableAmount: roundMoney(Math.max(0, grossAmount - discountAmount)),
  };
}
