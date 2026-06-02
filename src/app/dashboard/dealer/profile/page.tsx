"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Save, Upload } from "lucide-react";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";

type DealerSession = {
  Dealer_Id?: string;
  Dealer_Name?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_City?: string;
  Dealer_Address?: string;
  Dealer_Pincode?: string;
  Dealer_Password?: string;
};

function readDealerSession(): DealerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("UserData") || localStorage.getItem("user");
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

export default function DealerProfilePage() {
  const router = useRouter();
  const [dealerId, setDealerId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [number, setNumber] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [password, setPassword] = useState("");
  const [image, setImage] = useState<File | null>(null);

  useEffect(() => {
    const session = readDealerSession();
    const id = String(session?.Dealer_Id || "");
    if (!id) {
      router.push("/auth/login");
      return;
    }
    setDealerId(id);

    const loadDealer = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${BACKEND_URL}/dealerinfo?id=${encodeURIComponent(id)}`);
        const json = await response.json();
        const data = json.data || session || {};
        setName(data.Dealer_Name || "");
        setEmail(data.Dealer_Email || "");
        setNumber(data.Dealer_Number || "");
        setCity(data.Dealer_City || "");
        setAddress(data.Dealer_Address || "");
        setPincode(data.Dealer_Pincode || "");
        setPassword(data.Dealer_Password || "");
      } catch {
        setToast({ text: "Failed to load dealer profile", type: "error" });
      } finally {
        setIsLoading(false);
      }
    };

    loadDealer();
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dealerId) return;

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append("Dealer_Name", name);
      formData.append("Dealer_Email", email);
      formData.append("Dealer_Number", number);
      formData.append("Dealer_City", city);
      formData.append("Dealer_Address", address);
      formData.append("Dealer_Pincode", pincode);
      formData.append("Dealer_Password", password);
      if (image) formData.append("Dealer_Image", image);

      const response = await axios.post(`${BACKEND_URL}/updateDealer?id=${encodeURIComponent(dealerId)}`, formData);
      const payload = response.data;
      const previous = readDealerSession() || {};
      const updated = payload?.data || {
        ...previous,
        Dealer_Id: dealerId,
        Dealer_Name: name,
        Dealer_Email: email,
        Dealer_Number: number,
        Dealer_City: city,
        Dealer_Address: address,
        Dealer_Pincode: pincode,
        Dealer_Password: password,
      };
      localStorage.setItem("status", "true");
      localStorage.setItem("UserData", JSON.stringify(updated));
      localStorage.setItem("roletype", "2");
      setToast({ text: payload?.msg || "Dealer profile updated", type: "success" });
      setTimeout(() => window.location.reload(), 700);
    } catch {
      setToast({ text: "Failed to update dealer profile", type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading dealer profile...</p>
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

      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dealer Profile</h1>
          <p className="mt-1 text-sm text-gray-500">Update your dealer account and contact details</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 border-b border-gray-100 pb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
              Dealer Details
            </h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label="Name" value={name} onChange={setName} />
              <Field label="Email" value={email} onChange={setEmail} type="email" />
              <Field label="WhatsApp Number" value={number} onChange={setNumber} type="tel" />
              <Field label="City" value={city} onChange={setCity} />
              <Field label="Address" value={address} onChange={setAddress} />
              <Field label="Pin Code" value={pincode} onChange={setPincode} type="number" />
              <Field label="Password" value={password} onChange={setPassword} type="password" />
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 border-b border-gray-100 pb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
              Profile Image
            </h2>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600 hover:border-indigo-300 hover:bg-indigo-50">
              <span className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                {image ? image.name : "Choose image"}
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={(event) => setImage(event.target.files?.[0] || null)} />
            </label>
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
