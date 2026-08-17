"use client";

import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { resolveStoredAuth } from "@/lib/roleAccess";

const BLUE = "#12508C";
type Option = { label: string; value: string };
type DecisionMaker = { name: string; designation: string; phone: string; email: string };
type Section = Record<string, string | string[] | DecisionMaker | undefined>;
type Product = "Syringe Filter" | "Capsule" | "Cartridge Filter";
type Submission = {
  id: string;
  leadNo: string;
  products: Product[];
  customerDetails: Section;
  syringeFilter?: Section;
  capsule?: Section;
  cartridgeFilter?: Section;
  commercialInfo?: Section;
  commercialInformation?: Section;
  visitedDate?: string;
  createdAt?: string;
  updatedAt?: string;
};

const opts = (arr: string[]): Option[] => arr.map((value) => ({ label: value, value }));
const PRODUCTS = opts(["Syringe Filter", "Capsule", "Cartridge Filter"]);
const INDUSTRY = opts(["Pharma", "Biotech", "Food, Beverages", "Chemical", "Research", "Academic", "Other"]);
const INQUIRY_SOURCE = opts(["Exhibition", "Website", "Distributor", "Reference", "Sales Visit / Other"]);
const SYRINGE_DIAMETER = opts(["13mm", "25mm", "33mm", "50mm"]);
const SYRINGE_PORE = opts(["0.22um", "0.45um", "Other"]);
const MEMBRANE_SYRINGE = opts(["PTFE", "Nylon", "PVDF", "PES", "MCE", "CA", "GF", "Other"]);
const HOUSING = opts(["PP", "Other"]);
const YES_NO = opts(["Yes", "No"]);
const APPLICATION_SYRINGE = opts(["Sample Preparation", "Sterile Filtration", "HPLC", "Other"]);
const SAMPLE_TYPE = opts(["Aqueous", "Organic", "Aggressive Chemicals", "Biological"]);
const STERILE = opts(["Sterile", "Non Sterile"]);
const CAPSULE_SIZE = opts(["1\"", "2\"", "5\" Small", "5\" Large", "8\"", "10\" Small", "10\" Large"]);
const MEMBRANE_CAPSULE = opts(["PES", "PTFE", "PVDF", "Nylon", "PP", "GF", "Other"]);
const PORE_CAPSULE = opts(["0.1um", "0.22um", "0.45um", "0.8um", "1.0um", "5um", "10um", "20um", "Other"]);
const CONNECTION_TYPE = opts(["Hose Barb", "TC", "Threaded", "Other"]);
const APPLICATION_CAPSULE = opts(["Vent", "Liquid", "Gas", "Solvent"]);
const CARTRIDGE_LENGTH = opts(["5\"", "10\"", "20\"", "30\"", "40\""]);
const END_CONNECTION = opts(["DOE", "SOE", "TC", "Other"]);
const SEAL_MATERIAL = opts(["Silicone", "EPDM", "Viton", "PTFE"]);
const APPLICATION_CARTRIDGE = opts(["Water", "Solvent", "Chemical", "Pharma", "Air", "Gas"]);
const REQUIREMENT_TYPE = opts(["Trial", "Regular", "Tender", "Project"]);
const PURCHASE_TIMELINE = opts(["Immediate", "1 Month", "3 Months", "Future"]);

const EMPTY_DM: DecisionMaker = { name: "", designation: "", phone: "", email: "" };
const initialText: Record<string, string> = {};
const initialChoices: Record<string, string[]> = {};

function asArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : typeof value === "string" && value ? [value] : [];
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeDecisionMaker(value: unknown): DecisionMaker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_DM;
  const input = value as Record<string, unknown>;
  return {
    name: asText(input.name),
    designation: asText(input.designation),
    phone: asText(input.phone),
    email: asText(input.email),
  };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-slate-100 px-4 py-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
      <div className="pt-2 text-[13px] font-semibold text-slate-700">{label}</div>
      <div className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm transition-colors focus-within:border-[#12508C] focus-within:ring-2 focus-within:ring-[#12508C]/10">{children}</div>
    </div>
  );
}

