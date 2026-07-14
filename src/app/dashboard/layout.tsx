"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import DashboardSmartSearch from "@/components/dashboard/DashboardSmartSearch";
import SmartSearchBar from "@/components/SartSearchBar";
import Sidebar from "@/components/layout/sidebar";

type Role = "admin" | "dealer" | "staff" | "accountant";

type DashboardUser = {
  role?: Role;
  name?: string;
  username?: string;
  email?: string;
  id?: string;
  admin_id?: string;
  Admin_Id?: string;
  Dealer_Id?: string;
  Dealer_Name?: string;
  Dealer_City?: string;
  staff_id?: string;
  staff_name?: string;
  staff_location?: string;
  staff_designation?: string;
  staff_roletype?: string;
};

const DEMO_ACCOUNTANT_ID = "demo000000000000000000000";

function decodeJWTPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readStoredObject(key: string): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asUser(role: Role, value: Record<string, unknown> | null): DashboardUser | null {
  return value ? { role, ...(value as DashboardUser) } : null;
}

function resolveNonAccountantUser(): DashboardUser | null {
  if (typeof window === "undefined") return null;

  const staff = readStoredObject("staffData");
  if (typeof staff?.staff_id === "string" && staff.staff_id) {
    return asUser(staff.staff_roletype === "0" ? "admin" : "staff", staff);
  }

  const userData = readStoredObject("UserData");
  if (typeof userData?.Dealer_Id === "string" && userData.Dealer_Id) {
    return asUser("dealer", userData);
  }
  if (typeof userData?.staff_id === "string" && userData.staff_id) {
    return asUser(userData.staff_roletype === "0" ? "admin" : "staff", userData);
  }
  if (localStorage.getItem("roletype") === "3" && userData && Object.keys(userData).length > 0) {
    return asUser("admin", userData);
  }

  const admin = readStoredObject("AdminData") ?? readStoredObject("admin");
  if (admin && Object.keys(admin).length > 0) {
    return asUser("admin", admin);
  }

  return null;
}

function resolveInitialUser(): DashboardUser | null {
  if (typeof window === "undefined") return null;

  const token = localStorage.getItem("accountant_token");
  if (token) {
    const payload = decodeJWTPayload(token);
    const id = typeof payload?.sub === "string" ? payload.sub : undefined;

    if (id === DEMO_ACCOUNTANT_ID) {
      const accountant = readStoredObject("AccountantData");
      return asUser("accountant", accountant ?? { name: "Demo Accountant", email: "demo@omsons.com" });
    }

    const accountant = readStoredObject("AccountantData");
    if (accountant) return asUser("accountant", accountant);
  }

  return resolveNonAccountantUser();
}

