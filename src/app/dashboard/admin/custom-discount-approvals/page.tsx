"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ApprovalStatus = "pending" | "approved" | "rejected";

type ApprovalProduct = {
  productname?: string;
  displayName?: string;
  variantCode?: string;
  quantity?: number;
  price?: number;
  packSize?: number;
  rowSubtotal?: string;
};

type ApprovalRequest = {
  id: string;
  dealerId: string;
  dealerName: string;
  dealerCode?: string;
  dealerEmail?: string;
  dealerPhone?: string;
  requestedDiscountPercent: number;
  currentDiscountPercent: number;
  subtotal: number;
  currentDiscountAmount: number;
  requestedDiscountAmount: number;
  currentFinalPayable: number;
  requestedFinalPayable: number;
  discountScope?: "order" | "product";
  targetProduct?: {
    productKey?: string;
    productname?: string;
    displayName?: string;
    variantCode?: string;
  } | null;
  shipto?: string;
  refno?: string;
  orderNote?: string;
  products: ApprovalProduct[];
  status: ApprovalStatus;
  adminNote?: string;
  reviewedBy?: string;
  reviewedAt?: string | null;
  allowReorder?: boolean;
  reorderCount?: number;
  lastReorderedAt?: string | null;
  lastReorderedOrderId?: string;
  createdAt: string;
};

