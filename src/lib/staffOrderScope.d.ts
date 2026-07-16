export const STAFF_ORDER_SCOPE_VERSION: string;
export function normalizeScopeId(value: unknown): string;
export function splitScopeIds(value: unknown): string[];
export function resolveOrderDealerId(order: Record<string, unknown>): string;
export function resolveDealerId(dealer: Record<string, unknown>): string;
export function getDealerAssignedStaffIds(dealer: Record<string, unknown>): string[];
export function getAssignedDealerIds(dealers: Record<string, unknown>[], staffId: unknown): string[];
export function filterOrdersForActor<T extends Record<string, unknown>>(input: {
  role: unknown;
  actorId?: unknown;
  orders: T[];
  assignedDealerIds?: unknown;
}): T[];
export function canActorAccessOrder(order: Record<string, unknown>, input: {
  role: unknown;
  actorId?: unknown;
  assignedDealerIds?: unknown;
}): boolean;