let ledgerWarmupStarted = false;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<DashboardUser | null>(null);
  const router = useRouter();

  useEffect(() => {
    queueMicrotask(() => {
      setUser(resolveInitialUser());
    });
  }, []);

  useEffect(() => {
    if (ledgerWarmupStarted) return;
    ledgerWarmupStarted = true;

    void fetch("/api/ledger", { cache: "no-store" }).catch((error) => {
      console.error("[dashboard ledger preload]", error);
      ledgerWarmupStarted = false;
    });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("accountant_token");
    if (!token) return;

    const payload = decodeJWTPayload(token);
    const id = typeof payload?.sub === "string" ? payload.sub : undefined;
    if (!id || id === DEMO_ACCOUNTANT_ID) return;

    fetch(`/api/accountants/${id}`)
      .then((response) => response.json())
      .then((json) => {
        if (json.success && json.data && typeof json.data === "object") {
          setUser({ role: "accountant", ...(json.data as DashboardUser) });
          return;
        }

        const accountant = readStoredObject("AccountantData");
        if (accountant) {
          setUser({ role: "accountant", ...(accountant as DashboardUser) });
        }
      })
      .catch(() => {
        const accountant = readStoredObject("AccountantData");
        if (accountant) {
          setUser({ role: "accountant", ...(accountant as DashboardUser) });
        }
      });
  }, []);

  const role: Role = user?.role ?? "admin";

  const displayName =
    role === "accountant"
      ? user?.name || "Accountant"
      : role === "dealer"
        ? user?.Dealer_Name || "Dealer"
        : role === "staff"
          ? user?.staff_name || "Staff"
          : user?.name ?? user?.username ?? "Admin";

  const displaySub =
    role === "accountant"
      ? user?.email ?? "Finance portal"
      : role === "dealer"
        ? user?.Dealer_City ?? "Dealer dashboard"
        : role === "staff"
          ? [user?.staff_location, user?.staff_designation].filter(Boolean).join(" · ") || `ID: ${user?.staff_id ?? ""}`
          : "System administration dashboard";

  const searchPlaceholder =
    role === "admin"
      ? "Search products, orders, dealers, staff..."
      : role === "dealer"
        ? "Search products and your orders..."
        : role === "accountant"
          ? "Search orders, payments..."
          : "Search products and assigned orders...";

  const userId =
    role === "dealer"
      ? user?.Dealer_Id
      : role === "staff"
        ? user?.staff_id
        : undefined;

  const dashboardActorId =
    role === "dealer"
      ? user?.Dealer_Id
      : role === "staff"
        ? user?.staff_id
        : user?.staff_id ?? user?.id ?? user?.admin_id ?? user?.Admin_Id ?? user?.email ?? "";

  const dashboardRoleType =
    role === "admin"
      ? String(user?.staff_roletype ?? "0")
      : String(user?.staff_roletype ?? "");

  const handleLogout = () => {
    if (role === "accountant") {
      localStorage.removeItem("accountant_token");
      localStorage.removeItem("AccountantData");
      localStorage.removeItem("roletype");
      router.push("/auth/accountant-login");
      return;
    }

    localStorage.clear();
    router.push("/auth/login");
  };

  return (
    <>
      <style>{`
        .dl-topbar {
          position: sticky;
          top: 0;
          z-index: 20;
          height: 62px;
          padding: 0 22px;
          background: linear-gradient(to right, #1f4b8d, #0d0c16);
          border-bottom: 1px solid rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .dl-hamburger {
          flex-shrink: 0;
          width: 38px;
          height: 38px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.06);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: #fff;
          transition: background 0.15s;
        }
        .dl-hamburger:hover {
          background: rgba(255,255,255,0.12);
        }
        .dl-title {
          font-size: 15px;
          font-weight: 600;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dl-sub {
          font-size: 11px;
          color: rgba(255,255,255,0.5);
          margin-top: 1px;
        }
        .dl-top-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-left: auto;
          min-width: 0;
          flex: 1;
        }
        .dl-top-actions > :first-child {
          min-width: 0;
        }
        .sb-logout {
          width: 30px;
          height: 30px;
          flex-shrink: 0;
          padding: 0;
          border-radius: 9px;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.09);
          font-size: 13px;
          font-weight: 500;
          color: #475569;
          cursor: pointer;
          font-family: inherit;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all .16s;
        }
        .sb-logout:hover {
          background: rgba(239,68,68,0.1);
          border-color: rgba(239,68,68,0.28);
          color: #f87171;
        }
        @media (max-width: 900px) {
          .dl-topbar {
            padding: 0 14px;
            gap: 10px;
          }
          .dl-top-actions {
            gap: 10px;
          }
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#f0f2f5", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <Sidebar open={open} onClose={() => setOpen(false)} />

        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
          <header className="dl-topbar">
            <button
              className="dl-hamburger"
              onClick={() => setOpen((value) => !value)}
              aria-label="Toggle sidebar"
            >
              {open ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>

            <img
              src="https://omsonsapp.vercel.app/headicon.png"
              alt="Omsons"
              style={{ height: 44, flexShrink: 0 }}
            />

            <div style={{ minWidth: 0 }}>
              <div className="dl-title">{user ? `Welcome, ${displayName}` : "Dashboard"}</div>
              {displaySub && <div className="dl-sub">{displaySub}</div>}
            </div>

            <div className="dl-top-actions">
              {role === "accountant" ? (
                <SmartSearchBar
                  role={role}
                  userId={userId}
                  placeholder={searchPlaceholder}
                />
              ) : (
                <DashboardSmartSearch
                  role={role}
                  actorId={dashboardActorId}
                  roletype={dashboardRoleType}
                  placeholder={searchPlaceholder}
                />
              )}

              <button className="w-30 h-40 flex items-center justify-center hover:text-red-500" onClick={handleLogout}>
                <LogOut size={24} />
              </button>
            </div>
          </header>

          <main style={{ flex: 1 }}>{children}</main>
        </div>
      </div>
    </>
  );
}
