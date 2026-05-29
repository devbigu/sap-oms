"use client";

import { useState, useEffect } from "react";

import Sidebar from "@/components/layout/sidebar";
import SmartSearchBar from "@/components/SartSearchBar";
type Role = "admin" | "dealer" | "staff" | "accountant";

const DEMO_ACCOUNTANT_ID = "demo000000000000000000000";

function decodeJWTPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function resolveNonAccountantUser(): any {
  if (typeof window === "undefined") return null;
  try {
    const staffRaw = localStorage.getItem("staffData");
    if (staffRaw) {
      const p = JSON.parse(staffRaw);
      if (p?.staff_id) return { role: (p.staff_roletype === "0" ? "admin" : "staff") as Role, ...p };
    }
    const userData = localStorage.getItem("UserData");
    if (userData) {
      const p = JSON.parse(userData);
      if (p?.Dealer_Id) return { role: "dealer" as Role, ...p };
      if (p?.staff_id) return { role: (p.staff_roletype === "0" ? "admin" : "staff") as Role, ...p };
      if (localStorage.getItem("roletype") === "3" && p && Object.keys(p).length > 0)
        return { role: "admin" as Role, ...p };
    }
    const adminRaw = localStorage.getItem("AdminData") || localStorage.getItem("admin");
    if (adminRaw) {
      const p = JSON.parse(adminRaw);
      if (p && Object.keys(p).length > 0) return { role: "admin" as Role, ...p };
    }
  } catch (_) { }
  return null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const token = localStorage.getItem("accountant_token");
    if (token) {
      const payload = decodeJWTPayload(token);
      const id = payload?.sub as string | undefined;

      if (id === DEMO_ACCOUNTANT_ID) {
        // Demo account has no DB record — use localStorage
        try {
          const raw = localStorage.getItem("AccountantData");
          const data = raw ? JSON.parse(raw) : { name: "Demo Accountant", email: "demo@omsons.com" };
          setUser({ role: "accountant", ...data });
        } catch {
          setUser({ role: "accountant", name: "Demo Accountant", email: "demo@omsons.com" });
        }
        return;
      }

      if (id) {
        // Real accountant — fetch fresh from MongoDB
        fetch(`/api/accountants/${id}`)
          .then(r => r.json())
          .then(json => {
            if (json.success) {
              setUser({ role: "accountant", ...json.data });
            } else {
              // Fallback to localStorage if API fails
              try {
                const raw = localStorage.getItem("AccountantData");
                if (raw) setUser({ role: "accountant", ...JSON.parse(raw) });
              } catch { /* ignore */ }
            }
          })
          .catch(() => {
            try {
              const raw = localStorage.getItem("AccountantData");
              if (raw) setUser({ role: "accountant", ...JSON.parse(raw) });
            } catch { /* ignore */ }
          });
        return;
      }
    }

    setUser(resolveNonAccountantUser());
  }, []);

  const role: Role = user?.role ?? "admin";

  // ── Display name — matches embedded logic per role ──
  const displayName =
    role === "accountant" ? (user?.name || "Accountant") :
    role === "dealer"     ? (user?.Dealer_Name || "Dealer") :
    role === "staff"      ? (user?.staff_name || "Staff") :
      user?.name ?? user?.username ?? "Admin";

  // ── Subtitle ──
  const displaySub =
    role === "accountant" ? (user?.email ?? "Finance portal") :
    role === "dealer"     ? user?.Dealer_City ?? "Dealer dashboard" :
    role === "staff"      ? [user?.staff_location, user?.staff_designation].filter(Boolean).join(" · ") || `ID: ${user?.staff_id ?? ""}` :
      "System administration dashboard";

  // ── Per-role search placeholder ──
  const searchPlaceholder =
    role === "admin"       ? "Search orders, dealers, staff…" :
    role === "dealer"      ? "Search orders, products…" :
    role === "accountant"  ? "Search orders, payments…" :
      "Search orders, dealers…";

  // ── User ID for API calls that need an id param ──
  const userId =
    role === "dealer" ? user?.Dealer_Id :
      role === "staff" ? user?.staff_id :
        undefined;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

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
          width: 38px; height: 38px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.06);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: #fff;
          transition: background .15s;
        }
        .dl-hamburger:hover { background: rgba(255,255,255,0.12); }
        .dl-title { font-size: 15px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dl-sub   { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 1px; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "#f0f2f5", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

        <Sidebar open={open} onClose={() => setOpen(false)} />

        <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>

          {/* ── Topbar ── */}
          <header className="dl-topbar">

            {/* Hamburger */}
            <button
              className="dl-hamburger"
              onClick={() => setOpen((v) => !v)}
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

            {/* Logo */}
            <img
              src="https://omsonsapp.vercel.app/headicon.png"
              alt="Omsons"
              style={{ height: 44, flexShrink: 0 }}
            />

            {/* Welcome + subtitle */}
            <div style={{ minWidth: 0 }}>
              <div className="dl-title">
                {user ? `Welcome, ${displayName}` : "Dashboard"}
              </div>
              {displaySub && <div className="dl-sub">{displaySub}</div>}
            </div>

            {/* ── Smart Search (replaces original dumb search box) ── */}
            <SmartSearchBar
              role={role}
              userId={userId}
              placeholder={searchPlaceholder}
            />

          </header>

          {/* Page content */}
          <main style={{ flex: 1 }}>
            {children}
          </main>

        </div>
      </div>
    </>
  );
}