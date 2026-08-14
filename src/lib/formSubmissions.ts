import { Collection, Db, ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export type SubmittedBy = { userId: string; name: string };
export type DecisionMaker = { name: string; designation: string; phone: string; email: string };
export type ProductName = "Syringe Filter" | "Capsule" | "Cartridge Filter";
export type Section = Record<string, string | string[] | DecisionMaker>;

export type FormSubmissionInput = {
  products: ProductName[];
  customerDetails: Section;
  syringeFilter?: Section;
  capsule?: Section;
  cartridgeFilter?: Section;
  commercialInfo: Section;
};

export type FormSubmissionDocument = FormSubmissionInput & {
  _id?: ObjectId;
  leadNo: string;
  submittedBy: SubmittedBy;
  visitedDate: Date;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const COLLECTION = "form_submissions";
const COUNTERS = "counters";
const PRODUCT_NAMES: ProductName[] = ["Syringe Filter", "Capsule", "Cartridge Filter"];
const TEXT_LIMIT = 2000;
const ARRAY_LIMIT = 50;

const TEXT_FIELDS = {
  customerDetails: ["companyName", "contactPerson", "department", "designation", "mobile", "email", "website", "address", "cityState", "industryTypeOther", "existingSupplier"],
  syringeFilter: ["poreSizeOther", "membraneTypeOther", "housingMaterialOther", "applicationOther", "quantityRequired", "monthlyConsumption", "targetPrice", "requiredDeliveryTime"],
  capsule: ["membraneTypeOther", "poreSizeOther", "connectionTypeOther", "flowRateRequirement", "operatingPressure", "validationRequirement", "quantityRequired", "monthlyConsumption", "requiredDeliveryTime"],
  cartridgeFilter: ["membraneMediaOther", "micronRatingOther", "endConnectionOther", "operatingTemperature", "operatingPressure", "flowRateRequirement", "quantityRequired", "monthlyConsumption", "validationRequirement", "requiredDeliveryTime"],
  commercialInfo: ["expectedOrderQty", "expectedOrderValue", "followUpDate", "competitorBrandInUse", "sampleDetails"],
} as const;

const ARRAY_FIELDS = {
  customerDetails: ["industryType", "inquirySource"],
  syringeFilter: ["filterDiameter", "poreSize", "membraneType", "housingMaterial", "application", "sampleType"],
  capsule: ["capsuleSize", "membraneType", "poreSize", "connectionType", "application"],
  cartridgeFilter: ["cartridgeLength", "membraneMedia", "micronRating", "endConnection", "sealMaterial", "application"],
  commercialInfo: [],
} as const;

const SINGLE_FIELDS = {
  syringeFilter: ["individuallyPacked", "sterile"],
  capsule: ["sterile"],
  commercialInfo: ["requirementType", "purchaseTimeline", "techApprovalRequired", "sampleRequired"],
} as const;

function cleanText(value: unknown, max = TEXT_LIMIT) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 160)).filter(Boolean).slice(0, ARRAY_LIMIT);
}

function sourceObject(source: unknown) {
  return source && typeof source === "object" && !Array.isArray(source) ? source as Record<string, unknown> : {};
}

function cleanDecisionMaker(value: unknown): DecisionMaker {
  const input = sourceObject(value);
  return {
    name: cleanText(input.name, 160),
    designation: cleanText(input.designation, 160),
    phone: cleanText(input.phone, 80),
    email: cleanText(input.email, 160),
  };
}

function cleanSection(source: unknown, key: keyof typeof TEXT_FIELDS) {
  const input = sourceObject(source);
  const output: Section = {};
  TEXT_FIELDS[key].forEach((field) => {
    output[field] = cleanText(input[field]);
  });
  ARRAY_FIELDS[key].forEach((field) => {
    output[field] = cleanArray(input[field]);
  });
  (SINGLE_FIELDS[key as keyof typeof SINGLE_FIELDS] ?? []).forEach((field) => {
    output[field] = cleanText(input[field], 160);
  });
  if (key === "commercialInfo") output.decisionMaker = cleanDecisionMaker(input.decisionMaker);
  return output;
}

function includesOther(section: Section, key: string) {
  const value = section[key];
  return Array.isArray(value) && value.includes("Other");
}

function trimHiddenOther(section: Section, field: string, otherField: string) {
  if (!includesOther(section, field)) section[otherField] = "";
}

export function validateFormSubmissionBody(body: unknown): FormSubmissionInput {
  const input = sourceObject(body);
  const products = cleanArray(input.products).filter((item): item is ProductName => PRODUCT_NAMES.includes(item as ProductName));
  if (!products.length) throw new Error("At least one product is required");

  const customerDetails = cleanSection(input.customerDetails, "customerDetails");
  if (!String(customerDetails.companyName || "").trim()) throw new Error("Company Name is required");
  trimHiddenOther(customerDetails, "industryType", "industryTypeOther");

  const commercialInfo = cleanSection(input.commercialInfo ?? input.commercialInformation, "commercialInfo");
  if (commercialInfo.sampleRequired !== "Yes") commercialInfo.sampleDetails = "";

  const submission: FormSubmissionInput = { products, customerDetails, commercialInfo };
  if (products.includes("Syringe Filter")) {
    const section = cleanSection(input.syringeFilter, "syringeFilter");
    trimHiddenOther(section, "poreSize", "poreSizeOther");
    trimHiddenOther(section, "membraneType", "membraneTypeOther");
    trimHiddenOther(section, "housingMaterial", "housingMaterialOther");
    trimHiddenOther(section, "application", "applicationOther");
    submission.syringeFilter = section;
  }
  if (products.includes("Capsule")) {
    const section = cleanSection(input.capsule, "capsule");
    trimHiddenOther(section, "membraneType", "membraneTypeOther");
    trimHiddenOther(section, "poreSize", "poreSizeOther");
    trimHiddenOther(section, "connectionType", "connectionTypeOther");
    submission.capsule = section;
  }
  if (products.includes("Cartridge Filter")) {
    const section = cleanSection(input.cartridgeFilter, "cartridgeFilter");
    trimHiddenOther(section, "membraneMedia", "membraneMediaOther");
    trimHiddenOther(section, "micronRating", "micronRatingOther");
    trimHiddenOther(section, "endConnection", "endConnectionOther");
    submission.cartridgeFilter = section;
  }
  return submission;
}

export async function formSubmissionCollection(): Promise<Collection<FormSubmissionDocument>> {
  const db = await getDb();
  return db.collection<FormSubmissionDocument>(COLLECTION);
}

export async function nextLeadNo(db?: Db) {
  const database = db ?? await getDb();
  const result = await database.collection<{ _id: string; seq: number }>(COUNTERS).findOneAndUpdate(
    { _id: "leadNo" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const seq = Number(result?.seq ?? 1);
  return `OML-${String(seq).padStart(3, "0")}`;
}

export function serializeFormSubmission(doc: FormSubmissionDocument) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    id: _id?.toString() ?? "",
    submittedAt: doc.submittedAt instanceof Date ? doc.submittedAt.toISOString() : doc.submittedAt,
    visitedDate: doc.visitedDate instanceof Date ? doc.visitedDate.toISOString() : doc.visitedDate,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
  };
}

export function objectIdFromString(id: string) {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}
