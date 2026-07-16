import { filterOrdersForActor } from "@/lib/staffOrderScope.js";

export type DealerOrderRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderDate(order: DealerOrderRow) {
  return text(order.order_date ?? order.orderDate);
}

function statusText(order: DealerOrderRow) {
  return [order.order_status, order.status, order.mtstatus]
    .map((value) => text(value).toLowerCase().replace(/[\s_-]/g, ""))
    .filter(Boolean);
}

export function isDealerPendingOrder(order: DealerOrderRow) {
  const statuses = statusText(order);
  return text(order.accept_order) === "0" || statuses.some((status) => status === "0" || status === "pending" || status === "awaiting");
}

export function isDealerCompletedOrder(order: DealerOrderRow) {
  const statuses = statusText(order);
  return statuses.some((status) => status === "2" || status === "4" || status === "completed" || status === "shipped" || status === "successful");
}

export function buildDealerOrderView(orders: DealerOrderRow[], dealerId: unknown) {
  const scopedOrders = filterOrdersForActor({ role: "dealer", actorId: dealerId, orders });
  const pendingOrders = scopedOrders.filter(isDealerPendingOrder);
  const completedOrders = scopedOrders.filter(isDealerCompletedOrder);
  const acceptedOrders = scopedOrders.filter((order) => text(order.accept_order) === "1");
  const declinedOrders = scopedOrders.filter((order) => {
    const statuses = statusText(order);
    return text(order.del_status) === "1" || statuses.some((status) => /reject|declin|cancel|delete/.test(status));
  });
  const recentOrders = [...scopedOrders]
    .sort((left, right) => orderDate(right).localeCompare(orderDate(left)))
    .slice(0, 4);
  const monthly = new Map<string, { orders: number; value: number }>();

  for (const order of scopedOrders) {
    const month = orderDate(order).slice(0, 7);
    if (!month) continue;
    const current = monthly.get(month) ?? { orders: 0, value: 0 };
    current.orders += 1;
    current.value += number(order.order_net_amount ?? order.netPayableAmount ?? order.order_amount ?? order.total);
    monthly.set(month, current);
  }

  return {
    orders: scopedOrders,
    pendingOrders,
    completedOrders,
    acceptedOrders,
    declinedOrders,
    recentOrders,
    totalCount: scopedOrders.length,
    pendingCount: pendingOrders.length,
    completedCount: completedOrders.length,
    acceptedCount: acceptedOrders.length,
    declinedCount: declinedOrders.length,
    totalValue: scopedOrders.reduce(
      (sum, order) => sum + number(order.order_net_amount ?? order.netPayableAmount ?? order.order_amount ?? order.total),
      0,
    ),
    monthly: Array.from(monthly.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, totals]) => ({ month, totalorders: totals.orders, totalvalue: totals.value })),
  };
}
