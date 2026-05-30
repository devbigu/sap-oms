"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ApprovalProduct = {
  productname?: string;
  displayName?: string;
  variantCode?: string;
  quantity?: number;
  price?: number;
  packSize?: number;
};

type ApprovalRequest = {
  id: string;
  dealerId: string;
  requestedDiscountPercent: number;
  subtotal: number;
  requestedDiscountAmount: number;
  requestedFinalPayable: number;
  discountScope?: "order" | "product";
  targetProduct?: {
    productKey?: string;
    productname?: string;
    displayName?: string;
    variantCode?: string;
  } | null;
  shipto?: string;
  orderNote?: string;
  products: ApprovalProduct[];
  adminNote?: string;
  reviewedBy?: string;
  reviewedAt?: string | null;
  allowReorder?: boolean;
  reorderCount?: number;
  lastReorderedAt?: string | null;
};

type TabKey = "all" | "reorderable" | "used";

function money(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function resolveDealer() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("UserData");
    const loggedIn = localStorage.getItem("status");
    if (!raw || JSON.parse(loggedIn ?? "false") !== true) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function ApprovedDiscountsPage() {
  const router = useRouter();
  const [dealer, setDealer] = useState<any>(null);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("all");

  useEffect(() => {
    const resolved = resolveDealer();
    if (!resolved?.Dealer_Id) {
      router.push("/login");
      return;
    }
    setDealer(resolved);
  }, [router]);

  const loadRequests = async () => {
    if (!dealer?.Dealer_Id) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/custom-discount-requests?dealer_id=${encodeURIComponent(dealer.Dealer_Id)}&status=approved&limit=200`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Failed to load approved discounts");
      setRequests(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approved discounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRequests(); }, [dealer?.Dealer_Id]);

  const stats = useMemo(() => ({
    all: requests.length,
    reorderable: requests.filter((r) => r.allowReorder).length,
    used: requests.filter((r) => Number(r.reorderCount || 0) > 0).length,
  }), [requests]);

  const visibleRequests = useMemo(() => {
    if (tab === "reorderable") return requests.filter((r) => r.allowReorder);
    if (tab === "used") return requests.filter((r) => Number(r.reorderCount || 0) > 0);
    return requests;
  }, [requests, tab]);

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-6" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <div className="mx-auto max-w-[1200px] space-y-5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button
              onClick={() => router.back()}
              className="mb-3 inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-100"
            >
              Back
            </button>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Approved Discounted Orders</h1>
            <p className="mt-1 text-sm text-gray-500">Reorder product lists with discounts already approved by admin.</p>
          </div>

          <button
            onClick={loadRequests}
            className="w-fit rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { key: "all", label: "All", value: stats.all },
            { key: "reorderable", label: "Reorderable", value: stats.reorderable },
            { key: "used", label: "Used", value: stats.used },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key as TabKey)}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                tab === item.key ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"
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
            Loading approved discounts...
          </div>
        ) : visibleRequests.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
            No approved discounts found.
          </div>
        ) : (
          <div className="space-y-4">
            {visibleRequests.map((request) => {
              const reordered = Number(request.reorderCount || 0);
              return (
                <div key={request.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                          Approved
                        </span>
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                          {(request.discountScope ?? "order") === "product" ? "Product" : "Order"}
                        </span>
                        <span className="text-[12px] text-gray-500">
                          {request.reviewedAt ? new Date(request.reviewedAt).toLocaleString("en-IN") : "Approval date unavailable"}
                        </span>
                      </div>
                      <p className="mt-2 text-[16px] font-bold text-gray-900">{request.requestedDiscountPercent}% approved discount</p>
                      {(request.discountScope ?? "order") === "product" && (
                        <p className="mt-1 text-[12px] font-semibold text-indigo-700">
                          Applies to: {request.targetProduct?.displayName || request.targetProduct?.variantCode || "Selected product"}
                        </p>
                      )}
                      <p className="mt-1 text-[12px] text-gray-500">
                        {reordered > 0
                          ? `Reordered ${reordered}x${request.lastReorderedAt ? ` - Last: ${new Date(request.lastReorderedAt).toLocaleString("en-IN")}` : ""}`
                          : "Not yet reordered"}
                      </p>
                    </div>

                    <button
                      onClick={() => router.push(`/dashboard/dealer/AddOrderForm?reorder=${request.id}`)}
                      disabled={!request.allowReorder}
                      title={request.allowReorder ? "Reorder this approved discount" : "Reorder revoked by admin"}
                      className="rounded-xl bg-emerald-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
                    >
                      Reorder
                    </button>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {["Cat. No.", "Product", "Packs", "Pack Size", "Price"].map((h) => (
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

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Subtotal</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{money(request.subtotal)}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Savings</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-emerald-700">-{money(request.requestedDiscountAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-900 bg-gray-900 px-4 py-3 text-white">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Final</p>
                      <p className="mt-1 font-mono text-[14px] font-bold">{money(request.requestedFinalPayable)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Reorder</p>
                      <p className={`mt-1 text-[12px] font-bold ${request.allowReorder ? "text-emerald-700" : "text-red-600"}`}>
                        {request.allowReorder ? "Allowed" : "Revoked"}
                      </p>
                    </div>
                  </div>

                  {(request.shipto || request.adminNote || request.orderNote) && (
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Ship To</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.shipto || "-"}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Admin Note</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.adminNote || "-"}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Order Note</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.orderNote || "-"}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
