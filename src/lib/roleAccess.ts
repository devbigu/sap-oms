export type AppRole = "admin" | "staff" | "dealer" | "accountant";

export type StoredUser = Record<string, unknown> & {
  role?: AppRole;
  staff_roletype?: string | number;
  staff_id?: string | number;
  staff_name?: string;
  staff_location?: string;
  staff_designation?: string;
  Dealer_Id?: string | number;
  Dealer_Name?: string;
  Dealer_City?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_Dealercode?: string;
  name?: string;
  username?: string;
  email?: string;
  id?: string | number;
  admin_id?: string | number;
  Admin_Id?: string | number;
};

export type AuthSession =
  | { status: "authenticated"; role: AppRole; roletype: string; user: StoredUser }
  | { status: "unauthenticated"; reason: "missing" | "invalid" | "unsupported-role" };

export type AuthStorage = Pick<Storage, "getItem" | "removeItem">;

export const AUTH_KEYS = [
  "status",
  "UserData",
  "roletype",
  "staffData",
  "AdminData",
  "admin",
  "user",
  "accountant_token",
  "AccountantData",
] as const;

export const LOGIN_ROUTE = "/auth/login";
export const ACCOUNTANT_LOGIN_ROUTE = "/auth/accountant-login";

const DEMO_ACCOUNTANT_ID = "demo000000000000000000000";

function parseObject(storage: AuthStorage, key: string): StoredUser | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as StoredUser;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const decoder =
      typeof atob === "function"
        ? atob
        : (value: string) => Buffer.from(value, "base64").toString("binary");
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decoder(base64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function clearAuthStorage(storage: AuthStorage) {
  AUTH_KEYS.forEach((key) => storage.removeItem(key));
}

function normalizeRoleFromRoleType(roletype: unknown): AppRole | null {
  const value = String(roletype ?? "").trim().toLowerCase();
  if (value === "3" || value === "0" || value === "admin") return "admin";
  if (value === "1" || value === "staff") return "staff";
  if (value === "2" || value === "dealer") return "dealer";
  if (value === "accountant") return "accountant";
  return null;
}

function session(role: AppRole, user: StoredUser, roletype?: unknown): AuthSession {
  return {
    status: "authenticated",
    role,
    roletype: String(roletype ?? (role === "admin" ? "3" : role === "staff" ? "1" : role === "dealer" ? "2" : "accountant")),
    user: { ...user, role },
  };
}

export function resolveStoredAuth(storage: AuthStorage): AuthSession {
  try {
    const accountantToken = storage.getItem("accountant_token");
    if (accountantToken) {
      const payload = decodeJwtPayload(accountantToken);
      const accountant = parseObject(storage, "AccountantData");
      if ((payload?.sub === DEMO_ACCOUNTANT_ID || accountant) && (accountant || payload)) {
        return session("accountant", accountant ?? { name: "Demo Accountant", email: "demo@omsons.com" }, "accountant");
      }
      return { status: "unauthenticated", reason: "unsupported-role" };
    }

    const staff = parseObject(storage, "staffData");
    if (staff?.staff_id) {
      const role = normalizeRoleFromRoleType(staff.staff_roletype);
      if (role === "admin" || role === "staff") return session(role, staff, staff.staff_roletype);
      return { status: "unauthenticated", reason: "unsupported-role" };
    }

    const userData = parseObject(storage, "UserData");
    if (userData?.Dealer_Id) return session("dealer", userData, "2");
    if (userData?.staff_id) {
      const role = normalizeRoleFromRoleType(userData.staff_roletype);
      if (role === "admin" || role === "staff") return session(role, userData, userData.staff_roletype);
      return { status: "unauthenticated", reason: "unsupported-role" };
    }
    if (userData && Object.keys(userData).length > 0) {
      const role = normalizeRoleFromRoleType(storage.getItem("roletype") ?? userData.role);
      if (role === "admin") return session("admin", userData, "3");
      if (role === "staff" || role === "dealer") return session(role, userData, storage.getItem("roletype"));
      return { status: "unauthenticated", reason: "unsupported-role" };
    }

    const admin = parseObject(storage, "AdminData") ?? parseObject(storage, "admin");
    if (admin && Object.keys(admin).length > 0) {
      const role = normalizeRoleFromRoleType(storage.getItem("roletype") ?? admin.role);
      if (role === "admin") return session("admin", admin, "3");
      return { status: "unauthenticated", reason: "unsupported-role" };
    }

    return { status: "unauthenticated", reason: "missing" };
  } catch {
    clearAuthStorage(storage);
    return { status: "unauthenticated", reason: "invalid" };
  }
}

type Policy = { pattern: RegExp; roles: AppRole[] };

const ROUTE_POLICIES: Policy[] = [
  { pattern: /^\/dashboard\/admin\/dealer\/AddDealerForm(?:\/|$)/, roles: ["admin", "staff"] },
  { pattern: /^\/dashboard\/admin\/dealer\/DealerList(?:\/|$)/, roles: ["admin", "accountant"] },
  { pattern: /^\/dashboard\/admin\/dealer\/[^/]+(?:\/|$)/, roles: ["admin", "staff"] },
  { pattern: /^\/dashboard\/admin\/ledger(?:\/|$)/, roles: ["admin", "staff", "accountant"] },
  { pattern: /^\/dashboard\/admin(?:\/|$)/, roles: ["admin"] },
  { pattern: /^\/dashboard\/staff(?:\/|$)/, roles: ["staff"] },
  { pattern: /^\/dashboard\/dealer(?:\/|$)/, roles: ["dealer"] },
  { pattern: /^\/dashboard\/accountant(?:\/|$)/, roles: ["accountant"] },
  { pattern: /^\/dashboard(?:\/|$)/, roles: ["admin", "staff", "dealer", "accountant"] },
  { pattern: /^\/Pages\/products\/addproducts(?:\/|$)/, roles: ["admin"] },
  { pattern: /^\/Pages\/products(?:\/|$)/, roles: ["admin"] },
  { pattern: /^\/Pages\/Cart(?:\/|$)/, roles: ["dealer"] },
  { pattern: /^\/Pages\/ledger(?:\/|$)/, roles: ["dealer", "admin", "staff", "accountant"] },
  { pattern: /^\/Pages\/Ordermanagement(?:\/|$)/, roles: ["admin", "staff", "dealer", "accountant"] },
  { pattern: /^\/Pages(?:\/|$)/, roles: ["admin", "staff", "dealer", "accountant"] },
  { pattern: /^\/orders(?:\/|$)/, roles: ["admin", "staff", "dealer", "accountant"] },
  { pattern: /^\/drafts(?:\/|$)/, roles: ["dealer"] },
];

export function getAllowedRoles(pathname: string): AppRole[] | null {
  const policy = ROUTE_POLICIES.find((item) => item.pattern.test(pathname));
  return policy?.roles ?? null;
}

export function canAccessRoute(role: AppRole, pathname: string) {
  const allowed = getAllowedRoles(pathname);
  return !allowed || allowed.includes(role);
}

export function getRoleHome(role: AppRole) {
  if (role === "admin") return "/dashboard/admin";
  if (role === "staff") return "/dashboard/staff";
  if (role === "dealer") return "/home";
  return "/dashboard/accountant";
}
