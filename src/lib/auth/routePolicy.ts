import type { ClientAuthRole, ClientAuthSession } from "@/lib/auth/client";
import { getDefaultRouteForRole } from "@/lib/auth/client";

export type RouteAccessPolicy = {
  requiresAuth: boolean;
  allowedRoles?: ClientAuthRole[];
  loginRoute?: "/auth/login" | "/auth/accountant-login";
  redirectAuthenticatedToDefault?: boolean;
};

const ALL_ROLES: ClientAuthRole[] = ["admin", "staff", "dealer", "accountant"];

function normalizePathname(pathname: string) {
  if (!pathname) return "/";
  if (pathname === "/") return pathname;
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function matchesExact(pathname: string, target: string) {
  return normalizePathname(pathname) === normalizePathname(target);
}

function matchesPrefix(pathname: string, prefix: string) {
  const normalizedPath = normalizePathname(pathname);
  const normalizedPrefix = normalizePathname(prefix);
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function protectedFor(allowedRoles: ClientAuthRole[], extra?: Partial<RouteAccessPolicy>): RouteAccessPolicy {
  return {
    requiresAuth: true,
    allowedRoles,
    ...extra,
  };
}

export function getRouteAccessPolicy(pathname: string): RouteAccessPolicy {
  const normalizedPath = normalizePathname(pathname);

  if (
    matchesExact(normalizedPath, "/") ||
    matchesPrefix(normalizedPath, "/auth")
  ) {
    return { requiresAuth: false };
  }

  if (matchesExact(normalizedPath, "/dashboard")) {
    return {
      requiresAuth: true,
      allowedRoles: ALL_ROLES,
      redirectAuthenticatedToDefault: true,
    };
  }

  if (matchesExact(normalizedPath, "/home")) {
    return protectedFor(["dealer"]);
  }

  if (matchesExact(normalizedPath, "/drafts")) {
    return protectedFor(["dealer"]);
  }

  if (matchesExact(normalizedPath, "/Pages/Cart")) {
    return protectedFor(["dealer"]);
  }

  if (matchesExact(normalizedPath, "/orders")) {
    return protectedFor(["dealer"]);
  }

  if (matchesPrefix(normalizedPath, "/orders/")) {
    return protectedFor(ALL_ROLES);
  }

  if (
    matchesPrefix(normalizedPath, "/Products") ||
    matchesPrefix(normalizedPath, "/search") ||
    matchesPrefix(normalizedPath, "/categories")
  ) {
    return protectedFor(ALL_ROLES);
  }

  if (matchesPrefix(normalizedPath, "/Pages/products")) {
    return protectedFor(["admin"]);
  }

  if (matchesExact(normalizedPath, "/Pages/Ordermanagement/outstandingorders")) {
    return protectedFor(["admin", "staff", "accountant"]);
  }

  if (matchesExact(normalizedPath, "/Pages/Ordermanagement")) {
    return protectedFor(ALL_ROLES);
  }

  if (matchesPrefix(normalizedPath, "/Pages/ledger")) {
    return protectedFor(ALL_ROLES);
  }

  if (matchesPrefix(normalizedPath, "/dashboard/accountant")) {
    return protectedFor(["accountant"], { loginRoute: "/auth/accountant-login" });
  }

  if (matchesExact(normalizedPath, "/dashboard/admin/dealer/AddDealerForm")) {
    return protectedFor(["admin", "staff"]);
  }

  if (matchesExact(normalizedPath, "/dashboard/admin/dealer/DealerList")) {
    return protectedFor(["admin", "accountant"]);
  }

  if (matchesPrefix(normalizedPath, "/dashboard/admin/ledger")) {
    return protectedFor(["admin", "staff", "accountant"]);
  }

  if (matchesPrefix(normalizedPath, "/dashboard/staff")) {
    return protectedFor(["staff"]);
  }

  if (matchesPrefix(normalizedPath, "/dashboard/dealer")) {
    return protectedFor(["dealer"]);
  }

  if (matchesPrefix(normalizedPath, "/dashboard/admin")) {
    return protectedFor(["admin"]);
  }

  if (matchesPrefix(normalizedPath, "/Pages")) {
    return protectedFor(ALL_ROLES);
  }

  return { requiresAuth: false };
}

export function isRoleAllowed(pathname: string, role: ClientAuthRole) {
  const policy = getRouteAccessPolicy(pathname);
  if (!policy.requiresAuth || !policy.allowedRoles || policy.allowedRoles.length === 0) {
    return true;
  }

  return policy.allowedRoles.includes(role);
}

export function buildLoginRedirect(pathname: string, search = "") {
  const policy = getRouteAccessPolicy(pathname);
  const loginRoute = policy.loginRoute ?? "/auth/login";
  const suffix = `${normalizePathname(pathname)}${search}`;
  return suffix && suffix !== "/"
    ? `${loginRoute}?next=${encodeURIComponent(suffix)}`
    : loginRoute;
}

export function getUnauthorizedRedirect(session: ClientAuthSession, pathname: string) {
  const target = getDefaultRouteForRole(session.role);
  return normalizePathname(target) === normalizePathname(pathname)
    ? "/auth/login"
    : target;
}
