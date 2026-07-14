import type { ClientAuthRole } from "@/lib/auth/client";
import { getDefaultRouteForRole } from "@/lib/auth/client";

export function getLogoRouteForRole(role: ClientAuthRole | null) {
  return role ? getDefaultRouteForRole(role) : "/auth/login";
}

export function getDashboardRouteForRole(role: ClientAuthRole | null) {
  if (role === "dealer") return "/dashboard/dealer";
  if (role === "staff") return "/dashboard/staff";
  if (role === "accountant") return "/dashboard/accountant";
  return "/dashboard/admin";
}

export function getOrdersRouteForRole(role: ClientAuthRole | null) {
  return role === "dealer" ? "/orders" : "/Pages/Ordermanagement";
}

export function getLoginRouteForRole(role: ClientAuthRole | null) {
  return role === "accountant" ? "/auth/accountant-login" : "/auth/login";
}
