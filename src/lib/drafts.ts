/**
 * lib/drafts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Named-draft CRUD helpers backed by MongoDB via /api/drafts.
 * Dealer isolation is enforced by always sending dealer_id.
 * Function signatures are identical to the former Supabase version so that
 * AddOrderForm needs no changes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BASE = "/api/drafts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DraftProductRow = {
  key: number;
  productname: string;
  displayName: string;
  variantCode: string;
  producQuanity: number;
  price: number;
  packSize: number;
};

export type OrderDraft = {
  id: string;
  dealer_id: string;
  name: string;
  shipto: string | null;
  refno: string | null;
  coupon_code: string | null;
  coupon_pct: number | null;
  rows: DraftProductRow[];
  created_at: string;
  updated_at: string;
};

export type DraftPayload = {
  dealer_id: string;
  name: string;
  shipto?: string;
  refno?: string;
  coupon_code?: string | null;
  coupon_pct?: number | null;
  rows: DraftProductRow[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(path: string, init?: RequestInit) {
  const res  = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? "API error");
  return json;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getDrafts(dealerId: string): Promise<OrderDraft[]> {
  const json = await apiFetch(`${BASE}?dealer_id=${encodeURIComponent(dealerId)}`);
  return json.data ?? [];
}

export async function getDraftById(id: string, dealerId: string): Promise<OrderDraft | null> {
  try {
    const json = await apiFetch(`${BASE}/${id}?dealer_id=${encodeURIComponent(dealerId)}`);
    return json.data ?? null;
  } catch {
    return null;
  }
}

export async function saveDraft(payload: DraftPayload): Promise<OrderDraft> {
  const json = await apiFetch(BASE, { method: "POST", body: JSON.stringify(payload) });
  return json.data as OrderDraft;
}

export async function updateDraft(
  id: string,
  dealerId: string,
  payload: Partial<Omit<DraftPayload, "dealer_id">>
): Promise<OrderDraft> {
  const json = await apiFetch(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify({ dealer_id: dealerId, ...payload }),
  });
  return json.data as OrderDraft;
}

export async function renameDraft(id: string, dealerId: string, name: string): Promise<void> {
  await apiFetch(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify({ dealer_id: dealerId, name }),
  });
}

export async function deleteDraft(id: string, dealerId: string): Promise<void> {
  await apiFetch(`${BASE}/${id}?dealer_id=${encodeURIComponent(dealerId)}`, { method: "DELETE" });
}

export async function getDraftCount(dealerId: string): Promise<number> {
  const json = await apiFetch(`${BASE}?dealer_id=${encodeURIComponent(dealerId)}&count=1`);
  return json.count ?? 0;
}
