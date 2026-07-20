import { scanScopedOrders, type OrdersActor } from "@/lib/orderPagination";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const UPSTREAM_PAGE_SIZE = 200;
const MAX_UPSTREAM_PAGES = 100;
const UPSTREAM_TIMEOUT_MS = 20_000;

export const ORDER_HEADER_SOURCES = new Set([
  "orderpegination",
  "orderhispegination",
  "orderpeginationnew",
  "staffOrderrPagination",
  "Orderstspegination",
]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function upstreamActorIds(input: {
  source: string;
  actor: OrdersActor;
  assignedDealerIds: Array<string | number>;
}) {
  if (input.actor.role === "staff") {
    if (input.source === "orderhispegination") return input.assignedDealerIds.map(text).filter(Boolean);
    if (input.source === "staffOrderrPagination" || input.source === "Orderstspegination") return [input.actor.actorId];
    return [""];
  }
  return [input.actor.actorId];
}

export async function loadOrderHeaders(input: {
  source: string;
  actor: OrdersActor;
  assignedDealerIds?: Array<string | number>;
}) {
  if (!ORDER_HEADER_SOURCES.has(input.source)) throw new Error(`Unsupported order header source: ${input.source}`);
  const assignedDealerIds = input.assignedDealerIds ?? [];
  let upstreamHeaders = 0;
  const scan = await scanScopedOrders<Record<string, unknown>>({
    actor: input.actor,
    assignedDealerIds,
    upstreamActorIds: upstreamActorIds({ ...input, assignedDealerIds }),
    upstreamPageSize: UPSTREAM_PAGE_SIZE,
    maxUpstreamPages: MAX_UPSTREAM_PAGES,
    fetchPage: async (upstreamActorId, page, pageSize) => {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize), search: "" });
      if (upstreamActorId) params.set("id", upstreamActorId);
      const response = await fetch(`${BACKEND_URL}/${input.source}?${params.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`${input.source} failed with ${response.status}`);
      const payload = await response.json();
      const rows: Record<string, unknown>[] = Array.isArray(payload?.data)
        ? payload.data.filter((row: unknown): row is Record<string, unknown> => !!row && typeof row === "object")
        : [];
      upstreamHeaders += rows.length;
      return {
        rows,
        lastPage: Number(payload?.last_page ?? payload?.lastPage ?? 0),
        total: Number(payload?.count ?? payload?.total ?? payload?.recordsTotal ?? 0),
      };
    },
  });

  return {
    rows: scan.rows,
    truncated: scan.truncated,
    totalIsExact: scan.totalIsExact,
    diagnostics: { upstreamCalls: scan.pageCalls.length, upstreamHeaders },
  };
}
