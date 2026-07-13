"use client";

import { useEffect, useMemo, useState } from "react";

import {
  emptyDealerForm,
  getAssignedStaffNames,
  normalizeDealerFormSnapshot,
  toDealerFormSnapshot,
  validateDealerFormSnapshot,
  type DealerFormSnapshot,
  type DealerFormValues,
  type StaffMember,
} from "@/lib/dealerForm";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ??
  "https://mirisoft.co.in/sas/dealerapi"
).replace(/\/+$/, "");

type DealerFormMode = "admin-create" | "staff-submit" | "admin-review" | "staff-resubmit";

type DealerFormContext = {
  mode: DealerFormMode;
  initialSnapshot?: DealerFormSnapshot | null;
  isSubmitting?: boolean;
  onSubmit: (snapshot: DealerFormSnapshot) => Promise<void> | void;
  secondaryAction?: {
    label: string;
    loadingLabel: string;
    onAction: (snapshot: DealerFormSnapshot) => Promise<void> | void;
  };
  isSecondarySubmitting?: boolean;
  onCancel?: () => void;
  requestMeta?: {
    requestReference?: string;
    rejectionReason?: string;
    submittedByName?: string;
    submittedAt?: string;
  };
};

function getModeCopy(mode: DealerFormMode) {
  switch (mode) {
    case "staff-submit":
      return {
        title: "Add Dealer",
        subtitle: "Fill the same dealer details and send this request for admin approval.",
        submitLabel: "Send for Approval",
        submittingLabel: "Sending...",
      };
    case "admin-review":
      return {
        title: "Review Dealer Request",
        subtitle: "Review the submitted values, make corrections if needed, and accept the request to create the real dealer.",
        submitLabel: "Accept Request",
        submittingLabel: "Approving...",
      };
    case "staff-resubmit":
      return {
        title: "Correct Dealer Request",
        subtitle: "Update the rejected request and send it back for approval without creating a duplicate request.",
        submitLabel: "Resubmit for Approval",
        submittingLabel: "Resubmitting...",
      };
    default:
      return {
        title: "Add dealer",
        subtitle: "Create a dealer directly using the existing admin flow.",
        submitLabel: "Submit",
        submittingLabel: "Submitting...",
      };
  }
}

function toFormValues(snapshot?: DealerFormSnapshot | null): DealerFormValues {
  if (!snapshot) return { ...emptyDealerForm };
  return {
    name: snapshot.name,
    email: snapshot.email,
    whatsapp: snapshot.whatsapp,
    city: snapshot.city,
    address: snapshot.address,
    pincode: snapshot.pincode,
    dealerCode: snapshot.dealerCode,
    username: snapshot.username,
    password: snapshot.password,
    gstNo: snapshot.gstNo,
    discount: snapshot.discount,
    creditDays: snapshot.creditDays,
    annualTarget: snapshot.annualTarget,
    currentLimit: snapshot.currentLimit,
    notes: snapshot.notes,
  };
}

