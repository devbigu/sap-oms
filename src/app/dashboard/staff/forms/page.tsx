"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { resolveStoredAuth } from "@/lib/roleAccess";

type Row = { id: string; leadNo: string; customerDetails?: { companyName?: string }; visitedDate: string; updatedAt: string };
const LIMIT = 20;

function headers() {
  const session = resolveStoredAuth(localStorage);
  const user = session.status === "authenticated" ? session.user : {};
  return {
    "x-omsons-actor-role": "staff",
    "x-omsons-actor-id": String(user.staff_id ?? user.id ?? ""),
    "x-omsons-actor-name": String(user.staff_name ?? user.name ?? user.email ?? ""),
  };
}

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value || "-" : parsed.toLocaleString("en-IN");
}

export default function StaffFormsListPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setSearch(searchInput); }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
        if (search) params.set("search", search);
        const res = await fetch(`/api/forms/mine?${params}`, { headers: headers() });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Failed to load forms");
        if (!cancelled) { setRows(json.data ?? []); setTotalPages(Number(json.totalPages ?? 1) || 1); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load forms");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [page, search]);

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div><h1 className="text-3xl font-bold text-gray-900">Forms</h1><p className="mt-1 text-sm text-gray-500">Your filter requirement submissions.</p></div>
          <Link href="/dashboard/staff/forms/add" className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"><Plus className="h-4 w-4" /> Add Form</Link>
        </div>
        <div className="mb-4 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2"><Search className="h-4 w-4 text-gray-400" /><input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search company or lead..." className="w-full text-sm outline-none" /></div>
        </div>
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50">{["Lead No.", "Company Name", "Visited Date", "Last Updated", "Actions"].map((h) => <th key={h} className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {loading && Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-4"><div className="h-4 animate-pulse rounded bg-gray-200" /></td></tr>)}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-gray-400">No forms found</td></tr>}
              {!loading && rows.map((row) => <tr key={row.id} className="hover:bg-gray-50"><td className="px-4 py-4 font-mono text-xs font-bold">{row.leadNo}</td><td className="px-4 py-4 font-medium text-gray-900">{row.customerDetails?.companyName || "-"}</td><td className="px-4 py-4 text-xs text-gray-500">{date(row.visitedDate)}</td><td className="px-4 py-4 text-xs text-gray-500">{date(row.updatedAt)}</td><td className="px-4 py-4"><Link href={`/dashboard/staff/forms/${row.id}`} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Open / Edit</Link></td></tr>)}
            </tbody>
          </table>
          <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4"><button disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded border px-3 py-1 text-sm disabled:opacity-40">Prev</button><button disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded border px-3 py-1 text-sm disabled:opacity-40">Next</button></div>
        </div>
      </div>
    </div>
  );
}
