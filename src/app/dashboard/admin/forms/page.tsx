"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Search } from "lucide-react";
import { resolveStoredAuth } from "@/lib/roleAccess";

type FormRow = {
  id: string;
  leadNo: string;
  dated: string;
  customerDetails: { companyName?: string };
  submittedBy: { name?: string };
  submittedAt: string;
};

const ITEMS_PER_PAGE = 20;
const SHIMMER = "animate-pulse rounded bg-gray-200";

function adminHeaders() {
  const session = resolveStoredAuth(localStorage);
  const user = session.status === "authenticated" ? session.user : {};
  return {
    "x-omsons-actor-role": "admin",
    "x-omsons-actor-id": String(user.staff_id ?? user.id ?? user.admin_id ?? user.Admin_Id ?? ""),
    "x-omsons-actor-name": String(user.staff_name ?? user.name ?? user.username ?? user.email ?? "Admin"),
  };
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN");
}

export default function AdminFormsPage() {
  const [rows, setRows] = useState<FormRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setSearch(searchInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(ITEMS_PER_PAGE),
        });
        if (search) params.set("search", search);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const res = await fetch(`/api/forms?${params}`, { headers: adminHeaders() });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Failed to load forms");
        if (!cancelled) {
          setRows(json.data ?? []);
          setTotal(Number(json.total ?? 0));
          setTotalPages(Number(json.totalPages ?? 1) || 1);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load forms");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [from, page, search, to]);

  const pages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    return Array.from(new Set([1, page - 1, page, page + 1, totalPages])).filter((p) => p >= 1 && p <= totalPages);
  }, [page, totalPages]);

  const start = rows.length ? (page - 1) * ITEMS_PER_PAGE + 1 : 0;
  const end = Math.min(page * ITEMS_PER_PAGE, total);

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Forms</h1>
          <p className="mt-1 text-sm text-gray-500">Review filter requirement submissions from staff.</p>
        </div>

        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center">
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search company, lead no., staff..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <input type="date" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700" />
          <input type="date" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700" />
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  {["Lead No.", "Company Name", "Submitted By", "Submitted Date", "Dated", "Actions"].map((header) => (
                    <th key={header} className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 6 }).map((__, j) => <td key={j} className="px-4 py-4"><div className={`${SHIMMER} h-4 w-full`} /></td>)}</tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-400">No form submissions found</td></tr>
                )}
                {!loading && rows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-gray-50">
                    <td className="px-4 py-4 font-mono text-xs font-semibold text-gray-700">{row.leadNo || "-"}</td>
                    <td className="px-4 py-4 font-medium text-gray-900">{row.customerDetails?.companyName || "-"}</td>
                    <td className="px-4 py-4 text-gray-600">{row.submittedBy?.name || "-"}</td>
                    <td className="px-4 py-4 text-xs text-gray-500">{formatDate(row.submittedAt)}</td>
                    <td className="px-4 py-4 text-xs text-gray-500">{row.dated || "-"}</td>
                    <td className="px-4 py-4">
                      <Link href={`/dashboard/admin/forms/${row.id}`} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                        <Eye className="h-3.5 w-3.5" /> View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
            <span className="text-xs text-gray-400">{rows.length ? `Showing ${start}-${end} of ${total}` : "No results"}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30">Prev</button>
              {pages.map((p) => <button key={p} onClick={() => setPage(p)} className={`rounded-lg border px-3 py-1.5 text-sm transition ${p === page ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>{p}</button>)}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
