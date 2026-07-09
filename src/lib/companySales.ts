import { resolveOrderAmounts, type OrderAmountSource } from "@/lib/orderAmounts";

export type MonthlySeries = {
  month: string[];
  total: string[];
};

export type SalesOrder = OrderAmountSource & {
  Dealer_Name?: string;
  order_dealer?: string | number;
  order_date?: string;
  orderDate?: string;
};

export type DistributorSalesRow = {
  dealerKey: string;
  dealerName: string;
  orderCount: number;
  grossSales: number;
  discount: number;
  netSales: number;
};

export function formatRupee(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
}

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function monthCandidates(date: Date) {
  const monthNumber = date.getMonth() + 1;
  const full = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
  const short = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
  return [
    full,
    short,
    String(monthNumber),
    String(monthNumber).padStart(2, "0"),
    `${full} ${date.getFullYear()}`,
    `${short} ${date.getFullYear()}`,
    `${date.getFullYear()}-${String(monthNumber).padStart(2, "0")}`,
  ].map(normalizeToken);
}

export function resolveCurrentMonthTotal(series?: MonthlySeries, date = new Date()) {
  if (!series?.month?.length || !series?.total?.length) return 0;

  const candidates = monthCandidates(date);
  const labels = series.month.map(label => normalizeToken(String(label ?? "")));

  const matchIndex = labels.findIndex(label =>
    candidates.some(candidate => label.includes(candidate) || candidate.includes(label))
  );

  const fallbackIndex = Math.min(
    Math.max(date.getMonth(), 0),
    Math.max(series.total.length - 1, 0)
  );
  const index = matchIndex >= 0 ? matchIndex : fallbackIndex;
  return Number(series.total[index] ?? 0) || 0;
}

export function getOrderDate(order: SalesOrder) {
  return String(order.orderDate || order.order_date || "").slice(0, 10);
}

export function groupOrdersByDistributor(orders: SalesOrder[]) {
  const grouped = new Map<string, DistributorSalesRow>();

  for (const order of orders) {
    const dealerName = String(order.Dealer_Name || "Unknown Distributor").trim() || "Unknown Distributor";
    const dealerKey = String(order.order_dealer || dealerName).trim() || dealerName;
    const key = `${dealerKey}::${dealerName}`;
    const amounts = resolveOrderAmounts(order);

    const existing = grouped.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.grossSales += amounts.gross;
      existing.discount += amounts.discountAmount;
      existing.netSales += amounts.netPayable;
    } else {
      grouped.set(key, {
        dealerKey,
        dealerName,
        orderCount: 1,
        grossSales: amounts.gross,
        discount: amounts.discountAmount,
        netSales: amounts.netPayable,
      });
    }
  }

  return Array.from(grouped.values());
}
