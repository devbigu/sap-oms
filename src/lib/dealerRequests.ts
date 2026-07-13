import type { Db } from "mongodb";

import {
  buildDealerPhpFormData,
  normalizeDealerFormSnapshot,
  type DealerFormSnapshot,
} from "@/lib/dealerForm";

export type DealerRequestStatus = "pending" | "accepted" | "rejected";
export type DealerRequestActorRole = "admin" | "staff" | "dealer" | "accountant";
export type DealerRequestAction = "accept" | "reject" | "resubmit";

export type DealerRequestActor = {
  role: DealerRequestActorRole;
  actorId: string;
  actorName: string;
  roletype: string;
};

export type DealerRequestAuditEntry = {
  action: string;
  at: string;
  actorId: string;
  actorName: string;
  actorRole: DealerRequestActorRole;
  note?: string;
};

export type DealerRequestRecord = Record<string, unknown> & {
  _id?: { toString(): string };
  status?: unknown;
  dealerName?: unknown;
  dealerCode?: unknown;
  city?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  assignedStaffIds?: unknown;
  assignedStaffNames?: unknown;
  submittedById?: unknown;
  submittedByName?: unknown;
  reviewedById?: unknown;
  reviewedByName?: unknown;
  createdDealerId?: unknown;
  formSnapshot?: unknown;
  rejectionReason?: unknown;
  lastRejectionReason?: unknown;
  submittedAt?: unknown;
  acceptedAt?: unknown;
  rejectedAt?: unknown;
  reviewedAt?: unknown;
  resubmittedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  auditTrail?: unknown;
};

export type PublicDealerRequest = {
  id: string;
  requestReference: string;
  status: DealerRequestStatus;
  dealerName: string;
  dealerCode: string;
  city: string;
  contactEmail: string;
  contactPhone: string;
  assignedStaffIds: string[];
  assignedStaffNames: string;
  submittedById: string;
  submittedByName: string;
  reviewedById: string;
  reviewedByName: string;
  createdDealerId: string;
  rejectionReason: string;
  lastRejectionReason: string;
  submittedAt: string;
  acceptedAt: string;
  rejectedAt: string;
  reviewedAt: string;
  resubmittedAt: string;
  createdAt: string;
  updatedAt: string;
  auditTrail: DealerRequestAuditEntry[];
  formSnapshot?: DealerFormSnapshot;
};

export type DealerCandidate = {
  Dealer_Id?: string | number;
  Dealer_Name?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_City?: string;
  Dealer_Username?: string;
  Dealer_Dealercode?: string;
};

const DEALER_REQUEST_COLLECTION = "dealer_approval_requests";
const PHP_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  "https://mirisoft.co.in/sas/dealerapi"
).replace(/\/+$/, "");

let dealerRequestIndexesPromise: Promise<void> | null = null;

function cleanText(value: unknown, max = 1000) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, max);
}

function normalizeStatus(value: unknown): DealerRequestStatus {
  const status = cleanText(value, 40).toLowerCase();
  if (status === "accepted" || status === "approved") return "accepted";
  if (status === "rejected" || status === "disapproved") return "rejected";
  return "pending";
}

function normalizeIdList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeIdList(entry)).filter(Boolean);
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeAuditTrail(value: unknown): DealerRequestAuditEntry[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const source = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      return {
        action: cleanText(source.action, 80),
        at: cleanText(source.at, 80),
        actorId: cleanText(source.actorId, 80),
        actorName: cleanText(source.actorName, 200),
        actorRole: (cleanText(source.actorRole, 20).toLowerCase() || "staff") as DealerRequestActorRole,
        ...(cleanText(source.note, 1500) ? { note: cleanText(source.note, 1500) } : {}),
      };
    })
    .filter((entry) => entry.action && entry.at);
}

export function buildDealerRequestReference(id: string) {
  return id ? `DLR-${id.slice(-8).toUpperCase()}` : "";
}

export function buildDealerRequestIdentityKey(snapshot: DealerFormSnapshot, submittedById: string) {
  return [
    cleanText(submittedById, 80).toLowerCase(),
    snapshot.dealerCode.toLowerCase(),
    snapshot.username.toLowerCase(),
    snapshot.email.toLowerCase(),
  ].join("::");
}

function sanitizeRegexText(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  if (/^\s*</.test(text)) {
    throw new Error("Expected JSON but received HTML");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Invalid JSON response");
  }
}

function normalizeDealerCandidate(value: unknown): DealerCandidate {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    Dealer_Id: typeof source.Dealer_Id === "string" || typeof source.Dealer_Id === "number" ? source.Dealer_Id : "",
    Dealer_Name: cleanText(source.Dealer_Name, 200),
    Dealer_Email: cleanText(source.Dealer_Email, 200),
    Dealer_Number: cleanText(source.Dealer_Number, 80),
    Dealer_City: cleanText(source.Dealer_City, 120),
    Dealer_Username: cleanText(source.Dealer_Username, 120),
    Dealer_Dealercode: cleanText(source.Dealer_Dealercode, 120),
  };
}

