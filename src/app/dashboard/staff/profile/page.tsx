"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Save } from "lucide-react";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";

type StaffSession = {
  staff_id?: string;
  staff_name?: string;
  staff_designation?: string;
  staff_location?: string;
  staff_password?: string;
  staff_email?: string;
  staff_roletype?: string;
};

function readStaffSession(): StaffSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("staffData") || localStorage.getItem("UserData");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-gray-600">
        {label}
        <span className="ml-0.5 text-orange-500">*</span>
      </label>
      <input
        required
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}

export default function StaffProfilePage() {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [location, setLocation] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const session = readStaffSession();
    const id = String(session?.staff_id || "");
    if (!id) {
      router.push("/auth/login");
      return;
    }
    setStaffId(id);

    const loadStaff = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${BACKEND_URL}/staffinfo?id=${encodeURIComponent(id)}`);
        const json = await response.json();
        const data = json.data || session || {};
        setName(data.staff_name || "");
        setDesignation(data.staff_designation || "");
        setLocation(data.staff_location || "");
        setPassword(data.staff_password || "");
      } catch {
        setToast({ text: "Failed to load staff profile", type: "error" });
      } finally {
        setIsLoading(false);
      }
    };

    loadStaff();
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!staffId) return;

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append("staff_name", name);
      formData.append("staff_designation", designation);
      formData.append("staff_location", location);
      formData.append("staff_password", password);

      const response = await axios.post(`${BACKEND_URL}/staffUpdate?id=${encodeURIComponent(staffId)}`, formData);
      const payload = response.data;
      const previous = readStaffSession() || {};
      const updated = payload?.data || {
        ...previous,
        staff_id: staffId,
        staff_name: name,
        staff_designation: designation,
        staff_location: location,
        staff_password: password,
      };
      localStorage.setItem("status", "true");
      localStorage.setItem("UserData", JSON.stringify(updated));
      localStorage.setItem("staffData", JSON.stringify(updated));
      localStorage.setItem("roletype", String(updated.staff_roletype || previous.staff_roletype || "1"));
      setToast({ text: payload?.msg || "Staff profile updated", type: "success" });
      setTimeout(() => window.location.reload(), 700);
    } catch {
      setToast({ text: "Failed to update staff profile", type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading staff profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {toast && (
        <div className={`fixed right-5 top-5 z-50 rounded-lg px-4 py-3 text-sm shadow-lg ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-500 text-white"}`}>
          {toast.text}
        </div>
      )}

      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Staff Profile</h1>
          <p className="mt-1 text-sm text-gray-500">Update your staff account details</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 border-b border-gray-100 pb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
              Staff Details
            </h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Designation" value={designation} onChange={setDesignation} />
              <Field label="Location" value={location} onChange={setLocation} />
              <Field label="Password" value={password} onChange={setPassword} type="password" />
            </div>
          </section>

          <div className="flex justify-end gap-3 pb-6">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
