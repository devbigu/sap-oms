"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt, RefreshCw, ArrowLeft } from "lucide-react";

type StaffUser = {
  staff_id: string;
  staff_name: string;
  staff_email?: string;
  staff_designation?: string;
  staff_location?: string;
};

type DiscountRequest = {
  id: string;
  dealerId: string;
  dealerName?: string;
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
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

function money(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusBadge(status: DiscountRequest["status"]) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function statusLabel(status: DiscountRequest["status"]) {
  return status === "rejected" ? "Disapproved" : status[0].toUpperCase() + status.slice(1);
}

export default function StaffDiscountRequestsPage() {
  const router = useRouter();
  const [user, setUser] = useState<StaffUser | null>(null);
  const [requests, setRequests] = useState<DiscountRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("staffData") || localStorage.getItem("UserData");
      if (!raw) {
        router.push("/auth/login");
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed?.staff_id) {
        router.push("/auth/login");
        return;
      }
      setUser(parsed);
    } catch {
      router.push("/auth/login");
    }
  }, [router]);

  useEffect(() => {
    if (!user?.staff_id) return;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/custom-discount-requests?staff_id=${encodeURIComponent(user.staff_id)}&limit=200`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message ?? "Failed to load discount requests");
        setRequests(json.data ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load discount requests");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [user?.staff_id]);

  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  }), [requests]);

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-6" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <div className="mx-auto max-w-[1320px] space-y-5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/dashboard/staff"
              className="mb-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-100"
            >
              <ArrowLeft size={14} />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                <Receipt size={18} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Discount Requests</h1>
                <p className="mt-1 text-sm text-gray-500">Read-only view of discount requests linked to your staff ID.</p>
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              if (!user?.staff_id) return;
              setLoading(true);
              setError("");
              fetch(`/api/custom-discount-requests?staff_id=${encodeURIComponent(user.staff_id)}&limit=200`)
                .then((res) => res.json())
                .then((json) => {
                  if (!json.success) throw new Error(json.message ?? "Failed to load discount requests");
                  setRequests(json.data ?? []);
                })
                .catch((e) => setError(e instanceof Error ? e.message : "Failed to load discount requests"))
                .finally(() => setLoading(false));
            }}
            className="w-fit rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Total", value: stats.total },
            { label: "Pending", value: stats.pending },
            { label: "Approved", value: stats.approved },
            { label: "Disapproved", value: stats.rejected },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{item.label}</p>
              <p className="mt-1 font-mono text-xl font-bold text-gray-900">{item.value}</p>
            </div>
          ))}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
            Loading discount requests...
          </div>
        ) : requests.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
            No discount requests found for this staff member.
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => (
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
                      Requested {request.createdAt ? new Date(request.createdAt).toLocaleString("en-IN") : "-"}
                    </p>
                    {(request.discountScope ?? "order") === "product" && (
                      <p className="mt-2 text-[12px] font-semibold text-indigo-700">
                        Applies to: {request.targetProduct?.displayName || request.targetProduct?.variantCode || request.targetProduct?.productname || "Selected product"}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-gray-200 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Current</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{request.currentDiscountPercent}%</p>
                    </div>
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Requested</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-indigo-700">{request.requestedDiscountPercent}%</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Current Amt</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{money(request.currentDiscountAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Requested Amt</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-emerald-700">{money(request.requestedDiscountAmount)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_340px]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Subtotal</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-gray-700">{money(request.subtotal)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Current Net</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-gray-700">{money(request.currentFinalPayable)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Requested Net</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-gray-700">{money(request.requestedFinalPayable)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Status</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-gray-700">{statusLabel(request.status)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Read Only</p>
                    <p className="mt-2 text-[12px] leading-5 text-gray-600">
                      This page is view-only for staff. Approval, rejection, note editing, and status changes remain admin-only.
                    </p>
                    <p className="mt-3 text-[12px] text-gray-500">
                      Created on {request.createdAt ? new Date(request.createdAt).toLocaleDateString("en-IN") : "-"}
                    </p>
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