export default function DealerFormCard({
  mode,
  initialSnapshot,
  isSubmitting = false,
  onSubmit,
  secondaryAction,
  isSecondarySubmitting = false,
  onCancel,
  requestMeta,
}: DealerFormContext) {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffError, setStaffError] = useState("");
  const [inlineError, setInlineError] = useState("");
  const [formData, setFormData] = useState<DealerFormValues>(() => toFormValues(initialSnapshot));
  const [selectedStaff, setSelectedStaff] = useState<string[]>(() => initialSnapshot?.assignedStaffIds ?? []);

  useEffect(() => {
    let active = true;

    const loadStaffMembers = async () => {
      setStaffLoading(true);
      setStaffError("");
      try {
        const response = await fetch(`${API_BASE}/api/staffassign`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to load staff list (${response.status})`);
        }

        const json = await response.json();
        if (!active) return;

        if (Array.isArray(json?.data)) {
          setStaffList(json.data);
          return;
        }

        setStaffList([]);
        setStaffError("Staff list response did not contain an array.");
      } catch (error) {
        if (!active) return;
        setStaffList([]);
        setStaffError(error instanceof Error ? error.message : "Failed to load staff list.");
      } finally {
        if (active) {
          setStaffLoading(false);
        }
      }
    };

    void loadStaffMembers();
    return () => {
      active = false;
    };
  }, []);

  const copy = useMemo(() => getModeCopy(mode), [mode]);

  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = event.target;
    setInlineError("");
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleStaffChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setInlineError("");
    setSelectedStaff(Array.from(event.target.selectedOptions, (option) => option.value));
  };

  const resetForm = () => {
    const snapshot = normalizeDealerFormSnapshot(initialSnapshot ?? null);
    setFormData(toFormValues(snapshot));
    setSelectedStaff(snapshot.assignedStaffIds);
    setInlineError("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const staffNames = getAssignedStaffNames(selectedStaff, staffList) || initialSnapshot?.staffNames || "";
    const snapshot = toDealerFormSnapshot(formData, selectedStaff, staffNames);
    const validationError = validateDealerFormSnapshot(snapshot);

    if (validationError) {
      setInlineError(validationError);
      return;
    }

    setInlineError("");
    await onSubmit(snapshot);
  };

  const handleSecondaryAction = async () => {
    if (!secondaryAction) return;
    const staffNames = getAssignedStaffNames(selectedStaff, staffList) || initialSnapshot?.staffNames || "";
    const snapshot = toDealerFormSnapshot(formData, selectedStaff, staffNames);
    const validationError = validateDealerFormSnapshot(snapshot);

    if (validationError) {
      setInlineError(validationError);
      return;
    }

    setInlineError("");
    await secondaryAction.onAction(snapshot);
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-3xl rounded-xl border border-gray-100 bg-white p-8 shadow-sm">
        <div className="border-b border-gray-100 pb-5">
          <h1 className="text-xl font-semibold text-gray-900">{copy.title}</h1>
          <p className="mt-2 text-sm text-gray-500">{copy.subtitle}</p>
        </div>

        {requestMeta?.requestReference ? (
          <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
            <div className="font-medium">Request Ref: {requestMeta.requestReference}</div>
            {requestMeta.submittedByName ? (
              <div className="mt-1 text-xs text-indigo-700">Submitted by {requestMeta.submittedByName}</div>
            ) : null}
            {requestMeta.submittedAt ? (
              <div className="mt-1 text-xs text-indigo-700">
                Submitted {new Date(requestMeta.submittedAt).toLocaleString("en-IN")}
              </div>
            ) : null}
          </div>
        ) : null}

        {requestMeta?.rejectionReason ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="font-medium">Rejection Reason</div>
            <div className="mt-1 whitespace-pre-wrap">{requestMeta.rejectionReason}</div>
          </div>
        ) : null}

        {inlineError ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {inlineError}
          </div>
        ) : null}

        {staffError ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {staffError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          <Section title="Basic information">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

          <Section title="Staff assignment">
            <Field label="Assign staff" required hint="Hold Ctrl / Cmd to select multiple">
              <select
                multiple
                required
                disabled={staffLoading}
                value={selectedStaff}
                onChange={handleStaffChange}
                className="h-28 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50"
              >
                {staffList.map((staff) => (
                  <option key={staff.staff_id} value={staff.staff_id}>
                    {staff.staff_name} {String(staff.staff_roletype) === "1" ? "(Exe)" : "(Fie-Exe)"}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title="Address details">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Bill-to address" required>
                <input name="address" type="text" value={formData.address} onChange={handleInputChange} placeholder="Street address" required />
              </Field>
              <Field label="Pin code" required>
                <input name="pincode" type="number" value={formData.pincode} onChange={handleInputChange} placeholder="6-digit pin code" required />
              </Field>
            </div>
          </Section>

          <Section title="Account & credentials">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Dealer code" required>
                <input name="dealerCode" type="text" value={formData.dealerCode} onChange={handleInputChange} placeholder="Unique dealer code" required />
              </Field>
              <Field label="Username" required>
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

          <Section title="Financial limits & targets">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Credit days" required>
                <input name="creditDays" type="number" value={formData.creditDays} onChange={handleInputChange} placeholder="e.g. 30" required />
              </Field>
              <Field label="Annual target" required>
                <input name="annualTarget" type="number" value={formData.annualTarget} onChange={handleInputChange} placeholder="Amount in Rs" required />
              </Field>
              <Field label="Current limit" required>
                <input name="currentLimit" type="number" value={formData.currentLimit} onChange={handleInputChange} placeholder="Credit limit in Rs" required />
              </Field>
            </div>
          </Section>

          <Section title="Additional notes">
            <Field label="Notes">
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                placeholder="Any additional remarks..."
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </Field>
          </Section>

          <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-4">
            <button
              type="submit"
              disabled={isSubmitting || isSecondarySubmitting}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {isSubmitting ? copy.submittingLabel : copy.submitLabel}
            </button>
            {secondaryAction ? (
              <button
                type="button"
                onClick={handleSecondaryAction}
                disabled={isSubmitting || isSecondarySubmitting}
                className="rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {isSecondarySubmitting ? secondaryAction.loadingLabel : secondaryAction.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={resetForm}
              disabled={isSubmitting || isSecondarySubmitting}
              className="rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset
            </button>
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 border-b border-gray-100 pb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
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
        {required ? <span className="ml-0.5 text-orange-500">*</span> : null}
      </label>
      <div className="[&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-gray-300 [&_input]:px-3 [&_input]:py-2 [&_input]:text-sm [&_input]:text-gray-800 [&_input]:placeholder-gray-400 [&_input]:focus:border-indigo-400 [&_input]:focus:outline-none [&_input]:focus:ring-2 [&_input]:focus:ring-indigo-100">
        {children}
      </div>
      {hint ? <p className="text-xs text-gray-400">{hint}</p> : null}
    </div>
  );
}
