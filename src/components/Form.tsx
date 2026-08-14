"use client";

import React, { FormEvent, useState } from "react";
import { resolveStoredAuth } from "@/lib/roleAccess";

// Pixel-matched to the original "Filter Requirement Form" PDF:
// fixed-width label column, bordered value boxes (single box per field,
// growing to two rows where the printed form does), square checkboxes,
// Omsons blue for the brand mark, headings, and divider rules.

const BLUE = "#12508C";

type Option = { label: string; value: string };
const opts = (arr: string[]): Option[] => arr.map((v) => ({ label: v, value: v }));

function useChipState(initial: Record<string, string[]> = {}) {
  const [state, setState] = useState<Record<string, string[]>>(initial);
  const toggle = (group: string, value: string, multi = true) => {
    setState((prev) => {
      const current = prev[group] ?? [];
      if (multi) {
        return {
          ...prev,
          [group]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
        };
      }
      return { ...prev, [group]: current.includes(value) ? [] : [value] };
    });
  };
  const reset = () => setState(initial);
  return { state, toggle, reset };
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 border border-black px-3 py-1.5">
      {children}
    </div>
  );
}

function CheckGroup({
  options,
  selected,
  onToggle,
  name,
}: {
  options: Option[];
  selected: string[];
  onToggle: (v: string) => void;
  name: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        const id = `${name}-${opt.value}`.replace(/[^a-zA-Z0-9_-]/g, "");
        return (
          <label
            key={opt.value}
            htmlFor={id}
            className="flex cursor-pointer items-center gap-2 text-[13.5px] leading-none text-black"
          >
            <span>{opt.label}</span>
            <input
              id={id}
              type="checkbox"
              checked={active}
              onChange={() => onToggle(opt.value)}
              className="h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none border border-black bg-white checked:bg-black relative
                after:content-[''] after:absolute after:left-[3px] after:top-0 after:w-[4px] after:h-[9px]
                after:border-white after:border-r-2 after:border-b-2 after:rotate-45 after:opacity-0 checked:after:opacity-100"
            />
          </label>
        );
      })}
    </div>
  );
}

function TextBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent text-[13.5px] text-black outline-none"
    />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-stretch gap-4 py-[3px]">
      <div className="w-[195px] shrink-0 pt-2 text-[13.5px] text-black">{label}</div>
      <Box>{children}</Box>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="h-[3px] w-full" style={{ backgroundColor: BLUE }} />
      <div className="mt-3 mb-2 text-[15px] font-bold" style={{ color: BLUE }}>
        {children}
      </div>
    </div>
  );
}

// ── option sets, verbatim from the printed form ──────────────────
const INDUSTRY = opts(["Pharma", "Biotech", "Food, Beverages", "Chemical", "Research", "Academic", "Other"]);
const INQUIRY_SOURCE = opts(["Exhibition", "Website", "Distributor", "Reference", "Sales Visit / Other"]);

const SYRINGE_DIAMETER = opts(["13mm", "25mm", "33mm", "50mm"]);
const SYRINGE_PORE = opts(["0.22\u00B5m", "0.45\u00B5m", "Other"]);
const MEMBRANE_SYRINGE = opts(["PTFE", "Nylon", "PVDF", "PES", "MCE", "CA", "GF", "Other"]);
const HOUSING = opts(["PP", "Other"]);
const YES_NO = opts(["Yes", "No"]);
const APPLICATION_SYRINGE = opts(["Sample Preparation", "Sterile Filtration", "HPLC", "Other"]);
const SAMPLE_TYPE = opts(["Aqueous", "Organic", "Aggressive Chemicals", "Biological"]);
const STERILE = opts(["Sterile", "Non Sterile"]);

const CAPSULE_SIZE = opts(["1\"", "2\"", "5\" Small", "5\" Large", "8\"", "10\" Small", "10\" Large"]);
const MEMBRANE_CAPSULE = opts(["PES", "PTFE", "PVDF", "Nylon", "PP", "GF", "Other"]);
const PORE_CAPSULE = opts(["0.1\u00B5m", "0.22\u00B5m", "0.45\u00B5m", "0.8\u00B5m", "1.0\u00B5m", "5\u00B5m", "10\u00B5m", "20\u00B5m"]);
const CONNECTION_TYPE = opts(["Hose Barb", "TC", "Threaded", "Other"]);
const APPLICATION_CAPSULE = opts(["Vent", "Liquid", "Gas", "Solvent"]);

