/**
 * lib/useDrafts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * TanStack React Query hooks for drafts.
 * Caches drafts so navigating between the drafts list and AddOrderForm is
 * near-instant after the first load.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  getDrafts,
  getDraftById,
  saveDraft,
  updateDraft,
  renameDraft,
  deleteDraft,
  getDraftCount,
  type OrderDraft,
  type DraftPayload,
} from "@/lib/drafts";

// ── Query keys ───────────────────────────────────────────────────────────────

export const draftKeys = {
  all:    (dealerId: string) => ["drafts", dealerId] as const,
  detail: (dealerId: string, id: string) => ["drafts", dealerId, id] as const,
  count:  (dealerId: string) => ["drafts", dealerId, "count"] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Fetch all drafts for a dealer (cached for 5 min, stale after 30s) */
export function useDrafts(dealerId: string | undefined) {
  return useQuery({
    queryKey: draftKeys.all(dealerId ?? ""),
    queryFn:  () => getDrafts(dealerId!),
    enabled:  !!dealerId,
    staleTime:    30_000,   // 30 s before refetching in background
    gcTime:       300_000,  // keep in cache 5 min after unmount
  });
}

/** Fetch a single draft by ID (served from cache instantly if prefetched) */
export function useDraft(dealerId: string | undefined, draftId: string | null) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: draftKeys.detail(dealerId ?? "", draftId ?? ""),
    queryFn:  () => getDraftById(draftId!, dealerId!),
    enabled:  !!dealerId && !!draftId,
    staleTime:    30_000,
    gcTime:       300_000,
    // Seed initial data from the list cache if available
    initialData: () => {
      if (!dealerId || !draftId) return undefined;
      const listData = queryClient.getQueryData<OrderDraft[]>(draftKeys.all(dealerId));
      return listData?.find((d) => d.id === draftId) ?? undefined;
    },
  });
}

/** Draft count */
export function useDraftCount(dealerId: string | undefined) {
  return useQuery({
    queryKey: draftKeys.count(dealerId ?? ""),
    queryFn:  () => getDraftCount(dealerId!),
    enabled:  !!dealerId,
    staleTime:    30_000,
    gcTime:       300_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: DraftPayload) => saveDraft(payload),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: draftKeys.all(variables.dealer_id) });
      qc.invalidateQueries({ queryKey: draftKeys.count(variables.dealer_id) });
    },
  });
}

export function useUpdateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      dealerId: string;
      payload: Partial<Omit<DraftPayload, "dealer_id">>;
    }) => updateDraft(vars.id, vars.dealerId, vars.payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: draftKeys.all(vars.dealerId) });
      qc.invalidateQueries({ queryKey: draftKeys.detail(vars.dealerId, vars.id) });
    },
  });
}

export function useRenameDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; dealerId: string; name: string }) =>
      renameDraft(vars.id, vars.dealerId, vars.name),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: draftKeys.all(vars.dealerId) });
      qc.invalidateQueries({ queryKey: draftKeys.detail(vars.dealerId, vars.id) });
    },
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; dealerId: string }) =>
      deleteDraft(vars.id, vars.dealerId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: draftKeys.all(vars.dealerId) });
      qc.invalidateQueries({ queryKey: draftKeys.count(vars.dealerId) });
    },
  });
}

// ── Prefetch helpers (for hover / navigation) ────────────────────────────────

/** Call on the drafts list page to warm the cache for a specific draft */
export function prefetchDraft(
  qc: QueryClient,
  dealerId: string,
  draftId: string
) {
  return qc.prefetchQuery({
    queryKey: draftKeys.detail(dealerId, draftId),
    queryFn:  () => getDraftById(draftId, dealerId),
    staleTime: 30_000,
  });
}

/** Prefetch the full drafts list (useful on sidebar / dashboard) */
export function prefetchDrafts(qc: QueryClient, dealerId: string) {
  return qc.prefetchQuery({
    queryKey: draftKeys.all(dealerId),
    queryFn:  () => getDrafts(dealerId),
    staleTime: 30_000,
  });
}
