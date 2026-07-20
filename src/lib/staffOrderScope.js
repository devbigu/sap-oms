export const STAFF_ORDER_SCOPE_VERSION = "assigned-dealers-v1";

export function normalizeScopeId(value) {
  return String(value ?? "").trim();
}

export function splitScopeIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(new Set(values.flatMap((entry) =>
    String(entry ?? "").split(",").map(normalizeScopeId).filter(Boolean)
  )));
}

export function resolveOrderDealerId(order) {
  return normalizeScopeId(order?.order_dealer ?? order?.orderdata_dealerid ?? order?.Dealer_Id);
}

export function resolveDealerId(dealer) {
  return normalizeScopeId(dealer?.Dealer_Id);
}

export function getDealerAssignedStaffIds(dealer) {
  return splitScopeIds([
    dealer?.assignedstaff,
    dealer?.assignedStaff,
    dealer?.staff_id,
  ]);
}

export function getAssignedDealerIds(dealers, staffId) {
  const actorId = normalizeScopeId(staffId);
  if (!actorId || !Array.isArray(dealers)) return [];

  return Array.from(new Set(dealers
    .filter((dealer) => getDealerAssignedStaffIds(dealer).includes(actorId))
    .map(resolveDealerId)
    .filter(Boolean)));
}

export function filterOrdersForActor(input) {
  const role = normalizeScopeId(input?.role).toLowerCase();
  const actorId = normalizeScopeId(input?.actorId);
  const scopedOrders = Array.isArray(input?.orders) ? input.orders : [];

  if (role === "admin" || role === "accountant") return scopedOrders;

  if (role === "dealer") {
    if (!actorId) return [];
    return scopedOrders.filter((order) => resolveOrderDealerId(order) === actorId);
  }

  if (role === "staff") {
    if (!actorId) return [];
    const allowed = new Set(splitScopeIds(input?.assignedDealerIds));
    if (allowed.size === 0) return [];
    return scopedOrders.filter((order) => allowed.has(resolveOrderDealerId(order)));
  }

  return [];
}

export function canActorAccessOrder(order, input) {
  return filterOrdersForActor({ ...input, orders: [order] }).length === 1;
}