function scoreDealerCandidate(candidate: DealerCandidate, snapshot: DealerFormSnapshot) {
  let score = 0;
  if (cleanText(candidate.Dealer_Dealercode).toLowerCase() === snapshot.dealerCode.toLowerCase()) score += 4;
  if (cleanText(candidate.Dealer_Username).toLowerCase() === snapshot.username.toLowerCase()) score += 3;
  if (cleanText(candidate.Dealer_Email).toLowerCase() === snapshot.email.toLowerCase()) score += 2;
  if (cleanText(candidate.Dealer_Name).toLowerCase() === snapshot.name.toLowerCase()) score += 1;
  return score;
}

function toPublicDealerRequest(record: DealerRequestRecord, options?: { includeSnapshot?: boolean }): PublicDealerRequest {
  const id = cleanText(record._id?.toString?.() || record.id, 80);

  return {
    id,
    requestReference: buildDealerRequestReference(id),
    status: normalizeStatus(record.status),
    dealerName: cleanText(record.dealerName, 200),
    dealerCode: cleanText(record.dealerCode, 120),
    city: cleanText(record.city, 120),
    contactEmail: cleanText(record.contactEmail, 200),
    contactPhone: cleanText(record.contactPhone, 80),
    assignedStaffIds: normalizeIdList(record.assignedStaffIds),
    assignedStaffNames: cleanText(record.assignedStaffNames, 400),
    submittedById: cleanText(record.submittedById, 80),
    submittedByName: cleanText(record.submittedByName, 200),
    reviewedById: cleanText(record.reviewedById, 80),
    reviewedByName: cleanText(record.reviewedByName, 200),
    createdDealerId: cleanText(record.createdDealerId, 120),
    rejectionReason: cleanText(record.rejectionReason, 1500),
    lastRejectionReason: cleanText(record.lastRejectionReason, 1500),
    submittedAt: cleanText(record.submittedAt, 80),
    acceptedAt: cleanText(record.acceptedAt, 80),
    rejectedAt: cleanText(record.rejectedAt, 80),
    reviewedAt: cleanText(record.reviewedAt, 80),
    resubmittedAt: cleanText(record.resubmittedAt, 80),
    createdAt: cleanText(record.createdAt, 80),
    updatedAt: cleanText(record.updatedAt, 80),
    auditTrail: normalizeAuditTrail(record.auditTrail),
    ...(options?.includeSnapshot ? { formSnapshot: normalizeDealerFormSnapshot(record.formSnapshot) } : {}),
  };
}

export function resolveDealerRequestActor(input: {
  headers?: Headers;
  role?: unknown;
  actorId?: unknown;
  actorName?: unknown;
  roletype?: unknown;
}): DealerRequestActor | null {
  const headerRole = cleanText(input.headers?.get("x-omsons-actor-role"), 20).toLowerCase();
  const headerActorId = cleanText(input.headers?.get("x-omsons-actor-id"), 80);
  const headerActorName = cleanText(input.headers?.get("x-omsons-actor-name"), 200);
  const headerRoleType = cleanText(input.headers?.get("x-omsons-actor-roletype"), 20);

  const role = (headerRole || cleanText(input.role, 20).toLowerCase()) as DealerRequestActorRole;
  const actorId = headerActorId || cleanText(input.actorId, 80);
  const actorName = headerActorName || cleanText(input.actorName, 200);
  const roletype = headerRoleType || cleanText(input.roletype, 20);

  if (!role || !["admin", "staff", "dealer", "accountant"].includes(role)) {
    return null;
  }

  if (role !== "admin" && !actorId) {
    return null;
  }

  return {
    role,
    actorId,
    actorName: actorName || (role === "admin" ? "Admin" : "Staff"),
    roletype,
  };
}

export function buildDealerRequestHeaders(actor: DealerRequestActor) {
  return {
    "x-omsons-actor-role": actor.role,
    "x-omsons-actor-id": actor.actorId,
    "x-omsons-actor-name": actor.actorName,
    "x-omsons-actor-roletype": actor.roletype,
  };
}

export function buildDealerRequestAccessQuery(actor: DealerRequestActor) {
  if (actor.role === "admin") return {};
  if (actor.role === "staff") return { submittedById: actor.actorId };
  throw new Error("Dealer request access is restricted to admin and staff");
}

export function ensureStatusTransition(currentStatus: DealerRequestStatus, action: DealerRequestAction) {
  if (action === "accept") {
    return currentStatus === "pending"
      ? null
      : "Only pending requests can be accepted";
  }

  if (action === "reject") {
    return currentStatus === "pending"
      ? null
      : "Only pending requests can be rejected";
  }

  return currentStatus === "rejected"
    ? null
    : "Only rejected requests can be resubmitted";
}

