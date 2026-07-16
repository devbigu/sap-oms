import { filterOrdersForActor, getAssignedDealerIds } from "@/lib/staffOrderScope.js";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";

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
  const response = await fetch(`${BACKEND_URL}/staffDealers?id=${encodeURIComponent(staffId)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`staffDealers failed with ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  // staffDealers is already scoped by the backend. The assignment-field check is
  // retained when metadata is present, while Dealer_Id remains the stable key.
  const explicitlyAssigned = getAssignedDealerIds(rows, staffId);
  if (explicitlyAssigned.length > 0) return explicitlyAssigned;
  return rows.map((row: Record<string, unknown>) => safeText(row.Dealer_Id)).filter(Boolean);
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