function money(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusBadge(status: ApprovalStatus) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function statusLabel(status: ApprovalStatus) {
  return status === "rejected" ? "Disapproved" : status[0].toUpperCase() + status.slice(1);
}

function resolveAdminName() {
  if (typeof window === "undefined") return "Admin";
  try {
    const raw = localStorage.getItem("AdminData") || localStorage.getItem("admin") || localStorage.getItem("UserData") || "{}";
    const parsed = JSON.parse(raw);
    return parsed.name || parsed.username || parsed.staff_name || parsed.email || "Admin";
  } catch {
    return "Admin";
  }
}

export default function CustomDiscountApprovalsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | ApprovalStatus>("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<string | null>(null);

  const loadRequests = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/custom-discount-requests?limit=200");
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Failed to load approvals");
      setRequests(json.data ?? []);
      const noteState: Record<string, string> = {};
      (json.data ?? []).forEach((r: ApprovalRequest) => {
        noteState[r.id] = r.adminNote ?? "";
      });
      setNotes(noteState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRequests(); }, []);

  const filtered = useMemo(() => (
    filter === "all" ? requests : requests.filter((r) => r.status === filter)
  ), [filter, requests]);

  const stats = useMemo(() => ({
    all: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  }), [requests]);

  const decide = async (request: ApprovalRequest, status: "approved" | "rejected") => {
    setUpdating(request.id);
    try {
      const res = await fetch(`/api/custom-discount-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          adminNote: notes[request.id] ?? "",
          reviewedBy: resolveAdminName(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Update failed");
      setRequests((prev) => prev.map((r) => r.id === request.id ? json.data : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update approval");
    } finally {
      setUpdating(null);
    }
  };

  const toggleReorder = async (request: ApprovalRequest) => {
    const allowReorder = !request.allowReorder;
    setUpdating(request.id);
    try {
      const res = await fetch(`/api/custom-discount-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowReorder }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Could not update reorder permission");
      setRequests((prev) => prev.map((r) => r.id === request.id ? json.data : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update reorder permission");
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-6" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <div className="mx-auto max-w-[1400px] space-y-5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button
              onClick={() => router.back()}
              className="mb-3 inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-100"
            >
              Back
            </button>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Discount Approvals</h1>
            <p className="mt-1 text-sm text-gray-500">Review dealer custom discount requests with their order snapshot.</p>
          </div>

          <button
            onClick={loadRequests}
            className="w-fit rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { key: "all", label: "All", value: stats.all },
            { key: "pending", label: "Pending", value: stats.pending },
            { key: "approved", label: "Approved", value: stats.approved },
            { key: "rejected", label: "Disapproved", value: stats.rejected },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key as "all" | ApprovalStatus)}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                filter === item.key ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{item.label}</p>
              <p className="mt-1 font-mono text-xl font-bold text-gray-900">{item.value}</p>
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
            Loading approvals...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
            No discount requests found.
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((request) => (
              <div key={request.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[16px] font-bold text-gray-900">{request.dealerName || "Dealer"}</h2>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusBadge(request.status)}`}>
                        {statusLabel(request.status)}
                      </span>
                      <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                        {(request.discountScope ?? "order") === "product" ? "Product discount" : "Order discount"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-500">
                      <span>ID: {request.dealerId}</span>
                      {request.dealerCode && <span>Code: {request.dealerCode}</span>}
                      {request.dealerPhone && <span>{request.dealerPhone}</span>}
                      {request.dealerEmail && <span>{request.dealerEmail}</span>}
                    </div>
                    <p className="mt-2 text-[12px] text-gray-400">
                      Requested {request.createdAt ? new Date(request.createdAt).toLocaleString("en-IN") : ""}
                    </p>
                    {(request.discountScope ?? "order") === "product" && (
                      <p className="mt-2 text-[12px] font-semibold text-indigo-700">
                        Applies to: {request.targetProduct?.displayName || request.targetProduct?.variantCode || "Selected product"}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-gray-200 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Current</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{request.currentDiscountPercent}%</p>
                    </div>
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Asked</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-indigo-700">{request.requestedDiscountPercent}%</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Subtotal</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{money(request.subtotal)}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Requested Net</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-emerald-700">{money(request.requestedFinalPayable)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_340px]">
                  <div className="space-y-3">
                    <div className="overflow-hidden rounded-xl border border-gray-200">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            {["Cat. No.", "Product", "packs", "Pieces per pack", "Price"].map((h) => (
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(request.products || []).map((product, idx) => (
                            <tr key={`${product.productname}-${idx}`}>
                              <td className="px-3 py-2 font-mono text-[12px] font-bold text-amber-700">{product.variantCode || product.productname || "-"}</td>
                              <td className="px-3 py-2 text-[12px] font-semibold text-gray-900">{product.displayName || product.productname || "-"}</td>
                              <td className="px-3 py-2 font-mono text-[12px] text-gray-700">{product.quantity ?? "-"}</td>
                              <td className="px-3 py-2 font-mono text-[12px] text-gray-700">{product.packSize ?? "-"}</td>
                              <td className="px-3 py-2 font-mono text-[12px] text-gray-700">{product.price ?? "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Ship To</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.shipto || "-"}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Order Note</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.orderNote || "-"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Admin Note</label>
                    <textarea
                      value={notes[request.id] ?? ""}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [request.id]: e.target.value }))}
                      rows={5}
                      disabled={request.status !== "pending" || updating === request.id}
                      placeholder="Add approval or disapproval note..."
                      className="mt-2 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-100 disabled:text-gray-500"
                    />
                    {request.status === "pending" ? (
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => decide(request, "approved")}
                          disabled={updating === request.id}
                          className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {updating === request.id ? "Saving..." : "Approve"}
                        </button>
                        <button
                          onClick={() => decide(request, "rejected")}
                          disabled={updating === request.id}
                          className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Disapprove
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="mt-3 text-[12px] text-gray-500">
                          Reviewed by {request.reviewedBy || "Admin"} {request.reviewedAt ? `on ${new Date(request.reviewedAt).toLocaleString("en-IN")}` : ""}
                        </p>
                        {request.status === "approved" && (
                          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
                            <span className="text-[11px] text-gray-500">
                              {(request.reorderCount || 0) > 0
                                ? `Reordered ${request.reorderCount}x${request.lastReorderedAt ? ` - Last: ${new Date(request.lastReorderedAt).toLocaleString("en-IN")}` : ""}`
                                : "Not yet reordered"}
                            </span>
                            <label className="inline-flex items-center gap-2">
                              <span className="text-[11px] font-medium text-gray-600">Allow Reorder</span>
                              <button
                                type="button"
                                onClick={() => toggleReorder(request)}
                                disabled={updating === request.id}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                                  request.allowReorder ? "bg-emerald-500" : "bg-gray-300"
                                }`}
                                title={request.allowReorder ? "Disable reorder" : "Allow reorder"}
                              >
                                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                                  request.allowReorder ? "translate-x-4" : "translate-x-0.5"
                                }`} />
                              </button>
                            </label>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
