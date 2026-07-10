"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ??
  "https://mirisoft.co.in/sas/dealerapi"
).replace(/\/+$/, "");

type StaffMember = {
  staff_id: string;
  staff_name: string;
  staff_roletype: number;
};

type DealerFormData = {
  name: string;
  email: string;
  whatsapp: string;
  city: string;
  address: string;
  pincode: string;
  dealerCode: string;
  username: string;        // ← added
  password: string;
  gstNo: string;
  discount: string;
  creditDays: string;
  annualTarget: string;
  currentLimit: string;
  notes: string;
};

const initialForm: DealerFormData = {
  name: "",
  email: "",
  whatsapp: "",
  city: "",
  address: "",
  pincode: "",
  dealerCode: "",
  username: "",            // ← added
  password: "",
  gstNo: "",
  discount: "",
  creditDays: "",
  annualTarget: "",
  currentLimit: "",
  notes: "",
};

export default function AddDealerForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<DealerFormData>(initialForm);
  const [selectedStaff, setSelectedStaff] = useState<string[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    const isLoggedIn = JSON.parse(localStorage.getItem("status") || "false");
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }

    const loadStaffMembers = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/staffassign`, {
          cache: "no-store",
        });
        if (!response.ok) {
          setStaffList([]);
          showToast(`Failed to load staff list (${response.status})`, "error");
          return;
        }

        const data = await response.json();
        if (Array.isArray(data?.data)) {
          setStaffList(data.data);
          return;
        }

        setStaffList([]);
        showToast("Staff list response did not contain an array.", "error");
      } catch (err) {
        setStaffList([]);
        showToast("Failed to load staff list. Please try again.", "error");
        console.error("Failed to fetch staff:", err);
      }
    };

    void loadStaffMembers();
  }, [router, showToast]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleStaffChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const values = Array.from(e.target.selectedOptions, (o) => o.value);
    setSelectedStaff(values);
  };

  // Build the staffname string from selected staff IDs — e.g. "MANPREET SINGH,NEERAJ SHARMA"
  const getStaffNames = (): string => {
    return selectedStaff
      .map((id) => staffList.find((s) => s.staff_id === id)?.staff_name ?? "")
      .filter(Boolean)
      .join(",");
  };

  const validate = (): string | null => {
    const requiredFields: { key: keyof DealerFormData; label: string }[] = [
      { key: "name", label: "Name" },
      { key: "email", label: "Email address" },
      { key: "whatsapp", label: "WhatsApp number" },
      { key: "city", label: "City" },
      { key: "address", label: "Bill-to address" },
      { key: "pincode", label: "Pin code" },
      { key: "dealerCode", label: "Dealer code" },
      { key: "username", label: "Username" },       // ← added
      { key: "password", label: "Password" },
      { key: "gstNo", label: "GST number" },
      { key: "discount", label: "Discount %" },
      { key: "creditDays", label: "Credit days" },
      { key: "annualTarget", label: "Annual target" },
      { key: "currentLimit", label: "Current limit" },
    ];

    for (const field of requiredFields) {
      if (!formData[field.key].trim()) return `${field.label} is required`;
    }

    if (!selectedStaff.length) return "Please assign at least one staff member";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
      return "Enter a valid email address";

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const err = validate();
    if (err) {
      showToast(err, "error");
      return;
    }

    setLoading(true);

    const fd = new FormData();
    fd.append("Dealer_Name", formData.name);
    fd.append("Dealer_Email", formData.email);
    fd.append("Dealer_Number", formData.whatsapp);
    fd.append("Dealer_City", formData.city);
    fd.append("Dealer_Address", formData.address);
    fd.append("Dealer_Pincode", formData.pincode);
    fd.append("Dealer_Dealercode", formData.dealerCode);
    fd.append("Dealer_Username", formData.username);   // ← added
    fd.append("Dealer_Password", formData.password);
    fd.append("gst", formData.gstNo);
    fd.append("discount", formData.discount);
    fd.append("creditdays", formData.creditDays);
    fd.append("annualtarget", formData.annualTarget);
    fd.append("currentlimit", formData.currentLimit);
    fd.append("Dealer_Notes", formData.notes);
    fd.append("assignedstaff", selectedStaff.join(","));
    fd.append("staffname", getStaffNames());            // ← added

    try {
      const { data } = await axios.post(
        `${API_BASE}/api/formdata1`,
        fd
      );
      showToast(data.msg, "success");
      setFormData(initialForm);
      setSelectedStaff([]);
    } catch (err) {
      console.error("Error submitting dealer:", err);
      showToast("Something went wrong. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-lg text-sm font-medium shadow-md ${
            toast.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-6 pb-4 border-b border-gray-100">
          Add dealer
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Basic Information */}
          <Section title="Basic information">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Name" required>
                <input name="name" type="text" value={formData.name} onChange={handleInputChange} placeholder="Full name" required />
              </Field>
              <Field label="Email address" required>
                <input name="email" type="email" value={formData.email} onChange={handleInputChange} placeholder="dealer@email.com" required />
              </Field>
              <Field label="WhatsApp number" required>
                <input name="whatsapp" type="number" value={formData.whatsapp} onChange={handleInputChange} placeholder="10-digit number" required />
              </Field>
              <Field label="City" required>
                <input name="city" type="text" value={formData.city} onChange={handleInputChange} placeholder="City / Location" required />
              </Field>
            </div>
          </Section>

          {/* Staff Assignment */}
          <Section title="Staff assignment">
            <Field label="Assign staff" required hint="Hold Ctrl / Cmd to select multiple">
              <select
                multiple
                required
                value={selectedStaff}
                onChange={handleStaffChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 h-28"
              >
                {staffList.map((s) => (
                  <option key={s.staff_id} value={s.staff_id}>
                    {s.staff_name} {s.staff_roletype === 1 ? "(Exe)" : "(Fie-Exe)"}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          {/* Address */}
          <Section title="Address details">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Bill-to address" required>
                <input name="address" type="text" value={formData.address} onChange={handleInputChange} placeholder="Street address" required />
              </Field>
              <Field label="Pin code" required>
                <input name="pincode" type="number" value={formData.pincode} onChange={handleInputChange} placeholder="6-digit pin code" required />
              </Field>
            </div>
          </Section>

          {/* Account & Credentials */}
          <Section title="Account & credentials">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Dealer code" required>
                <input name="dealerCode" type="text" value={formData.dealerCode} onChange={handleInputChange} placeholder="Unique dealer code" required />
              </Field>
              <Field label="Username" required>
                {/* ← new field */}
                <input name="username" type="text" value={formData.username} onChange={handleInputChange} placeholder="Login username" required />
              </Field>
              <Field label="Password" required>
                <input name="password" type="password" value={formData.password} onChange={handleInputChange} placeholder="Set a password" required />
              </Field>
              <Field label="GST number" required>
                <input name="gstNo" type="text" value={formData.gstNo} onChange={handleInputChange} placeholder="15-character GST number" required />
              </Field>
              <Field label="Discount %" required>
                <input name="discount" type="number" value={formData.discount} onChange={handleInputChange} placeholder="e.g. 10" min={0} max={100} required />
              </Field>
            </div>
          </Section>

          {/* Financial */}
          <Section title="Financial limits & targets">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Credit days" required>
                <input name="creditDays" type="number" value={formData.creditDays} onChange={handleInputChange} placeholder="e.g. 30" required />
              </Field>
              <Field label="Annual target" required>
                <input name="annualTarget" type="number" value={formData.annualTarget} onChange={handleInputChange} placeholder="Amount in ₹" required />
              </Field>
              <Field label="Current limit" required>
                <input name="currentLimit" type="number" value={formData.currentLimit} onChange={handleInputChange} placeholder="Credit limit in ₹" required />
              </Field>
            </div>
          </Section>

          {/* Notes */}
          <Section title="Additional notes">
            <Field label="Notes">
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                placeholder="Any additional remarks..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 resize-none"
              />
            </Field>
          </Section>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? "Submitting..." : "Submit"}
            </button>
            <button
              type="button"
              onClick={() => { setFormData(initialForm); setSelectedStaff([]); }}
              className="px-6 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Reset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3 pb-2 border-b border-gray-100">
        {title}
      </p>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-orange-500 ml-0.5">*</span>}
      </label>
      <div className="[&_input]:w-full [&_input]:px-3 [&_input]:py-2 [&_input]:border [&_input]:border-gray-300 [&_input]:rounded-lg [&_input]:text-sm [&_input]:text-gray-800 [&_input]:placeholder-gray-400 [&_input]:focus:outline-none [&_input]:focus:ring-2 [&_input]:focus:ring-indigo-100 [&_input]:focus:border-indigo-400">
        {children}
      </div>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