function TextBox({ value, onChange, placeholder = "" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-h-6 w-full bg-transparent text-[14px] font-medium text-black outline-none placeholder:text-black/45" />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-7 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <span className="h-5 w-1 rounded-full" style={{ backgroundColor: BLUE }} />
        <div className="text-[15px] font-bold uppercase tracking-wide" style={{ color: BLUE }}>{children}</div>
      </div>
    </div>
  );
}

function MultiSelect({
  name,
  options,
  selected,
  onChange,
  multiple = true,
}: {
  name: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
  const display = selected.length ? selected : ["Select"];

  const toggle = (value: string) => {
    if (!multiple) {
      onChange(selected.includes(value) ? [] : [value]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-7 w-full items-center justify-between gap-2 bg-white text-left text-[13px] text-black">
        <span className="flex flex-wrap gap-1.5">
          {display.map((item) => (
            <span key={item} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${item === "Select" ? "border-transparent text-black/55" : "border-[#12508C]/20 bg-[#12508C]/5 text-black"}`}>{item}</span>
          ))}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="m-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." className="w-full bg-transparent text-[12px] text-black outline-none placeholder:text-black/50" />
          </div>
          <div className="max-h-52 overflow-y-auto px-2 pb-2">
            {filtered.map((option) => (
              <label key={`${name}-${option.value}`} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-medium text-black hover:bg-slate-50">
                <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} className="h-3.5 w-3.5 accent-[#12508C]" />
                {option.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Form({ submission, mode = "create", role = "staff" }: { submission?: Submission | null; mode?: "create" | "edit"; role?: "staff" | "admin" }) {
  const [text, setText] = useState<Record<string, string>>(initialText);
  const [choices, setChoices] = useState<Record<string, string[]>>(initialChoices);
  const [decisionMaker, setDecisionMaker] = useState<DecisionMaker>(EMPTY_DM);
  const [submitting, setSubmitting] = useState(false);
  const [leadPreview, setLeadPreview] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const isEdit = mode === "edit" && Boolean(submission?.id);

  const set = (key: string) => (value: string) => setText((prev) => ({ ...prev, [key]: value }));
  const choose = (key: string) => (values: string[]) => setChoices((prev) => ({ ...prev, [key]: values }));
  const selectedProducts = (choices.products ?? []) as Product[];
  const sampleRequired = choices.sampleRequired?.[0] === "Yes";
  const today = new Date().toLocaleDateString("en-IN");
  const displayDate = (() => {
    const value = submission?.visitedDate;
    if (!value) return today;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("en-IN");
  })();

  useEffect(() => {
    if (!submission) return;
    const customer = submission.customerDetails ?? {};
    const syringe = submission.syringeFilter ?? {};
    const capsule = submission.capsule ?? {};
    const cartridge = submission.cartridgeFilter ?? {};
    const commercial = submission.commercialInfo ?? submission.commercialInformation ?? {};
    setChoices({
      products: asArray(submission.products),
      industry: asArray(customer.industryType),
      inquirySource: asArray(customer.inquirySource),
      synDiameter: asArray(syringe.filterDiameter),
      synPore: asArray(syringe.poreSize),
      synMembrane: asArray(syringe.membraneType),
      synHousing: asArray(syringe.housingMaterial),
      synPacked: asArray(syringe.individuallyPacked),
      synApplication: asArray(syringe.application),
      synSample: asArray(syringe.sampleType),
      synSterile: asArray(syringe.sterile),
      capSize: asArray(capsule.capsuleSize),
      capMembrane: asArray(capsule.membraneType),
      capPore: asArray(capsule.poreSize),
      capConnection: asArray(capsule.connectionType),
      capApplication: asArray(capsule.application),
      capSterile: asArray(capsule.sterile),
      cartLength: asArray(cartridge.cartridgeLength),
      cartMedia: asArray(cartridge.membraneMedia),
      cartMicron: asArray(cartridge.micronRating),
      cartEnd: asArray(cartridge.endConnection),
      cartSeal: asArray(cartridge.sealMaterial),
      cartApplication: asArray(cartridge.application),
      reqType: asArray(commercial.requirementType),
      timeline: asArray(commercial.purchaseTimeline),
      techApproval: asArray(commercial.techApprovalRequired),
      sampleRequired: asArray(commercial.sampleRequired),
    });
    setText({
      companyName: asText(customer.companyName), contactPerson: asText(customer.contactPerson), department: asText(customer.department),
      designation: asText(customer.designation), mobile: asText(customer.mobile), email: asText(customer.email), website: asText(customer.website),
      address: asText(customer.address), cityState: asText(customer.cityState), industryOther: asText(customer.industryTypeOther), existingSupplier: asText(customer.existingSupplier),
      synPoreOther: asText(syringe.poreSizeOther), synMembraneOther: asText(syringe.membraneTypeOther), synHousingOther: asText(syringe.housingMaterialOther), synApplicationOther: asText(syringe.applicationOther), synQty: asText(syringe.quantityRequired), synMonthly: asText(syringe.monthlyConsumption), synPrice: asText(syringe.targetPrice), synDelivery: asText(syringe.requiredDeliveryTime),
      capMembraneOther: asText(capsule.membraneTypeOther), capPoreOther: asText(capsule.poreSizeOther), capConnectionOther: asText(capsule.connectionTypeOther), capFlow: asText(capsule.flowRateRequirement), capPressure: asText(capsule.operatingPressure), capValidation: asText(capsule.validationRequirement), capQty: asText(capsule.quantityRequired), capMonthly: asText(capsule.monthlyConsumption), capDelivery: asText(capsule.requiredDeliveryTime),
      cartMediaOther: asText(cartridge.membraneMediaOther), cartMicronOther: asText(cartridge.micronRatingOther), cartEndOther: asText(cartridge.endConnectionOther), cartTemp: asText(cartridge.operatingTemperature), cartPressure: asText(cartridge.operatingPressure), cartFlow: asText(cartridge.flowRateRequirement), cartQty: asText(cartridge.quantityRequired), cartMonthly: asText(cartridge.monthlyConsumption), cartValidation: asText(cartridge.validationRequirement), cartDelivery: asText(cartridge.requiredDeliveryTime),
      expQty: asText(commercial.expectedOrderQty), expValue: asText(commercial.expectedOrderValue), followUp: asText(commercial.followUpDate), competitorBrand: asText(commercial.competitorBrandInUse), sampleDetails: asText(commercial.sampleDetails),
    });
    setDecisionMaker(normalizeDecisionMaker(commercial.decisionMaker));
  }, [submission]);

  useEffect(() => {
    if (isEdit) return;
    async function loadLeadPreview() {
      try {
        const session = resolveStoredAuth(localStorage);
        if (session.status !== "authenticated" || (session.role !== "staff" && session.role !== "admin")) return;
        const actorId = String(session.user.staff_id ?? session.user.id ?? session.user.admin_id ?? session.user.Admin_Id ?? "").trim();
        const actorName = String(session.user.staff_name ?? session.user.name ?? session.user.username ?? session.user.email ?? actorId).trim();
        const res = await fetch("/api/forms/next-lead", {
          headers: {
            "x-omsons-actor-role": session.role,
            "x-omsons-actor-id": actorId,
            "x-omsons-actor-name": actorName,
          },
        });
        const json = await res.json();
        if (res.ok && json.success && json.leadNo) setLeadPreview(String(json.leadNo));
      } catch {
        setLeadPreview("");
      }
    }
    void loadLeadPreview();
  }, [isEdit]);

  useEffect(() => {
    if (sampleRequired) return;
    setText((prev) => prev.sampleDetails ? { ...prev, sampleDetails: "" } : prev);
  }, [sampleRequired]);

  const payload = useMemo(() => ({
    products: selectedProducts,
    customerDetails: {
      companyName: text.companyName ?? "", contactPerson: text.contactPerson ?? "", department: text.department ?? "", designation: text.designation ?? "",
      mobile: text.mobile ?? "", email: text.email ?? "", website: text.website ?? "", address: text.address ?? "", cityState: text.cityState ?? "",
      industryType: choices.industry ?? [], industryTypeOther: choices.industry?.includes("Other") ? text.industryOther ?? "" : "", existingSupplier: text.existingSupplier ?? "",
      inquirySource: choices.inquirySource ?? [],
    },
    ...(selectedProducts.includes("Syringe Filter") ? { syringeFilter: {
      filterDiameter: choices.synDiameter ?? [], poreSize: choices.synPore ?? [], poreSizeOther: choices.synPore?.includes("Other") ? text.synPoreOther ?? "" : "",
      membraneType: choices.synMembrane ?? [], membraneTypeOther: choices.synMembrane?.includes("Other") ? text.synMembraneOther ?? "" : "",
      housingMaterial: choices.synHousing ?? [], housingMaterialOther: choices.synHousing?.includes("Other") ? text.synHousingOther ?? "" : "",
      individuallyPacked: choices.synPacked?.[0] ?? "", application: choices.synApplication ?? [], applicationOther: choices.synApplication?.includes("Other") ? text.synApplicationOther ?? "" : "",
      sampleType: choices.synSample ?? [], quantityRequired: text.synQty ?? "", monthlyConsumption: text.synMonthly ?? "", sterile: choices.synSterile?.[0] ?? "",
      targetPrice: text.synPrice ?? "", requiredDeliveryTime: text.synDelivery ?? "",
    } } : {}),
    ...(selectedProducts.includes("Capsule") ? { capsule: {
      capsuleSize: choices.capSize ?? [], membraneType: choices.capMembrane ?? [], membraneTypeOther: choices.capMembrane?.includes("Other") ? text.capMembraneOther ?? "" : "",
      poreSize: choices.capPore ?? [], poreSizeOther: choices.capPore?.includes("Other") ? text.capPoreOther ?? "" : "",
      connectionType: choices.capConnection ?? [], connectionTypeOther: choices.capConnection?.includes("Other") ? text.capConnectionOther ?? "" : "",
      flowRateRequirement: text.capFlow ?? "", operatingPressure: text.capPressure ?? "", application: choices.capApplication ?? [], sterile: choices.capSterile?.[0] ?? "",
      validationRequirement: text.capValidation ?? "", quantityRequired: text.capQty ?? "", monthlyConsumption: text.capMonthly ?? "", requiredDeliveryTime: text.capDelivery ?? "",
    } } : {}),
    ...(selectedProducts.includes("Cartridge Filter") ? { cartridgeFilter: {
      cartridgeLength: choices.cartLength ?? [], membraneMedia: choices.cartMedia ?? [], membraneMediaOther: choices.cartMedia?.includes("Other") ? text.cartMediaOther ?? "" : "",
      micronRating: choices.cartMicron ?? [], micronRatingOther: choices.cartMicron?.includes("Other") ? text.cartMicronOther ?? "" : "",
      endConnection: choices.cartEnd ?? [], endConnectionOther: choices.cartEnd?.includes("Other") ? text.cartEndOther ?? "" : "",
      sealMaterial: choices.cartSeal ?? [], application: choices.cartApplication ?? [], operatingTemperature: text.cartTemp ?? "", operatingPressure: text.cartPressure ?? "",
      flowRateRequirement: text.cartFlow ?? "", quantityRequired: text.cartQty ?? "", monthlyConsumption: text.cartMonthly ?? "", validationRequirement: text.cartValidation ?? "", requiredDeliveryTime: text.cartDelivery ?? "",
    } } : {}),
    commercialInfo: {
      requirementType: choices.reqType?.[0] ?? "", expectedOrderQty: text.expQty ?? "", expectedOrderValue: text.expValue ?? "", purchaseTimeline: choices.timeline?.[0] ?? "",
      decisionMaker, techApprovalRequired: choices.techApproval?.[0] ?? "", sampleRequired: choices.sampleRequired?.[0] ?? "", sampleDetails: sampleRequired ? text.sampleDetails ?? "" : "",
      followUpDate: text.followUp ?? "", competitorBrandInUse: text.competitorBrand ?? "",
    },
  }), [choices, decisionMaker, sampleRequired, selectedProducts, text]);

  const reset = () => {
    setText({});
    setChoices({});
    setDecisionMaker(EMPTY_DM);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const session = resolveStoredAuth(localStorage);
      if (session.status !== "authenticated" || (session.role !== "staff" && session.role !== "admin")) throw new Error("Only staff or admin users can save this form.");
      const actorId = String(session.user.staff_id ?? session.user.id ?? session.user.admin_id ?? session.user.Admin_Id ?? "").trim();
      const actorName = String(session.user.staff_name ?? session.user.name ?? session.user.username ?? session.user.email ?? actorId).trim();
      if (session.role === "staff" && !actorId) throw new Error("Staff session is missing a staff id.");
      const res = await fetch(isEdit ? `/api/forms/${submission!.id}` : "/api/forms", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "x-omsons-actor-role": session.role, "x-omsons-actor-id": actorId, "x-omsons-actor-name": actorName },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed to save form");
      if (!isEdit) reset();
      setMessage({ type: "success", text: isEdit ? "Form updated successfully." : `Form submitted successfully. Lead No. ${json.data?.leadNo ?? ""}` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save form." });
    } finally {
      setSubmitting(false);
    }
  };

  const otherInput = (show: boolean, key: string, placeholder = "Please specify") => show ? <div className="mt-2"><TextBox value={text[key] ?? ""} onChange={set(key)} placeholder={placeholder} /></div> : null;

  return (
    <div className="min-h-screen w-full bg-slate-100 py-8">
      <form onSubmit={submit} className="mx-auto w-[80vw] overflow-visible rounded-2xl border border-slate-200 bg-white px-8 py-8 shadow-xl shadow-slate-900/10">
        <div className="rounded-2xl border border-[#12508C]/15 bg-[#12508C]/5 px-6 py-5">
          <div className="flex flex-col items-center justify-center gap-5 text-center md:flex-row">
            <div className="flex shrink-0 flex-col items-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[#12508C]/20 bg-white p-2 shadow-md shadow-[#12508C]/20">
                <img src="/omsons_logo.jpeg" alt="Omsons Logo" className="h-full w-full rounded-full object-contain" />
              </div>
              <div className="mt-2 text-[10px] font-semibold tracking-[0.25em]" style={{ color: BLUE }}>GERMANY</div>
            </div>
            <div>
              <h1 className="text-[28px] font-black tracking-tight md:text-[32px]" style={{ color: BLUE }}>OMSONS GLASSWARE PVT. LTD.</h1>
              <p className="mt-1 text-[15px] font-medium" style={{ color: BLUE }}>Exploring the Science...</p>
            </div>
          </div>
        </div>
        <h2 className="mt-6 text-center text-[18px] font-black uppercase tracking-[0.12em] text-slate-900">Filter Requirement Form</h2>
        {message && <div className={`mt-4 rounded border px-3 py-2 text-[13px] font-semibold ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{message.text}</div>}

        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-[14px] font-bold text-black md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600">Lead No.</span>
            <span className="min-w-32 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-bold text-black shadow-sm">
              {submission?.leadNo || leadPreview || "OML-..."}
            </span>
            {!submission?.leadNo && <span className="text-[11px] font-semibold text-black">(Preview)</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600">Dated</span>
            <span className="min-w-40 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-bold text-black shadow-sm">
              {displayDate}
            </span>
          </div>
        </div>

        <div className="mt-6 overflow-visible rounded-xl border border-slate-200">
          <Row label="Products"><MultiSelect name="products" options={PRODUCTS} selected={choices.products ?? []} onChange={choose("products")} /></Row>
          <Row label="Company Name"><TextBox value={text.companyName ?? ""} onChange={set("companyName")} /></Row>
          <Row label="Contact Person"><TextBox value={text.contactPerson ?? ""} onChange={set("contactPerson")} /></Row>
          <Row label="Department"><TextBox value={text.department ?? ""} onChange={set("department")} /></Row>
          <Row label="Designation"><TextBox value={text.designation ?? ""} onChange={set("designation")} /></Row>
          <Row label="Mobile Number"><TextBox value={text.mobile ?? ""} onChange={set("mobile")} /></Row>
          <Row label="Email ID"><TextBox value={text.email ?? ""} onChange={set("email")} /></Row>
          <Row label="Website"><TextBox value={text.website ?? ""} onChange={set("website")} /></Row>
          <Row label="Address"><TextBox value={text.address ?? ""} onChange={set("address")} /></Row>
          <Row label="City / State / Country"><TextBox value={text.cityState ?? ""} onChange={set("cityState")} /></Row>
          <Row label="Industry Type"><MultiSelect name="industry" options={INDUSTRY} selected={choices.industry ?? []} onChange={choose("industry")} />{otherInput(Boolean(choices.industry?.includes("Other")), "industryOther")}</Row>
          <Row label="Existing Supplier"><TextBox value={text.existingSupplier ?? ""} onChange={set("existingSupplier")} /></Row>
          <Row label="Inquiry Source"><MultiSelect name="inquirySource" options={INQUIRY_SOURCE} selected={choices.inquirySource ?? []} onChange={choose("inquirySource")} /></Row>
        </div>

        {selectedProducts.includes("Syringe Filter") && <><SectionTitle>Syringe Filter</SectionTitle><Row label="Filter Diameter"><MultiSelect name="synDiameter" options={SYRINGE_DIAMETER} selected={choices.synDiameter ?? []} onChange={choose("synDiameter")} /></Row><Row label="Pore Size"><MultiSelect name="synPore" options={SYRINGE_PORE} selected={choices.synPore ?? []} onChange={choose("synPore")} />{otherInput(Boolean(choices.synPore?.includes("Other")), "synPoreOther")}</Row><Row label="Membrane Type"><MultiSelect name="synMembrane" options={MEMBRANE_SYRINGE} selected={choices.synMembrane ?? []} onChange={choose("synMembrane")} />{otherInput(Boolean(choices.synMembrane?.includes("Other")), "synMembraneOther")}</Row><Row label="Housing Material"><MultiSelect name="synHousing" options={HOUSING} selected={choices.synHousing ?? []} onChange={choose("synHousing")} multiple={false} />{otherInput(Boolean(choices.synHousing?.includes("Other")), "synHousingOther")}</Row><Row label="Individually Packed"><MultiSelect name="synPacked" options={YES_NO} selected={choices.synPacked ?? []} onChange={choose("synPacked")} multiple={false} /></Row><Row label="Application"><MultiSelect name="synApplication" options={APPLICATION_SYRINGE} selected={choices.synApplication ?? []} onChange={choose("synApplication")} />{otherInput(Boolean(choices.synApplication?.includes("Other")), "synApplicationOther")}</Row><Row label="Sample Type"><MultiSelect name="synSample" options={SAMPLE_TYPE} selected={choices.synSample ?? []} onChange={choose("synSample")} /></Row><Row label="Quantity Required"><TextBox value={text.synQty ?? ""} onChange={set("synQty")} /></Row><Row label="Monthly Consumption"><TextBox value={text.synMonthly ?? ""} onChange={set("synMonthly")} /></Row><Row label="Sterile or Non-Sterile"><MultiSelect name="synSterile" options={STERILE} selected={choices.synSterile ?? []} onChange={choose("synSterile")} multiple={false} /></Row><Row label="Target Price"><TextBox value={text.synPrice ?? ""} onChange={set("synPrice")} /></Row><Row label="Required Delivery Time"><TextBox value={text.synDelivery ?? ""} onChange={set("synDelivery")} /></Row></>}

        {selectedProducts.includes("Capsule") && <><SectionTitle>Capsule</SectionTitle><Row label="Capsule Size"><MultiSelect name="capSize" options={CAPSULE_SIZE} selected={choices.capSize ?? []} onChange={choose("capSize")} /></Row><Row label="Membrane Type"><MultiSelect name="capMembrane" options={MEMBRANE_CAPSULE} selected={choices.capMembrane ?? []} onChange={choose("capMembrane")} />{otherInput(Boolean(choices.capMembrane?.includes("Other")), "capMembraneOther")}</Row><Row label="Pore Size"><MultiSelect name="capPore" options={PORE_CAPSULE} selected={choices.capPore ?? []} onChange={choose("capPore")} />{otherInput(Boolean(choices.capPore?.includes("Other")), "capPoreOther")}</Row><Row label="Connection Type"><MultiSelect name="capConnection" options={CONNECTION_TYPE} selected={choices.capConnection ?? []} onChange={choose("capConnection")} />{otherInput(Boolean(choices.capConnection?.includes("Other")), "capConnectionOther")}</Row><Row label="Flow Rate Requirement"><TextBox value={text.capFlow ?? ""} onChange={set("capFlow")} /></Row><Row label="Operating Pressure"><TextBox value={text.capPressure ?? ""} onChange={set("capPressure")} /></Row><Row label="Application (Filtration)"><MultiSelect name="capApplication" options={APPLICATION_CAPSULE} selected={choices.capApplication ?? []} onChange={choose("capApplication")} /></Row><Row label="Sterile or Non-Sterile"><MultiSelect name="capSterile" options={STERILE} selected={choices.capSterile ?? []} onChange={choose("capSterile")} multiple={false} /></Row><Row label="Validation Requirement"><TextBox value={text.capValidation ?? ""} onChange={set("capValidation")} /></Row><Row label="Quantity Required"><TextBox value={text.capQty ?? ""} onChange={set("capQty")} /></Row><Row label="Monthly Consumption"><TextBox value={text.capMonthly ?? ""} onChange={set("capMonthly")} /></Row><Row label="Required Delivery Time"><TextBox value={text.capDelivery ?? ""} onChange={set("capDelivery")} /></Row></>}

        {selectedProducts.includes("Cartridge Filter") && <><SectionTitle>Cartridge Filter</SectionTitle><Row label="Cartridge Length"><MultiSelect name="cartLength" options={CARTRIDGE_LENGTH} selected={choices.cartLength ?? []} onChange={choose("cartLength")} /></Row><Row label="Membrane / Media"><MultiSelect name="cartMedia" options={MEMBRANE_CAPSULE} selected={choices.cartMedia ?? []} onChange={choose("cartMedia")} />{otherInput(Boolean(choices.cartMedia?.includes("Other")), "cartMediaOther")}</Row><Row label="Micron Rating"><MultiSelect name="cartMicron" options={PORE_CAPSULE} selected={choices.cartMicron ?? []} onChange={choose("cartMicron")} />{otherInput(Boolean(choices.cartMicron?.includes("Other")), "cartMicronOther")}</Row><Row label="End Connection"><MultiSelect name="cartEnd" options={END_CONNECTION} selected={choices.cartEnd ?? []} onChange={choose("cartEnd")} multiple={false} />{otherInput(Boolean(choices.cartEnd?.includes("Other")), "cartEndOther")}</Row><Row label="Seal Material"><MultiSelect name="cartSeal" options={SEAL_MATERIAL} selected={choices.cartSeal ?? []} onChange={choose("cartSeal")} multiple={false} /></Row><Row label="Application"><MultiSelect name="cartApplication" options={APPLICATION_CARTRIDGE} selected={choices.cartApplication ?? []} onChange={choose("cartApplication")} /></Row><Row label="Operating Temperature"><TextBox value={text.cartTemp ?? ""} onChange={set("cartTemp")} /></Row><Row label="Operating Pressure"><TextBox value={text.cartPressure ?? ""} onChange={set("cartPressure")} /></Row><Row label="Flow Rate Requirement"><TextBox value={text.cartFlow ?? ""} onChange={set("cartFlow")} /></Row><Row label="Quantity Required"><TextBox value={text.cartQty ?? ""} onChange={set("cartQty")} /></Row><Row label="Monthly Consumption"><TextBox value={text.cartMonthly ?? ""} onChange={set("cartMonthly")} /></Row><Row label="Validation Requirement"><TextBox value={text.cartValidation ?? ""} onChange={set("cartValidation")} /></Row><Row label="Required Delivery Time"><TextBox value={text.cartDelivery ?? ""} onChange={set("cartDelivery")} /></Row></>}

        <SectionTitle>Commercial Information</SectionTitle>
        <Row label="Requirement Type"><MultiSelect name="reqType" options={REQUIREMENT_TYPE} selected={choices.reqType ?? []} onChange={choose("reqType")} multiple={false} /></Row>
        <Row label="Expected Order Qty."><TextBox value={text.expQty ?? ""} onChange={set("expQty")} /></Row>
        <Row label="Expected Order Value"><TextBox value={text.expValue ?? ""} onChange={set("expValue")} /></Row>
        <Row label="Purchase Timeline"><MultiSelect name="timeline" options={PURCHASE_TIMELINE} selected={choices.timeline ?? []} onChange={choose("timeline")} multiple={false} /></Row>
        <Row label="Decision Maker"><div className="grid gap-2 md:grid-cols-2"><TextBox value={decisionMaker.name} onChange={(value) => setDecisionMaker((prev) => ({ ...prev, name: value }))} placeholder="Name" /><TextBox value={decisionMaker.designation} onChange={(value) => setDecisionMaker((prev) => ({ ...prev, designation: value }))} placeholder="Designation" /><TextBox value={decisionMaker.phone} onChange={(value) => setDecisionMaker((prev) => ({ ...prev, phone: value }))} placeholder="Phone Number" /><TextBox value={decisionMaker.email} onChange={(value) => setDecisionMaker((prev) => ({ ...prev, email: value }))} placeholder="Email" /></div></Row>
        <Row label="Tech. Approval Req."><MultiSelect name="techApproval" options={YES_NO} selected={choices.techApproval ?? []} onChange={choose("techApproval")} multiple={false} /></Row>
        <Row label="Sample Required"><MultiSelect name="sampleRequired" options={YES_NO} selected={choices.sampleRequired ?? []} onChange={choose("sampleRequired")} multiple={false} />{sampleRequired && <div className="mt-2"><TextBox value={text.sampleDetails ?? ""} onChange={set("sampleDetails")} placeholder="Sample details" /></div>}</Row>
        <Row label="Follow-up Date"><TextBox value={text.followUp ?? ""} onChange={set("followUp")} /></Row>
        <Row label="Competitor Brand in Use"><TextBox value={text.competitorBrand ?? ""} onChange={set("competitorBrand")} /></Row>

        <div className="mt-6"><div className="h-[3px] w-full" style={{ backgroundColor: BLUE }} /><div className="mt-8 flex items-center justify-between px-4 pb-2 text-[14px] text-black"><span>Customer Sign.</span><span>Sales Executive Sign.</span></div><div className="h-[3px] w-full" style={{ backgroundColor: BLUE }} /><div className="mt-5 flex justify-end"><button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded bg-[#12508C] px-5 py-2 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">{isEdit ? null : <Plus className="h-4 w-4" />}{submitting ? "Saving..." : isEdit ? "Save Changes" : "Submit Form"}</button></div></div>
      </form>
    </div>
  );
}
