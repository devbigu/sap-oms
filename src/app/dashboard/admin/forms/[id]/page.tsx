"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Form from "@/components/Form";
import { resolveStoredAuth } from "@/lib/roleAccess";

function adminHeaders() {
  const session = resolveStoredAuth(localStorage);
  const user = session.status === "authenticated" ? session.user : {};
  return {
    "x-omsons-actor-role": "admin",
    "x-omsons-actor-id": String(user.staff_id ?? user.id ?? user.admin_id ?? user.Admin_Id ?? ""),
    "x-omsons-actor-name": String(user.staff_name ?? user.name ?? user.username ?? user.email ?? "Admin"),
  };
}

export default function AdminFormEditPage() {
  const params = useParams<{ id: string }>();
  const [submission, setSubmission] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/forms/${params.id}`, { headers: adminHeaders() });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Failed to load form");
        setSubmission(json.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load form");
      }
    }
    if (params.id) void load();
  }, [params.id]);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!submission) return <div className="p-6 text-sm text-gray-500">Loading form...</div>;
  return <><div className="bg-neutral-300 px-[10vw] pt-6"><Link href="/dashboard/admin/forms" className="rounded border bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">Back to Forms</Link></div><Form submission={submission} mode="edit" role="admin" /></>;
}