export function buildDealerRequestListSearchQuery(search: string) {
  const normalized = cleanText(search, 120);
  if (!normalized) return null;

  const regex = new RegExp(sanitizeRegexText(normalized), "i");
  return {
    $or: [
      { dealerName: regex },
      { dealerCode: regex },
      { city: regex },
      { contactEmail: regex },
      { contactPhone: regex },
      { assignedStaffNames: regex },
      { submittedByName: regex },
      { requestReference: regex },
    ],
  };
}

export function buildDealerRequestCreateDocument(params: {
  actor: DealerRequestActor;
  snapshot: DealerFormSnapshot;
  now: string;
}) {
  const { actor, snapshot, now } = params;

  return {
    requestReference: "",
    requestIdentityKey: buildDealerRequestIdentityKey(snapshot, actor.actorId),
    openRequestKey: buildDealerRequestIdentityKey(snapshot, actor.actorId),
    status: "pending" as DealerRequestStatus,
    dealerName: snapshot.name,
    dealerCode: snapshot.dealerCode,
    city: snapshot.city,
    contactEmail: snapshot.email,
    contactPhone: snapshot.whatsapp,
    assignedStaffIds: snapshot.assignedStaffIds,
    assignedStaffNames: snapshot.staffNames,
    submittedById: actor.actorId,
    submittedByName: actor.actorName,
    reviewedById: "",
    reviewedByName: "",
    rejectionReason: "",
    lastRejectionReason: "",
    createdDealerId: "",
    formSnapshot: snapshot,
    submittedAt: now,
    acceptedAt: "",
    rejectedAt: "",
    reviewedAt: "",
    resubmittedAt: "",
    createdAt: now,
    updatedAt: now,
    approvalLock: null,
    creationAttemptCount: 0,
    auditTrail: [
      {
        action: "submitted",
        at: now,
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.role,
      },
    ],
  };
}

export async function ensureDealerRequestIndexes(db: Db) {
  if (!dealerRequestIndexesPromise) {
    dealerRequestIndexesPromise = Promise.all([
      db.collection(DEALER_REQUEST_COLLECTION).createIndex(
        { openRequestKey: 1 },
        {
          unique: true,
          partialFilterExpression: {
            openRequestKey: { $type: "string" },
          },
        },
      ),
      db.collection(DEALER_REQUEST_COLLECTION).createIndex({ status: 1, updatedAt: -1 }),
      db.collection(DEALER_REQUEST_COLLECTION).createIndex({ submittedById: 1, status: 1, updatedAt: -1 }),
    ]).then(() => undefined).catch((error) => {
      dealerRequestIndexesPromise = null;
      throw error;
    });
  }

  await dealerRequestIndexesPromise;
}

export function getDealerRequestCollection(db: Db) {
  return db.collection(DEALER_REQUEST_COLLECTION);
}

export function appendAuditEntry(
  auditTrail: DealerRequestAuditEntry[],
  entry: DealerRequestAuditEntry,
) {
  return [...auditTrail, entry];
}

export async function submitDealerDirect(snapshot: DealerFormSnapshot) {
  const response = await fetch(`${PHP_BASE_URL}/api/formdata1`, {
    method: "POST",
    body: buildDealerPhpFormData(snapshot),
    cache: "no-store",
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = { msg: text };
  }

  if (!response.ok) {
    throw new Error(cleanText(payload.msg, 300) || `Dealer creation failed (${response.status})`);
  }

  return {
    msg: cleanText(payload.msg, 300) || "Dealer created successfully",
    raw: payload,
  };
}

export async function lookupExistingDealer(snapshot: DealerFormSnapshot) {
  const searchTerms = Array.from(
    new Set([
      snapshot.dealerCode,
      snapshot.username,
      snapshot.email,
      snapshot.name,
    ].map((value) => cleanText(value, 120)).filter(Boolean)),
  );

  const matches = new Map<string, DealerCandidate>();

  for (const term of searchTerms) {
    const response = await fetch(
      `${PHP_BASE_URL}/api/dealerpegination?page=1&limit=50&search=${encodeURIComponent(term)}`,
      { cache: "no-store" },
    );
    const json = await parseJsonResponse<{ data?: unknown[] }>(response);
    for (const entry of json.data ?? []) {
      const candidate = normalizeDealerCandidate(entry);
      const id = cleanText(candidate.Dealer_Id, 120);
      if (!id) continue;
      matches.set(id, candidate);
    }
  }

  const ranked = [...matches.values()]
    .map((candidate) => ({ candidate, score: scoreDealerCandidate(candidate, snapshot) }))
    .filter((entry) => entry.score >= 5)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.candidate ?? null;
}

export async function resolveCreatedDealerId(snapshot: DealerFormSnapshot) {
  for (const delayMs of [0, 300, 700]) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const candidate = await lookupExistingDealer(snapshot);
    const dealerId = cleanText(candidate?.Dealer_Id, 120);
    if (dealerId) return dealerId;
  }

  return "";
}

export function toDealerRequestListItem(record: DealerRequestRecord) {
  return toPublicDealerRequest(record, { includeSnapshot: false });
}

export function toDealerRequestDetail(record: DealerRequestRecord) {
  return toPublicDealerRequest(record, { includeSnapshot: true });
}
