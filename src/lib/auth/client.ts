export type ClientAuthRole = "admin" | "staff" | "dealer" | "accountant";

export type ClientAuthSession = {
  role: ClientAuthRole;
  userId: string;
  roletype: string;
  name: string;
  email?: string;
  adminId?: string;
  dealerId?: string;
  dealerName?: string;
  dealerCity?: string;
  dealerCode?: string;
  dealerAddress?: string;
  dealerPincode?: string;
  staffId?: string;
  staffName?: string;
  staffRoleType?: string;
  staffLocation?: string;
  staffDesignation?: string;
  accountantId?: string;
  phone?: string;
  source: "AccountantData" | "staffData" | "UserData" | "AdminData" | "admin";
};

export type AuthResolution =
  | { status: "authenticated"; session: ClientAuthSession }
  | { status: "unauthenticated"; reason?: string }
  | { status: "invalid"; reason: string };

export type StorageLike = {
  getItem(key: string): string | null;
  removeItem(key: string): void;
};

export const AUTH_STORAGE_KEYS = [
  "status",
  "roletype",
  "UserData",
  "AdminData",
  "admin",
  "staffData",
  "AccountantData",
  "accountant_token",
] as const;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredObject(storage: StorageLike, key: string) {
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  if (typeof atob === "function") {
    return atob(padded);
  }

  return Buffer.from(padded, "base64").toString("utf8");
}

