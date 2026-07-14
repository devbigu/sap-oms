import { createHmac } from "node:crypto";

const SESSION_VERSION = 1;

export const SESSION_COOKIE_NAME = "omsons_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type SessionRole = "admin" | "staff" | "dealer" | "accountant";

export type AppSession = {
  version: number;
  role: SessionRole;
  userId: string;
  roletype: string;
  name: string;
  email?: string;
  adminId?: string;
  dealerId?: string;
  dealerName?: string;
  dealerCity?: string;
  dealerCode?: string;
  staffId?: string;
  staffName?: string;
  staffRoleType?: string;
  staffLocation?: string;
  staffDesignation?: string;
  accountantId?: string;
  phone?: string;
  issuedAt: number;
  expiresAt: number;
};

export type PublicAppSession = Omit<AppSession, "version" | "issuedAt" | "expiresAt"> & {
  expiresAt: number;
};

function safeText(value: unknown, max = 240) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : String(value ?? "").trim().slice(0, max);
}

function firstText(max: number, ...values: unknown[]) {
  for (const value of values) {
    const text = safeText(value, max);
    if (text) return text;
  }
  return "";
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function timingSafeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;

  let result = 0;
  for (let index = 0; index < leftBuffer.length; index += 1) {
    result |= leftBuffer[index] ^ rightBuffer[index];
  }
  return result === 0;
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeSessionToken(session: AppSession, secret: string) {
  const payload = toBase64Url(JSON.stringify(session));
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function decodeSessionToken(token: string, secret: string): AppSession | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signPayload(payload, secret);
  if (!timingSafeEqualText(signature, expectedSignature)) return null;

  const parsed = safeJsonParse<AppSession>(fromBase64Url(payload));
  if (!parsed) return null;
  if (parsed.version !== SESSION_VERSION) return null;
  if (!parsed.userId || !parsed.role) return null;
  if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) return null;

  return parsed;
}

function buildBaseSession(input: Omit<AppSession, "version" | "issuedAt" | "expiresAt">, nowMs: number): AppSession {
  return {
    version: SESSION_VERSION,
    ...input,
    issuedAt: nowMs,
    expiresAt: nowMs + SESSION_MAX_AGE_SECONDS * 1000,
  };
}

