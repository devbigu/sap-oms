import { filterOrdersForActor, getAssignedDealerIds } from "@/lib/staffOrderScope.js";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const ASSIGNMENT_CACHE_TTL_MS = 60_000;

type AssignmentCacheEntry = {
  expiresAt: number;
  value?: string[];
  request?: Promise<string[]>;
};

const scopeGlobal = globalThis as typeof globalThis & {
  __staffAssignmentCache?: Map<string, AssignmentCacheEntry>;
};
const assignmentCache = scopeGlobal.__staffAssignmentCache
  ?? (scopeGlobal.__staffAssignmentCache = new Map());

export type OrderActor = {
  role: "admin" | "accountant" | "staff" | "dealer";
  actorId: string;
};

function safeText(value: unknown, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

export function parseOrderActor(input: {
  role?: unknown;
  actorId?: unknown;
}): OrderActor | null {
  const role = safeText(input.role, 20).toLowerCase();
  const actorId = safeText(input.actorId);
  if (!["admin", "accountant", "staff", "dealer"].includes(role)) return null;
  if ((role === "staff" || role === "dealer") && !actorId) return null;
  return { role: role as OrderActor["role"], actorId };
}

export async function fetchStaffAssignedDealerIds(staffId: string): Promise<string[]> {
  if (!staffId) return [];
  const cached = assignmentCache.get(staffId);
  if (cached?.value && cached.expiresAt > Date.now()) return [...cached.value];
  if (cached?.request) return [...await cached.request];

  const request = (async () => {
    const response = await fetch(`${BACKEND_URL}/staffDealers?id=${encodeURIComponent(staffId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`staffDealers failed with ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];

    // staffDealers is already scoped by the backend. The assignment-field check is
    // retained when metadata is present, while Dealer_Id remains the stable key.
    const explicitlyAssigned = getAssignedDealerIds(rows, staffId);
    const value = explicitlyAssigned.length > 0
      ? explicitlyAssigned
      : rows.map((row: Record<string, unknown>) => safeText(row.Dealer_Id)).filter(Boolean);
    assignmentCache.set(staffId, { value, expiresAt: Date.now() + ASSIGNMENT_CACHE_TTL_MS });
    return value;
  })();

  assignmentCache.set(staffId, { request, expiresAt: 0 });
  try {
    return [...await request];
  } catch (error) {
    if (assignmentCache.get(staffId)?.request === request) assignmentCache.delete(staffId);
    throw error;
  }
}

export function invalidateStaffAssignmentCache(staffId?: string) {
  if (staffId) assignmentCache.delete(staffId);
  else assignmentCache.clear();
}

export async function scopeOrdersForActor<T extends Record<string, unknown>>(
  orders: T[],
  actor: OrderActor
): Promise<T[]> {
  const assignedDealerIds = actor.role === "staff"
    ? await fetchStaffAssignedDealerIds(actor.actorId)
    : [];
  return filterOrdersForActor({ ...actor, orders, assignedDealerIds });
}
