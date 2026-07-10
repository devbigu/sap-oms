export type DealerStatus = "active" | "inactive";

export type DealerStatusDocument = {
  dealerId: string;
  status: DealerStatus;
  updatedAt?: string;
  updatedBy?: string;
};

export type DealerStatusPayload = {
  dealerId: string;
  status: DealerStatus;
  updatedBy?: string;
};

type DealerStatusApiResponse = {
  success: boolean;
  data?: DealerStatusDocument | DealerStatusDocument[];
  message?: string;
};

const DEALER_STATUS_ENDPOINT = "/api/dealer-status";

export function normalizeDealerStatus(value: unknown, fallback: DealerStatus = "active"): DealerStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "active" || normalized === "1") return "active";
  if (normalized === "inactive" || normalized === "0") return "inactive";
  return fallback;
}

export function dealerStatusLabel(status: DealerStatus): string {
  return status === "active" ? "Active" : "Inactive";
}

export function dealerStatusBadge(status: DealerStatus) {
  return status === "active"
    ? { bg: "bg-emerald-50", text: "text-emerald-700", label: "Active" }
    : { bg: "bg-red-50", text: "text-red-600", label: "Inactive" };
}

export function isInactiveDealerStatus(status: unknown): boolean {
  return normalizeDealerStatus(status) === "inactive";
}

function extractMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Request failed";
  const record = payload as Record<string, unknown>;
  const message = record.message ?? record.msg;
  return typeof message === "string" && message.trim() ? message : "Request failed";
}

export async function fetchDealerStatus(dealerId: string): Promise<DealerStatus> {
  const res = await fetch(`${DEALER_STATUS_ENDPOINT}?dealer_id=${encodeURIComponent(dealerId)}`, {
    cache: "no-store",
  });

  const json = (await res.json()) as DealerStatusApiResponse;
  if (!res.ok || !json.success) {
    throw new Error(extractMessage(json));
  }

  if (Array.isArray(json.data)) {
    const row = json.data.find((item) => String(item.dealerId) === String(dealerId));
    return normalizeDealerStatus(row?.status);
  }

  return normalizeDealerStatus(json.data?.status);
}

export async function fetchDealerStatusOverrides(): Promise<DealerStatusDocument[]> {
  const res = await fetch(DEALER_STATUS_ENDPOINT, { cache: "no-store" });
  const json = (await res.json()) as DealerStatusApiResponse;

  if (!res.ok || !json.success) {
    throw new Error(extractMessage(json));
  }

  return Array.isArray(json.data) ? json.data.map((item) => ({
    ...item,
    status: normalizeDealerStatus(item.status),
  })) : [];
}

export async function saveDealerStatus(payload: DealerStatusPayload): Promise<DealerStatusDocument> {
  const res = await fetch(DEALER_STATUS_ENDPOINT, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as DealerStatusApiResponse;
  if (!res.ok || !json.success || Array.isArray(json.data) || !json.data) {
    throw new Error(extractMessage(json));
  }

  return {
    ...json.data,
    status: normalizeDealerStatus(json.data.status),
  };
}
