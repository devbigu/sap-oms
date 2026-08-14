"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { resolveStoredAuth } from "@/lib/roleAccess";

type Section = Record<string, string | string[] | undefined>;
type Submission = {
  id: string;
  leadNo: string;
  dated: string;
  submittedBy: { id?: string; name?: string };
  submittedAt: string;
  customerDetails: Section;
  syringeFilter: Section;
  capsule: Section;
  cartridgeFilter: Section;
  commercialInformation: Section;
};

const SECTIONS: Array<{ title: string; key: keyof Submission; fields: Array<[string, string]> }> = [
  {
    title: "Customer Details",
    key: "customerDetails",
    fields: [
      ["Company Name", "companyName"], ["Contact Person", "contactPerson"], ["Department", "department"],
      ["Designation", "designation"], ["Mobile Number", "mobile"], ["Email ID", "email"], ["Website", "website"],
      ["Address", "address"], ["City / State / Country", "cityState"], ["Industry Type", "industryType"],
      ["Existing Supplier", "existingSupplier"], ["Inquiry Source", "inquirySource"],
    ],
  },
  {
    title: "Syringe Filter",
    key: "syringeFilter",
    fields: [
      ["Filter Diameter", "filterDiameter"], ["Pore Size", "poreSize"], ["Membrane Type", "membraneType"],
      ["Housing Material", "housingMaterial"], ["Individually Packed", "individuallyPacked"], ["Application", "application"],
      ["Sample Type", "sampleType"], ["Quantity Required", "quantityRequired"], ["Monthly Consumption", "monthlyConsumption"],
      ["Sterile or Non-Sterile", "sterile"], ["Target Price", "targetPrice"], ["Required Delivery Time", "requiredDeliveryTime"],
    ],
  },
  {
    title: "Capsule",
    key: "capsule",
    fields: [
      ["Capsule Size", "capsuleSize"], ["Membrane Type", "membraneType"], ["Pore Size", "poreSize"],
      ["Connection Type", "connectionType"], ["Flow Rate Requirement", "flowRateRequirement"], ["Operating Pressure", "operatingPressure"],
      ["Application (Filtration)", "application"], ["Sterile or Non-Sterile", "sterile"], ["Validation Requirement", "validationRequirement"],
      ["Quantity Required", "quantityRequired"], ["Monthly Consumption", "monthlyConsumption"], ["Required Delivery Time", "requiredDeliveryTime"],
    ],
  },
  {
    title: "Cartridge Filter",
    key: "cartridgeFilter",
    fields: [
      ["Cartridge Length", "cartridgeLength"], ["Membrane / Media", "membraneMedia"], ["Micron Rating", "micronRating"],
      ["End Connection", "endConnection"], ["Seal Material", "sealMaterial"], ["Application", "application"],
      ["Operating Temperature", "operatingTemperature"], ["Operating Pressure", "operatingPressure"], ["Flow Rate Requirement", "flowRateRequirement"],
      ["Quantity Required", "quantityRequired"], ["Monthly Consumption", "monthlyConsumption"], ["Validation Requirement", "validationRequirement"],
      ["Required Delivery Time", "requiredDeliveryTime"],
    ],
  },
  {
    title: "Commercial Information",
    key: "commercialInformation",
    fields: [
      ["Requirement Type", "requirementType"], ["Expected Order Qty.", "expectedOrderQty"], ["Expected Order Value", "expectedOrderValue"],
      ["Purchase Timeline", "purchaseTimeline"], ["Decision Maker", "decisionMaker"], ["Tech. Approval Req.", "techApprovalRequired"],
      ["Sample Required", "sampleRequired"], ["Follow-up Date", "followUpDate"], ["Competitor Brand in Use", "competitorBrandInUse"],
    ],
  },
];

function adminHeaders() {
  const session = resolveStoredAuth(localStorage);
  const user = session.status === "authenticated" ? session.user : {};
  return {
    "x-omsons-actor-role": "admin",
    "x-omsons-actor-id": String(user.staff_id ?? user.id ?? user.admin_id ?? user.Admin_Id ?? ""),
    "x-omsons-actor-name": String(user.staff_name ?? user.name ?? user.username ?? user.email ?? "Admin"),
  };
}

function valueText(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  return value || "-";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "-" : date.toLocaleString("en-IN");
}

export default function AdminFormDetailPage() {
  const params = useParams<{ id: string }>();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/forms/${params.id}`, { headers: adminHeaders() });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || "Failed to load form");
        if (!cancelled) setSubmission(json.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load form");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (params.id) void load();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/dashboard/admin/forms" className="mb-3 inline-flex rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">Back</Link>
            <h1 className="text-3xl font-bold text-gray-900">Form Detail</h1>
            {submission && (
              <p className="mt-1 text-sm text-gray-500">
                Lead {submission.leadNo || "-"} submitted by {submission.submittedBy?.name || "-"} on {formatDate(submission.submittedAt)}
              </p>
            )}
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
        {loading && <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Loading form...</div>}

        {submission && (
          <>
            <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:grid-cols-4">
              <div><p className="text-xs font-semibold uppercase text-gray-400">Lead No.</p><p className="mt-1 font-mono text-sm text-gray-900">{submission.leadNo || "-"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-gray-400">Dated</p><p className="mt-1 text-sm text-gray-900">{submission.dated || "-"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-gray-400">Submitted By</p><p className="mt-1 text-sm text-gray-900">{submission.submittedBy?.name || "-"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-gray-400">Submitted At</p><p className="mt-1 text-sm text-gray-900">{formatDate(submission.submittedAt)}</p></div>
            </div>

            {SECTIONS.map((section) => {
              const data = submission[section.key] as Section;
              return (
                <section key={section.title} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 bg-gray-50 px-5 py-3">
                    <h2 className="text-sm font-bold text-gray-900">{section.title}</h2>
                  </div>
                  <div className="grid gap-px bg-gray-100 sm:grid-cols-2">
                    {section.fields.map(([label, key]) => (
                      <div key={`${section.title}-${key}`} className="bg-white px-5 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{valueText(data?.[key])}</p>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
