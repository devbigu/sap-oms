export type OrderAmountSource = Record<string, unknown> & {
  order_amount?: string | number;
  order_discount?: string | number;
  order_discount_amount?: string | number;
  order_net_amount?: string | number;
  grossAmount?: string | number;
  discountAmount?: string | number;
  netPayableAmount?: string | number;
  total?: string | number;
  baseDiscountAmount?: string | number;
  base_discount_amount?: string | number;
  baseDiscountPercent?: string | number;
  base_discount_percent?: string | number;
  amountBeforeSlab?: string | number;
  amount_before_slab?: string | number;
  slabDiscountAmount?: string | number;
  slab_discount_amount?: string | number;
  slabDiscountPercent?: string | number;
  slab_discount_percent?: string | number;
};

export type ResolvedOrderAmounts = {
  gross: number;
  discountAmount: number;
  netPayable: number;
};

export type ResolvedOrderDiscountBreakdown = ResolvedOrderAmounts & {
  baseDiscountAmount: number;
  slabDiscountAmount: number;
  hasSlabDiscount: boolean;
  baseDiscountPercent?: number;
  slabDiscountPercent?: number;
  amountBeforeSlab?: number;
};

export function toMoneyNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;

  const amount = typeof value === "number"
    ? value
    : Number(String(value).replace(/,/g, "").trim());

  if (!Number.isFinite(amount)) return undefined;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function firstMoney(...values: unknown[]) {
  for (const value of values) {
    const amount = toMoneyNumber(value);
    if (amount !== undefined) return amount;
  }
  return undefined;
}

export function resolveOrderAmounts(
  order: OrderAmountSource,
  override?: OrderAmountSource
): ResolvedOrderAmounts {
  const gross = firstMoney(
    override?.grossAmount,
    override?.order_amount,
    order.grossAmount,
    order.order_amount,
    order.total
  ) ?? 0;

  const explicitNet = firstMoney(
    override?.netPayableAmount,
    override?.order_net_amount,
    order.netPayableAmount,
    order.order_net_amount
  );

  const explicitDiscount = firstMoney(
    override?.discountAmount,
    override?.order_discount_amount,
    order.discountAmount,
    order.order_discount_amount
  );

  const legacyPhpNet = firstMoney(
    override?.order_discount,
    order.order_discount
  );

  const netPayable = explicitNet
    ?? (explicitDiscount !== undefined ? Math.max(0, gross - explicitDiscount) : undefined)
    ?? legacyPhpNet
    ?? gross;

  const discountAmount = explicitDiscount ?? Math.max(0, gross - netPayable);

  return {
    gross,
    discountAmount,
    netPayable,
  };
}

export function resolveOrderDiscountBreakdown(
  order: OrderAmountSource,
  override?: OrderAmountSource
): ResolvedOrderDiscountBreakdown {
  const amounts = resolveOrderAmounts(order, override);

  const baseDiscountAmount = firstMoney(
    override?.baseDiscountAmount,
    override?.base_discount_amount,
    order.baseDiscountAmount,
    order.base_discount_amount
  );

  const slabDiscountAmount = firstMoney(
    override?.slabDiscountAmount,
    override?.slab_discount_amount,
    order.slabDiscountAmount,
    order.slab_discount_amount
  ) ?? 0;

  const baseDiscountPercent = firstMoney(
    override?.baseDiscountPercent,
    override?.base_discount_percent,
    order.baseDiscountPercent,
    order.base_discount_percent
  );

  const slabDiscountPercent = firstMoney(
    override?.slabDiscountPercent,
    override?.slab_discount_percent,
    order.slabDiscountPercent,
    order.slab_discount_percent
  );

  const amountBeforeSlab = firstMoney(
    override?.amountBeforeSlab,
    override?.amount_before_slab,
    order.amountBeforeSlab,
    order.amount_before_slab
  );

  const resolvedBaseDiscountAmount = baseDiscountAmount
    ?? (slabDiscountAmount > 0
      ? Math.max(0, amounts.discountAmount - slabDiscountAmount)
      : amounts.discountAmount);

  return {
    ...amounts,
    baseDiscountAmount: resolvedBaseDiscountAmount,
    slabDiscountAmount,
    hasSlabDiscount: slabDiscountAmount > 0,
    baseDiscountPercent,
    slabDiscountPercent,
    amountBeforeSlab: amountBeforeSlab ?? (slabDiscountAmount > 0 ? Math.max(0, amounts.gross - resolvedBaseDiscountAmount) : undefined),
  };
}

export function withDisplayOrderAmounts<T extends OrderAmountSource>(
  order: T,
  override?: OrderAmountSource
): T & {
  order_amount: string;
  order_discount: string;
  order_discount_amount: string;
  order_net_amount: string;
  grossAmount: number;
  discountAmount: number;
  netPayableAmount: number;
  baseDiscountAmount: number;
  slabDiscountAmount: number;
  hasSlabDiscount: boolean;
  baseDiscountPercent?: number;
  slabDiscountPercent?: number;
  amountBeforeSlab?: number;
  priceSource: "summary_override" | "php";
} {
  const amounts = resolveOrderDiscountBreakdown(order, override);

  return {
    ...order,
    order_amount: String(amounts.gross),
    order_discount: String(amounts.discountAmount),
    order_discount_amount: String(amounts.discountAmount),
    order_net_amount: String(amounts.netPayable),
    grossAmount: amounts.gross,
    discountAmount: amounts.discountAmount,
    netPayableAmount: amounts.netPayable,
    baseDiscountAmount: amounts.baseDiscountAmount,
    slabDiscountAmount: amounts.slabDiscountAmount,
    hasSlabDiscount: amounts.hasSlabDiscount,
    baseDiscountPercent: amounts.baseDiscountPercent,
    slabDiscountPercent: amounts.slabDiscountPercent,
    amountBeforeSlab: amounts.amountBeforeSlab,
    priceSource: override ? "summary_override" : "php",
  };
}
