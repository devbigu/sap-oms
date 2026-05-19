"use client";

/**
 * app/drafts/page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows all saved order drafts for the logged-in dealer.
 * Dealer isolation: every query is scoped to UserData.Dealer_Id.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast, ToastContainer } from "react-toastify";
import moment from "moment";
import { type OrderDraft } from "@/lib/drafts";
import {
  useDrafts,
  useDeleteDraft,
  useRenameDraft,
  prefetchDraft,
} from "@/lib/useDrafts";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function draftTotal(draft: OrderDraft): number {
  const disc = draft.coupon_pct ?? 0;
  return draft.rows.reduce((acc, row) => {
    const list = row.producQuanity * row.price;
    return acc + list - Math.round(list * (disc / 100));
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DraftsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<any>(null);

  // inline rename
  const [renamingId,  setRenamingId]  = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  // ── auth ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const stored   = localStorage.getItem("UserData");
    const loggedIn = localStorage.getItem("status");
    if (!stored || JSON.parse(loggedIn ?? "false") !== true) {
      router.push("/login");
      return;
    }
    setUser(JSON.parse(stored));
  }, []);

  // ── React Query hooks ──────────────────────────────────────────────────
  const { data: drafts = [], isLoading: loading } = useDrafts(user?.Dealer_Id);
  const deleteMutation = useDeleteDraft();
  const renameMutation = useRenameDraft();

  // ── delete ──────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    deleteMutation.mutate(
      { id, dealerId: user.Dealer_Id },
      {
        onSuccess: () => toast.success("Draft deleted."),
        onError:   () => toast.error("Could not delete draft."),
      }
    );
  };

  // ── rename ──────────────────────────────────────────────────────────────
  const startRename = (draft: OrderDraft) => {
    setRenamingId(draft.id);
    setRenameValue(draft.name);
    setTimeout(() => renameRef.current?.focus(), 50);
  };

  const commitRename = async (id: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    renameMutation.mutate(
      { id, dealerId: user.Dealer_Id, name: trimmed },
      {
        onError:   () => toast.error("Rename failed."),
        onSettled: () => setRenamingId(null),
      }
    );
  };

  // ── open draft in order page ────────────────────────────────────────────
  const openDraft = (id: string) => {
    router.push(`/dashboard/dealer/AddOrderForm?draft=${id}`);
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (!user) return null;

  const newLocal = <h1 onClick={() => router.back()} className="cursor-pointer">back</h1>;
  return (
    <>
      <ToastContainer position="top-right" autoClose={4000} />

      <div className="p-7 max-w-[1100px] mx-auto font-[family-name:var(--font-dm-sans)]">

        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Saved Drafts</h1>
            {newLocal}
            <p className="text-sm text-gray-400 mt-1">
              {user.Dealer_Name} · {drafts.length} draft{drafts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => router.push("/dashboard/dealer/AddOrderForm")}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-[13.5px] font-semibold transition-all cursor-pointer border-none"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            New Order
          </button>
        </div>

        {/* Empty state */}
        {!loading && drafts.length === 0 && (
          <div className="bg-white border border-gray-200 border-dashed rounded-2xl p-16 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="11" x2="12" y2="17"/>
                <line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
            </div>
            <p className="text-[15px] font-semibold text-gray-700 mb-1">No drafts yet</p>
            <p className="text-[13px] text-gray-400 max-w-xs">
              Start building an order and hit &ldquo;Save as Draft&rdquo; to pick it back up later.
            </p>
            <button
              onClick={() => router.push("/dashboard/dealer/AddOrderForm")}
              className="mt-5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[13.5px] font-semibold transition-colors cursor-pointer border-none"
            >
              Start an Order
            </button>
          </div>
        )}

        {/* Skeleton loader */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 animate-pulse flex gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 bg-gray-100 rounded-lg" />
                  <div className="h-3 w-72 bg-gray-50 rounded-lg" />
                </div>
                <div className="h-4 w-24 bg-gray-100 rounded-lg self-center" />
              </div>
            ))}
          </div>
        )}

        {/* Draft cards */}
        {!loading && drafts.length > 0 && (
          <div className="space-y-3">
            {drafts.map((draft) => {
              const total      = draftTotal(draft);
              const productQty = draft.rows.filter((r) => r.productname).length;
              const isDeleting = deleteMutation.isPending && deleteMutation.variables?.id === draft.id;
              const isRenaming = renamingId === draft.id;

              return (
                <div
                  key={draft.id}
                  className="group bg-white border border-gray-200 hover:border-gray-300 rounded-2xl p-5 transition-all hover:shadow-sm"
                >
                  <div className="flex items-start gap-4">

                    {/* Icon */}
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="8" y1="13" x2="16" y2="13"/>
                        <line x1="8" y1="17" x2="16" y2="17"/>
                        <line x1="8" y1="9" x2="10" y2="9"/>
                      </svg>
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">

                      {/* Name (editable inline) */}
                      {isRenaming ? (
                        <input
                          ref={renameRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(draft.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")  commitRename(draft.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          className="text-[14px] font-semibold text-gray-900 border-b-2 border-indigo-400 outline-none bg-transparent w-full max-w-xs"
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <p className="text-[14px] font-semibold text-gray-900 truncate">
                            {draft.name}
                          </p>
                          <button
                            onClick={() => startRename(draft)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-gray-500 cursor-pointer"
                            title="Rename draft"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                        </div>
                      )}

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                        <span className="text-[11.5px] text-gray-400 font-mono">
                          {moment(draft.updated_at).fromNow()}
                        </span>
                        <span className="text-gray-200 text-xs">·</span>
                        <span className="text-[11.5px] text-gray-400">
                          {productQty} product{productQty !== 1 ? "s" : ""}
                        </span>
                        {draft.shipto && (
                          <>
                            <span className="text-gray-200 text-xs">·</span>
                            <span className="text-[11.5px] text-gray-400 truncate max-w-[200px]">
                              Ship: {draft.shipto}
                            </span>
                          </>
                        )}
                        {draft.coupon_code && (
                          <>
                            <span className="text-gray-200 text-xs">·</span>
                            <span className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded-full font-mono">
                              {draft.coupon_code} · {draft.coupon_pct}%
                            </span>
                          </>
                        )}
                        {draft.refno && (
                          <>
                            <span className="text-gray-200 text-xs">·</span>
                            <span className="text-[11.5px] text-gray-400 font-mono">
                              Ref: {draft.refno}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Product chips (first 4) */}
                      {draft.rows.filter(r => r.productname).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {draft.rows
                            .filter((r) => r.productname)
                            .slice(0, 4)
                            .map((r) => (
                              <span
                                key={r.key}
                                className="inline-flex items-center px-2 py-0.5 bg-gray-50 border border-gray-200 text-gray-500 rounded-lg text-[10.5px] font-mono"
                              >
                                {r.variantCode || r.productname} × {r.producQuanity}
                              </span>
                            ))}
                          {draft.rows.filter((r) => r.productname).length > 4 && (
                            <span className="inline-flex items-center px-2 py-0.5 bg-gray-50 border border-gray-200 text-gray-400 rounded-lg text-[10.5px]">
                              +{draft.rows.filter((r) => r.productname).length - 4} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right side: total + actions */}
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <p className="font-mono text-[16px] font-bold text-gray-900">
                        {total > 0 ? fmt(total) : "—"}
                      </p>

                      <div className="flex items-center gap-2">
                        {/* Open / Continue — prefetch on hover */}
                        <button
                          onClick={() => openDraft(draft.id)}
                          onMouseEnter={() => prefetchDraft(queryClient, user.Dealer_Id, draft.id)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[12px] font-semibold transition-colors cursor-pointer border-none"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M5 12h14M12 5l7 7-7 7"/>
                          </svg>
                          Continue
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(draft.id)}
                          disabled={isDeleting}
                          title="Delete draft"
                          className="w-[30px] h-[30px] flex items-center justify-center rounded-xl border border-red-100 text-red-400 hover:bg-red-50 hover:border-red-200 transition-colors cursor-pointer bg-transparent disabled:opacity-40"
                        >
                          {isDeleting ? (
                            <div className="w-3 h-3 border border-red-300 border-t-red-500 rounded-full animate-spin" />
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6l-1 14H6L5 6m5 0V4h4v2"/>
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}