const CARTRIDGE_LENGTH = opts(["5\"", "10\"", "20\"", "30\"", "40\""]);
const END_CONNECTION = opts(["DOE", "SOE", "TC", "Other"]);
const SEAL_MATERIAL = opts(["Silicone", "EPDM", "Viton", "PTFE"]);
const APPLICATION_CARTRIDGE = opts(["Water", "Solvent", "Chemical", "Pharma", "Air", "Gas"]);

const REQUIREMENT_TYPE = opts(["Trial", "Regular", "Tender", "Project"]);
const PURCHASE_TIMELINE = opts(["Immediate", "1 Month", "3 Months", "Future"]);

export default function Form() {
  const [text, setText] = useState<Record<string, string>>({});
  const { state: chips, toggle, reset: resetChips } = useChipState();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const set = (key: string) => (v: string) => setText((prev) => ({ ...prev, [key]: v }));

  const buildPayload = () => ({
    leadNo: text.leadNo ?? "",
    dated: text.dated ?? "",
    customerDetails: {
      companyName: text.companyName ?? "",
      contactPerson: text.contactPerson ?? "",
      department: text.department ?? "",
      designation: text.designation ?? "",
      mobile: text.mobile ?? "",
      email: text.email ?? "",
      website: text.website ?? "",
      address: text.address ?? "",
      cityState: text.cityState ?? "",
      industryType: chips.industry ?? [],
      existingSupplier: text.existingSupplier ?? "",
      inquirySource: chips.inquirySource ?? [],
    },
    syringeFilter: {
      filterDiameter: chips.synDiameter ?? [],
      poreSize: chips.synPore ?? [],
      membraneType: chips.synMembrane ?? [],
      housingMaterial: chips.synHousing ?? [],
      individuallyPacked: chips.synPacked ?? [],
      application: chips.synApplication ?? [],
      sampleType: chips.synSample ?? [],
      quantityRequired: text.synQty ?? "",
      monthlyConsumption: text.synMonthly ?? "",
      sterile: chips.synSterile ?? [],
      targetPrice: text.synPrice ?? "",
      requiredDeliveryTime: text.synDelivery ?? "",
    },
    capsule: {
      capsuleSize: chips.capSize ?? [],
      membraneType: chips.capMembrane ?? [],
      poreSize: chips.capPore ?? [],
      connectionType: chips.capConnection ?? [],
      flowRateRequirement: text.capFlow ?? "",
      operatingPressure: text.capPressure ?? "",
      application: chips.capApplication ?? [],
      sterile: chips.capSterile ?? [],
      validationRequirement: text.capValidation ?? "",
      quantityRequired: text.capQty ?? "",
      monthlyConsumption: text.capMonthly ?? "",
      requiredDeliveryTime: text.capDelivery ?? "",
    },
    cartridgeFilter: {
      cartridgeLength: chips.cartLength ?? [],
      membraneMedia: chips.cartMedia ?? [],
      micronRating: chips.cartMicron ?? [],
      endConnection: chips.cartEnd ?? [],
      sealMaterial: chips.cartSeal ?? [],
      application: chips.cartApplication ?? [],
      operatingTemperature: text.cartTemp ?? "",
      operatingPressure: text.cartPressure ?? "",
      flowRateRequirement: text.cartFlow ?? "",
      quantityRequired: text.cartQty ?? "",
      monthlyConsumption: text.cartMonthly ?? "",
      validationRequirement: text.cartValidation ?? "",
      requiredDeliveryTime: text.cartDelivery ?? "",
    },
    commercialInformation: {
      requirementType: chips.reqType ?? [],
      expectedOrderQty: text.expQty ?? "",
      expectedOrderValue: text.expValue ?? "",
      purchaseTimeline: chips.timeline ?? [],
      decisionMaker: text.decisionMaker ?? "",
      techApprovalRequired: chips.techApproval ?? [],
      sampleRequired: chips.sampleRequired ?? [],
      followUpDate: text.followUp ?? "",
      competitorBrandInUse: text.competitorBrand ?? "",
    },
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const session = resolveStoredAuth(localStorage);
      if (session.status !== "authenticated" || session.role !== "staff") {
        throw new Error("Only staff users can submit this form.");
      }
      const staffId = String(session.user.staff_id ?? session.user.id ?? "").trim();
      const staffName = String(session.user.staff_name ?? session.user.name ?? staffId).trim();
      if (!staffId) throw new Error("Staff session is missing a staff id.");

      const res = await fetch("/api/forms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-omsons-actor-role": "staff",
          "x-omsons-actor-id": staffId,
          "x-omsons-actor-name": staffName,
        },
        body: JSON.stringify(buildPayload()),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed to submit form");

      setText({});
      resetChips();
      setMessage({ type: "success", text: "Form submitted successfully." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to submit form." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-neutral-300 py-8">
      <form onSubmit={handleSubmit} className="mx-auto w-[80vw] border border-black bg-white px-10 py-8">
        {/* Letterhead */}
        <div className="flex items-center justify-center gap-6 pb-2">
          <div className="flex shrink-0 flex-col items-center">
            <div
              className="flex h-14 w-24 items-center justify-center rounded-[50%] text-[13px] font-bold italic text-white"
              style={{ backgroundColor: BLUE }}
            >
              OMSONS
            </div>
            <div className="mt-1 text-[10px] font-semibold tracking-[0.25em]" style={{ color: BLUE }}>
              GERMANY
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-[30px] font-bold tracking-tight" style={{ color: BLUE }}>
              OMSONS GLASSWARE PVT. LTD.
            </h1>
            <p className="text-[17px]" style={{ color: BLUE }}>Exploring the Science...</p>
          </div>
        </div>

        <h2 className="mt-6 text-center text-[17px] font-bold text-black">FILTER REQUIREMENT FORM</h2>
        {message && (
          <div className={`mt-4 rounded border px-3 py-2 text-[13px] font-semibold ${
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}>
            {message.text}
          </div>
        )}

        {/* Lead No. / Dated */}
        <div className="mt-5 flex items-center justify-between text-[14px] font-bold text-black">
          <div className="flex items-center gap-2">
            <span>Lead No.</span>
            <input
              type="text"
              value={text.leadNo ?? ""}
              onChange={(e) => setText((p) => ({ ...p, leadNo: e.target.value }))}
              className="w-32 border-b border-dotted border-black bg-transparent text-[13px] font-normal outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span>Dated</span>
            <input
              type="text"
              value={text.dated ?? ""}
              onChange={(e) => setText((p) => ({ ...p, dated: e.target.value }))}
              className="w-40 border-b border-dotted border-black bg-transparent text-[13px] font-normal outline-none"
            />
          </div>
        </div>

        {/* Customer Details */}
        <div className="mt-5">
          <Row label="Company Name"><TextBox value={text.companyName ?? ""} onChange={set("companyName")} /></Row>
          <Row label="Contact Person"><TextBox value={text.contactPerson ?? ""} onChange={set("contactPerson")} /></Row>
          <Row label="Department"><TextBox value={text.department ?? ""} onChange={set("department")} /></Row>
          <Row label="Designation"><TextBox value={text.designation ?? ""} onChange={set("designation")} /></Row>
          <Row label="Mobile Number"><TextBox value={text.mobile ?? ""} onChange={set("mobile")} /></Row>
          <Row label="Email ID"><TextBox value={text.email ?? ""} onChange={set("email")} /></Row>
          <Row label="Website"><TextBox value={text.website ?? ""} onChange={set("website")} /></Row>
          <Row label="Address"><TextBox value={text.address ?? ""} onChange={set("address")} /></Row>
          <Row label="City / State / Country"><TextBox value={text.cityState ?? ""} onChange={set("cityState")} /></Row>
          <Row label="Industry Type"><CheckGroup options={INDUSTRY} selected={chips.industry ?? []} onToggle={(v) => toggle("industry", v)} name="industry" /></Row>
          <Row label="Existing Supplier"><TextBox value={text.existingSupplier ?? ""} onChange={set("existingSupplier")} /></Row>
          <Row label="Inquiry Source"><CheckGroup options={INQUIRY_SOURCE} selected={chips.inquirySource ?? []} onToggle={(v) => toggle("inquirySource", v)} name="inquirySource" /></Row>
        </div>

        {/* Syringe Filter */}
        <SectionTitle>Syringe Filter</SectionTitle>
        <div>
          <Row label="Filter Diameter"><CheckGroup options={SYRINGE_DIAMETER} selected={chips.synDiameter ?? []} onToggle={(v) => toggle("synDiameter", v)} name="synDiameter" /></Row>
          <Row label="Pore Size"><CheckGroup options={SYRINGE_PORE} selected={chips.synPore ?? []} onToggle={(v) => toggle("synPore", v)} name="synPore" /></Row>
          <Row label="Membrane Type"><CheckGroup options={MEMBRANE_SYRINGE} selected={chips.synMembrane ?? []} onToggle={(v) => toggle("synMembrane", v)} name="synMembrane" /></Row>
          <Row label="Housing Material"><CheckGroup options={HOUSING} selected={chips.synHousing ?? []} onToggle={(v) => toggle("synHousing", v)} name="synHousing" /></Row>
          <Row label="Individually Packed"><CheckGroup options={YES_NO} selected={chips.synPacked ?? []} onToggle={(v) => toggle("synPacked", v)} name="synPacked" /></Row>
          <Row label="Application"><CheckGroup options={APPLICATION_SYRINGE} selected={chips.synApplication ?? []} onToggle={(v) => toggle("synApplication", v)} name="synApplication" /></Row>
          <Row label="Sample Type"><CheckGroup options={SAMPLE_TYPE} selected={chips.synSample ?? []} onToggle={(v) => toggle("synSample", v)} name="synSample" /></Row>
          <Row label="Quantity Required"><TextBox value={text.synQty ?? ""} onChange={set("synQty")} /></Row>
          <Row label="Monthly Consumption"><TextBox value={text.synMonthly ?? ""} onChange={set("synMonthly")} /></Row>
          <Row label="Sterile or Non-Sterile"><CheckGroup options={STERILE} selected={chips.synSterile ?? []} onToggle={(v) => toggle("synSterile", v)} name="synSterile" /></Row>
          <Row label="Target Price"><TextBox value={text.synPrice ?? ""} onChange={set("synPrice")} /></Row>
          <Row label="Required Delivery Time"><TextBox value={text.synDelivery ?? ""} onChange={set("synDelivery")} /></Row>
        </div>

        {/* Capsule */}
        <SectionTitle>Capsule</SectionTitle>
        <div>
          <Row label="Capsule Size"><CheckGroup options={CAPSULE_SIZE} selected={chips.capSize ?? []} onToggle={(v) => toggle("capSize", v)} name="capSize" /></Row>
          <Row label="Membrane Type"><CheckGroup options={MEMBRANE_CAPSULE} selected={chips.capMembrane ?? []} onToggle={(v) => toggle("capMembrane", v)} name="capMembrane" /></Row>
          <Row label="Pore Size"><CheckGroup options={PORE_CAPSULE} selected={chips.capPore ?? []} onToggle={(v) => toggle("capPore", v)} name="capPore" /></Row>
          <Row label="Connection Type"><CheckGroup options={CONNECTION_TYPE} selected={chips.capConnection ?? []} onToggle={(v) => toggle("capConnection", v)} name="capConnection" /></Row>
          <Row label="Flow Rate Requirement"><TextBox value={text.capFlow ?? ""} onChange={set("capFlow")} /></Row>
          <Row label="Operating Pressure"><TextBox value={text.capPressure ?? ""} onChange={set("capPressure")} /></Row>
          <Row label="Application (Filtration)"><CheckGroup options={APPLICATION_CAPSULE} selected={chips.capApplication ?? []} onToggle={(v) => toggle("capApplication", v)} name="capApplication" /></Row>
          <Row label="Sterile or Non-Sterile"><CheckGroup options={STERILE} selected={chips.capSterile ?? []} onToggle={(v) => toggle("capSterile", v)} name="capSterile" /></Row>
          <Row label="Validation Requirement"><TextBox value={text.capValidation ?? ""} onChange={set("capValidation")} /></Row>
          <Row label="Quantity Required"><TextBox value={text.capQty ?? ""} onChange={set("capQty")} /></Row>
          <Row label="Monthly Consumption"><TextBox value={text.capMonthly ?? ""} onChange={set("capMonthly")} /></Row>
          <Row label="Required Delivery Time"><TextBox value={text.capDelivery ?? ""} onChange={set("capDelivery")} /></Row>
        </div>

        {/* Cartridge Filter */}
        <SectionTitle>Cartridge Filter</SectionTitle>
        <div>
          <Row label="Cartridge Length"><CheckGroup options={CARTRIDGE_LENGTH} selected={chips.cartLength ?? []} onToggle={(v) => toggle("cartLength", v)} name="cartLength" /></Row>
          <Row label="Membrane / Media"><CheckGroup options={MEMBRANE_CAPSULE} selected={chips.cartMedia ?? []} onToggle={(v) => toggle("cartMedia", v)} name="cartMedia" /></Row>
          <Row label="Micron Rating"><CheckGroup options={PORE_CAPSULE} selected={chips.cartMicron ?? []} onToggle={(v) => toggle("cartMicron", v)} name="cartMicron" /></Row>
          <Row label="End Connection"><CheckGroup options={END_CONNECTION} selected={chips.cartEnd ?? []} onToggle={(v) => toggle("cartEnd", v)} name="cartEnd" /></Row>
          <Row label="Seal Material"><CheckGroup options={SEAL_MATERIAL} selected={chips.cartSeal ?? []} onToggle={(v) => toggle("cartSeal", v)} name="cartSeal" /></Row>
          <Row label="Application"><CheckGroup options={APPLICATION_CARTRIDGE} selected={chips.cartApplication ?? []} onToggle={(v) => toggle("cartApplication", v)} name="cartApplication" /></Row>
          <Row label="Operating Temperature"><TextBox value={text.cartTemp ?? ""} onChange={set("cartTemp")} /></Row>
          <Row label="Operating Pressure"><TextBox value={text.cartPressure ?? ""} onChange={set("cartPressure")} /></Row>
          <Row label="Flow Rate Requirement"><TextBox value={text.cartFlow ?? ""} onChange={set("cartFlow")} /></Row>
          <Row label="Quantity Required"><TextBox value={text.cartQty ?? ""} onChange={set("cartQty")} /></Row>
          <Row label="Monthly Consumption"><TextBox value={text.cartMonthly ?? ""} onChange={set("cartMonthly")} /></Row>
          <Row label="Validation Requirement"><TextBox value={text.cartValidation ?? ""} onChange={set("cartValidation")} /></Row>
          <Row label="Required Delivery Time"><TextBox value={text.cartDelivery ?? ""} onChange={set("cartDelivery")} /></Row>
        </div>

        {/* Commercial Information */}
        <SectionTitle>Commercial Information</SectionTitle>
        <div>
          <Row label="Requirement Type"><CheckGroup options={REQUIREMENT_TYPE} selected={chips.reqType ?? []} onToggle={(v) => toggle("reqType", v)} name="reqType" /></Row>
          <Row label="Expected Order Qty."><TextBox value={text.expQty ?? ""} onChange={set("expQty")} /></Row>
          <Row label="Expected Order Value"><TextBox value={text.expValue ?? ""} onChange={set("expValue")} /></Row>
          <Row label="Purchase Timeline"><CheckGroup options={PURCHASE_TIMELINE} selected={chips.timeline ?? []} onToggle={(v) => toggle("timeline", v)} name="timeline" /></Row>
          <Row label="Decision Maker"><TextBox value={text.decisionMaker ?? ""} onChange={set("decisionMaker")} /></Row>
          <Row label="Tech. Approval Req."><CheckGroup options={YES_NO} selected={chips.techApproval ?? []} onToggle={(v) => toggle("techApproval", v)} name="techApproval" /></Row>
          <Row label="Sample Required"><CheckGroup options={YES_NO} selected={chips.sampleRequired ?? []} onToggle={(v) => toggle("sampleRequired", v)} name="sampleRequired" /></Row>
          <Row label="Follow-up Date"><TextBox value={text.followUp ?? ""} onChange={set("followUp")} /></Row>
          <Row label="Competitor Brand in Use"><TextBox value={text.competitorBrand ?? ""} onChange={set("competitorBrand")} /></Row>
        </div>

        {/* Signatures */}
        <div className="mt-6">
          <div className="h-[3px] w-full" style={{ backgroundColor: BLUE }} />
          <div className="mt-8 flex items-center justify-between px-4 pb-2 text-[14px] text-black">
            <span>Customer Sign.</span>
            <span>Sales Executive Sign.</span>
          </div>
          <div className="h-[3px] w-full" style={{ backgroundColor: BLUE }} />
          <div className="mt-5 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-[#12508C] px-5 py-2 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit Form"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
