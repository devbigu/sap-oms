import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export type SubmittedBy = {
  id: string;
  name: string;
};

export type FormSubmissionInput = {
  leadNo: string;
  dated: string;
  customerDetails: Record<string, string | string[]>;
  syringeFilter: Record<string, string | string[]>;
  capsule: Record<string, string | string[]>;
  cartridgeFilter: Record<string, string | string[]>;
  commercialInformation: Record<string, string | string[]>;
};

export type FormSubmissionDocument = FormSubmissionInput & {
  _id?: ObjectId;
  submittedBy: SubmittedBy;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const COLLECTION = "form_submissions";

const TEXT_LIMIT = 2000;
const ARRAY_LIMIT = 50;

const TEXT_FIELDS = {
  root: ["leadNo", "dated"],
  customerDetails: [
    "companyName",
    "contactPerson",
    "department",
    "designation",
    "mobile",
    "email",
    "website",
    "address",
    "cityState",
    "existingSupplier",
  ],
  syringeFilter: ["quantityRequired", "monthlyConsumption", "targetPrice", "requiredDeliveryTime"],
  capsule: ["flowRateRequirement", "operatingPressure", "validationRequirement", "quantityRequired", "monthlyConsumption", "requiredDeliveryTime"],
  cartridgeFilter: ["operatingTemperature", "operatingPressure", "flowRateRequirement", "quantityRequired", "monthlyConsumption", "validationRequirement", "requiredDeliveryTime"],
  commercialInformation: ["expectedOrderQty", "expectedOrderValue", "decisionMaker", "followUpDate", "competitorBrandInUse"],
} as const;

const ARRAY_FIELDS = {
  customerDetails: ["industryType", "inquirySource"],
  syringeFilter: ["filterDiameter", "poreSize", "membraneType", "housingMaterial", "individuallyPacked", "application", "sampleType", "sterile"],
  capsule: ["capsuleSize", "membraneType", "poreSize", "connectionType", "application", "sterile"],
  cartridgeFilter: ["cartridgeLength", "membraneMedia", "micronRating", "endConnection", "sealMaterial", "application"],
  commercialInformation: ["requirementType", "purchaseTimeline", "techApprovalRequired", "sampleRequired"],
} as const;

function cleanText(value: unknown, max = TEXT_LIMIT) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, 160))
    .filter(Boolean)
    .slice(0, ARRAY_LIMIT);
}

function cleanSection(
  source: unknown,
  textFields: readonly string[],
  arrayFields: readonly string[],
) {
  const input = source && typeof source === "object" && !Array.isArray(source)
    ? source as Record<string, unknown>
    : {};
  const output: Record<string, string | string[]> = {};
  textFields.forEach((field) => {
    output[field] = cleanText(input[field]);
  });
  arrayFields.forEach((field) => {
    output[field] = cleanArray(input[field]);
  });
  return output;
}

export function validateFormSubmissionBody(body: unknown): FormSubmissionInput {
  const input = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};

  const submission: FormSubmissionInput = {
    leadNo: cleanText(input.leadNo, 120),
    dated: cleanText(input.dated, 80),
    customerDetails: cleanSection(input.customerDetails, TEXT_FIELDS.customerDetails, ARRAY_FIELDS.customerDetails),
    syringeFilter: cleanSection(input.syringeFilter, TEXT_FIELDS.syringeFilter, ARRAY_FIELDS.syringeFilter),
    capsule: cleanSection(input.capsule, TEXT_FIELDS.capsule, ARRAY_FIELDS.capsule),
    cartridgeFilter: cleanSection(input.cartridgeFilter, TEXT_FIELDS.cartridgeFilter, ARRAY_FIELDS.cartridgeFilter),
    commercialInformation: cleanSection(input.commercialInformation, TEXT_FIELDS.commercialInformation, ARRAY_FIELDS.commercialInformation),
  };

  if (!submission.leadNo) throw new Error("Lead No. is required");
  if (!submission.dated) throw new Error("Dated is required");
  if (!String(submission.customerDetails.companyName || "").trim()) {
    throw new Error("Company Name is required");
  }

  return submission;
}

export async function formSubmissionCollection() {
  const db = await getDb();
  return db.collection<FormSubmissionDocument>(COLLECTION);
}

export function serializeFormSubmission(doc: FormSubmissionDocument) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    id: _id?.toString() ?? "",
    submittedAt: doc.submittedAt instanceof Date ? doc.submittedAt.toISOString() : doc.submittedAt,
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