export function isStoredAccountantTokenExpired(token: string) {
  try {
    const [, payload] = token.split(".");
    if (!payload) return true;

    const parsed = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown };
    const exp = Number(parsed.exp);
    if (!Number.isFinite(exp)) return true;

    return exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function buildAccountantSession(record: Record<string, unknown>): ClientAuthSession | null {
  const accountantId = firstText(120, record._id, record.id, record.email);
  if (!accountantId) return null;

  return {
    role: "accountant",
    userId: accountantId,
    roletype: "accountant",
    name: firstText(200, record.name, record.email, "Accountant"),
    ...(firstText(240, record.email) ? { email: firstText(240, record.email) } : {}),
    accountantId,
    ...(firstText(80, record.phone) ? { phone: firstText(80, record.phone) } : {}),
    source: "AccountantData",
  };
}

function buildStaffSession(
  record: Record<string, unknown>,
  source: ClientAuthSession["source"],
  explicitRoleType: string,
): ClientAuthSession | null {
  const staffId = firstText(120, record.staff_id, record.id);
  if (!staffId) return null;

  const staffRoleType = firstText(20, record.staff_roletype, explicitRoleType);
  const role = staffRoleType === "0" ? "admin" : "staff";

  return {
    role,
    userId: staffId,
    roletype: explicitRoleType || staffRoleType || (role === "admin" ? "0" : "1"),
    name: firstText(200, record.staff_name, record.name, record.email, role === "admin" ? "Admin" : "Staff"),
    ...(firstText(240, record.staff_email, record.email) ? { email: firstText(240, record.staff_email, record.email) } : {}),
    staffId,
    ...(firstText(200, record.staff_name, record.name) ? { staffName: firstText(200, record.staff_name, record.name) } : {}),
    ...(staffRoleType ? { staffRoleType } : {}),
    ...(firstText(160, record.staff_location) ? { staffLocation: firstText(160, record.staff_location) } : {}),
    ...(firstText(160, record.staff_designation) ? { staffDesignation: firstText(160, record.staff_designation) } : {}),
    ...(role === "admin" ? { adminId: firstText(120, record.id, record.admin_id, record.Admin_Id, record.email, staffId) } : {}),
    source,
  };
}

function buildDealerSession(record: Record<string, unknown>): ClientAuthSession | null {
  const dealerId = firstText(120, record.Dealer_Id);
  if (!dealerId) return null;

  return {
    role: "dealer",
    userId: dealerId,
    roletype: "2",
    name: firstText(200, record.Dealer_Name, record.name, record.email, "Dealer"),
    ...(firstText(240, record.Dealer_Email, record.email) ? { email: firstText(240, record.Dealer_Email, record.email) } : {}),
    dealerId,
    ...(firstText(200, record.Dealer_Name) ? { dealerName: firstText(200, record.Dealer_Name) } : {}),
    ...(firstText(160, record.Dealer_City) ? { dealerCity: firstText(160, record.Dealer_City) } : {}),
    ...(firstText(160, record.Dealer_Dealercode) ? { dealerCode: firstText(160, record.Dealer_Dealercode) } : {}),
    ...(firstText(240, record.Dealer_Address) ? { dealerAddress: firstText(240, record.Dealer_Address) } : {}),
    ...(firstText(40, record.Pincode, record.Dealer_Pincode, record.pincode, record.Pin, record.pin) ? {
      dealerPincode: firstText(40, record.Pincode, record.Dealer_Pincode, record.pincode, record.Pin, record.pin),
    } : {}),
    ...(firstText(80, record.Dealer_Number) ? { phone: firstText(80, record.Dealer_Number) } : {}),
    source: "UserData",
  };
}

function buildAdminSession(
  record: Record<string, unknown>,
  source: ClientAuthSession["source"],
  explicitRoleType: string,
): ClientAuthSession | null {
  const adminId = firstText(120, record.id, record.admin_id, record.Admin_Id, record.staff_id, record.email, record.username);
  if (!adminId) return null;

  const staffRoleType = firstText(20, record.staff_roletype);

  return {
    role: "admin",
    userId: adminId,
    roletype: explicitRoleType || staffRoleType || "3",
    name: firstText(200, record.name, record.username, record.staff_name, record.email, "Admin"),
    ...(firstText(240, record.email, record.staff_email) ? { email: firstText(240, record.email, record.staff_email) } : {}),
    adminId,
    ...(firstText(120, record.staff_id) ? { staffId: firstText(120, record.staff_id) } : {}),
    ...(firstText(200, record.staff_name) ? { staffName: firstText(200, record.staff_name) } : {}),
    ...(staffRoleType ? { staffRoleType } : {}),
    ...(firstText(160, record.staff_location) ? { staffLocation: firstText(160, record.staff_location) } : {}),
    ...(firstText(160, record.staff_designation) ? { staffDesignation: firstText(160, record.staff_designation) } : {}),
    source,
  };
}

export function readLocalAuthResolution(storage: StorageLike): AuthResolution {
  const explicitRoleType = safeText(storage.getItem("roletype"), 20);
  const statusFlag = safeText(storage.getItem("status"), 20).toLowerCase();
  const accountantToken = safeText(storage.getItem("accountant_token"), 4000);
  const accountantData = parseStoredObject(storage, "AccountantData");

  if (accountantToken || accountantData || explicitRoleType === "accountant") {
    if (!accountantToken) {
      return { status: "invalid", reason: "Accountant data is present without a token." };
    }
    if (isStoredAccountantTokenExpired(accountantToken)) {
      return { status: "invalid", reason: "Accountant token is expired or malformed." };
    }
    if (!accountantData) {
      return { status: "invalid", reason: "Accountant token is present without account data." };
    }

    const accountantSession = buildAccountantSession(accountantData);
    if (!accountantSession) {
      return { status: "invalid", reason: "Accountant data is malformed." };
    }

    return { status: "authenticated", session: accountantSession };
  }

  const staffData = parseStoredObject(storage, "staffData");
  if (staffData) {
    const staffSession = buildStaffSession(staffData, "staffData", explicitRoleType);
    if (!staffSession) {
      return { status: "invalid", reason: "Stored staff data is malformed." };
    }

    return { status: "authenticated", session: staffSession };
  }

  const userData = parseStoredObject(storage, "UserData");
  if (userData) {
    const dealerSession = buildDealerSession(userData);
    if (dealerSession) {
      return { status: "authenticated", session: dealerSession };
    }

    const userStaffSession = buildStaffSession(userData, "UserData", explicitRoleType);
    if (userStaffSession) {
      return { status: "authenticated", session: userStaffSession };
    }

    if (explicitRoleType === "3") {
      const userAdminSession = buildAdminSession(userData, "UserData", explicitRoleType);
      if (userAdminSession) {
        return { status: "authenticated", session: userAdminSession };
      }
    }

    return { status: "invalid", reason: "Stored user data does not match a supported role." };
  }

  const adminData = parseStoredObject(storage, "AdminData") ?? parseStoredObject(storage, "admin");
  if (adminData) {
    const adminSession = buildAdminSession(adminData, parseStoredObject(storage, "AdminData") ? "AdminData" : "admin", explicitRoleType || "3");
    if (!adminSession) {
      return { status: "invalid", reason: "Stored admin data is malformed." };
    }

    return { status: "authenticated", session: adminSession };
  }

  if (statusFlag === "true" || explicitRoleType) {
    return { status: "invalid", reason: "Auth metadata exists without a usable user record." };
  }

  return { status: "unauthenticated", reason: "No stored auth data was found." };
}

export function getLocalAuthResolution() {
  if (typeof window === "undefined") {
    return { status: "unauthenticated", reason: "No browser storage on the server." } satisfies AuthResolution;
  }

  return readLocalAuthResolution(window.localStorage);
}

export function getLocalAuthSession() {
  const resolution = getLocalAuthResolution();
  return resolution.status === "authenticated" ? resolution.session : null;
}

export function clearStoredAuthData(storage?: StorageLike) {
  if (!storage && typeof window === "undefined") return;
  const target = storage ?? window.localStorage;

  for (const key of AUTH_STORAGE_KEYS) {
    target.removeItem(key);
  }
}

export function broadcastAuthChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("omsons-auth-changed"));
}

export function clearInvalidStoredAuth() {
  clearStoredAuthData();
  broadcastAuthChange();
}

export function getDefaultRouteForRole(role: ClientAuthRole) {
  if (role === "dealer") return "/home";
  if (role === "staff") return "/dashboard/staff";
  if (role === "accountant") return "/dashboard/accountant";
  return "/dashboard/admin";
}