export function buildPhpUserSession(userData: Record<string, unknown>, requestedRoleType: string, nowMs = Date.now()): AppSession | null {
  const explicitRoleType = safeText(requestedRoleType, 20);
  const normalizedRequestedRoleType = explicitRoleType === "0" ? "3" : explicitRoleType;
  const hasRequestedRole = normalizedRequestedRoleType.length > 0;
  const dealerId = firstText(120, userData.Dealer_Id);
  const staffId = firstText(120, userData.staff_id);
  const staffRoleType = firstText(20, userData.staff_roletype);
  const adminId = firstText(120, userData.id, userData.admin_id, userData.Admin_Id);
  const email = firstText(240, userData.email, userData.Dealer_Email, userData.staff_email);

  if (normalizedRequestedRoleType === "2") {
    if (!dealerId) return null;
    return buildBaseSession(
      {
        role: "dealer",
        userId: dealerId,
        roletype: "2",
        name: firstText(200, userData.Dealer_Name, userData.name, email, "Dealer"),
        email,
        dealerId,
        dealerName: firstText(200, userData.Dealer_Name, userData.name),
        dealerCity: firstText(160, userData.Dealer_City),
        dealerCode: firstText(160, userData.Dealer_Dealercode),
        phone: firstText(80, userData.Dealer_Number),
      },
      nowMs,
    );
  }

  if (normalizedRequestedRoleType === "3") {
    return buildBaseSession(
      {
        role: "admin",
        userId: adminId || "admin",
        roletype: normalizedRequestedRoleType || staffRoleType || "0",
        name: firstText(200, userData.name, userData.username, userData.staff_name, email, "Admin"),
        email,
        adminId: adminId || "admin",
        staffId,
        staffName: firstText(200, userData.staff_name),
        staffRoleType,
        staffLocation: firstText(160, userData.staff_location),
        staffDesignation: firstText(160, userData.staff_designation),
      },
      nowMs,
    );
  }

  if (normalizedRequestedRoleType === "1") {
    if (!staffId) return null;
    return buildBaseSession(
      {
        role: "staff",
        userId: staffId,
        roletype: normalizedRequestedRoleType || staffRoleType || "1",
        name: firstText(200, userData.staff_name, userData.name, email, "Staff"),
        email,
        staffId,
        staffName: firstText(200, userData.staff_name, userData.name),
        staffRoleType,
        staffLocation: firstText(160, userData.staff_location),
        staffDesignation: firstText(160, userData.staff_designation),
      },
      nowMs,
    );
  }

  if (!hasRequestedRole && dealerId) {
    return buildBaseSession(
      {
        role: "dealer",
        userId: dealerId,
        roletype: "2",
        name: firstText(200, userData.Dealer_Name, userData.name, email, "Dealer"),
        email,
        dealerId,
        dealerName: firstText(200, userData.Dealer_Name, userData.name),
        dealerCity: firstText(160, userData.Dealer_City),
        dealerCode: firstText(160, userData.Dealer_Dealercode),
        phone: firstText(80, userData.Dealer_Number),
      },
      nowMs,
    );
  }

  if (!hasRequestedRole && (staffRoleType === "0" || adminId)) {
    return buildBaseSession(
      {
        role: "admin",
        userId: adminId || "admin",
        roletype: staffRoleType || "0",
        name: firstText(200, userData.name, userData.username, userData.staff_name, email, "Admin"),
        email,
        adminId: adminId || "admin",
        staffId,
        staffName: firstText(200, userData.staff_name),
        staffRoleType,
        staffLocation: firstText(160, userData.staff_location),
        staffDesignation: firstText(160, userData.staff_designation),
      },
      nowMs,
    );
  }

  if (!hasRequestedRole && staffId) {
    return buildBaseSession(
      {
        role: "staff",
        userId: staffId,
        roletype: staffRoleType || "1",
        name: firstText(200, userData.staff_name, userData.name, email, "Staff"),
        email,
        staffId,
        staffName: firstText(200, userData.staff_name, userData.name),
        staffRoleType,
        staffLocation: firstText(160, userData.staff_location),
        staffDesignation: firstText(160, userData.staff_designation),
      },
      nowMs,
    );
  }

  return null;
}

export function buildAccountantSession(accountant: Record<string, unknown>, nowMs = Date.now()): AppSession | null {
  const accountantId = firstText(120, accountant._id, accountant.id);
  if (!accountantId) return null;

  return buildBaseSession(
    {
      role: "accountant",
      userId: accountantId,
      roletype: "accountant",
      name: firstText(200, accountant.name, accountant.email, "Accountant"),
      email: firstText(240, accountant.email),
      accountantId,
      phone: firstText(80, accountant.phone),
    },
    nowMs,
  );
}

export function toPublicSession(session: AppSession): PublicAppSession {
  return {
    role: session.role,
    userId: session.userId,
    roletype: session.roletype,
    name: session.name,
    ...(session.email ? { email: session.email } : {}),
    ...(session.adminId ? { adminId: session.adminId } : {}),
    ...(session.dealerId ? { dealerId: session.dealerId } : {}),
    ...(session.dealerName ? { dealerName: session.dealerName } : {}),
    ...(session.dealerCity ? { dealerCity: session.dealerCity } : {}),
    ...(session.dealerCode ? { dealerCode: session.dealerCode } : {}),
    ...(session.staffId ? { staffId: session.staffId } : {}),
    ...(session.staffName ? { staffName: session.staffName } : {}),
    ...(session.staffRoleType ? { staffRoleType: session.staffRoleType } : {}),
    ...(session.staffLocation ? { staffLocation: session.staffLocation } : {}),
    ...(session.staffDesignation ? { staffDesignation: session.staffDesignation } : {}),
    ...(session.accountantId ? { accountantId: session.accountantId } : {}),
    ...(session.phone ? { phone: session.phone } : {}),
    expiresAt: session.expiresAt,
  };
}
