// Lightweight auth helpers for the accountant JWT flow

export const ACCOUNTANT_API =
  process.env.NEXT_PUBLIC_ACCOUNTANT_API_URL || "/api";

// ── Token helpers ─────────────────────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("accountant_token");
}

export function clearAccountantSession() {
  localStorage.removeItem("accountant_token");
  localStorage.removeItem("AccountantData");
  localStorage.removeItem("roletype");
}

// ── JWT expiry check (client-side, no verify) ─────────────────────────────────

export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  return !isTokenExpired(token);
}

// ── Authenticated fetch wrapper ───────────────────────────────────────────────

export async function accountantFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  return fetch(`${ACCOUNTANT_API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

// ── Typed API calls ───────────────────────────────────────────────────────────

export async function fetchAllAccountants() {
  const res = await accountantFetch("/accountants");
  if (!res.ok) throw new Error("Failed to fetch accountants");
  const json = await res.json();
  return json.data;
}

export async function fetchAccountantById(id: string) {
  const res = await accountantFetch(`/accountants/${id}`);
  if (!res.ok) throw new Error("Accountant not found");
  const json = await res.json();
  return json.data;
}

export async function createAccountant(body: {
  name: string;
  email: string;
  password: string;
  phone: string;
}) {
  const res = await accountantFetch("/accountants", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Create failed");
  return json.data;
}

export async function updateAccountant(
  id: string,
  body: Partial<{ name: string; email: string; phone: string; role: string }>
) {
  const res = await accountantFetch(`/accountants/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Update failed");
  return json.data;
}

export async function deleteAccountant(id: string) {
  const res = await accountantFetch(`/accountants/${id}`, { method: "DELETE" });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Delete failed");
}

export async function fetchAllOrders() {
  const res = await accountantFetch("/orders");
  if (!res.ok) throw new Error("Failed to fetch orders");
  const json = await res.json();
  return json.data;
}

export async function fetchNewOrders() {
  const res = await accountantFetch("/orders/new");
  if (!res.ok) throw new Error("Failed to fetch new orders");
  const json = await res.json();
  return json.data;
}
