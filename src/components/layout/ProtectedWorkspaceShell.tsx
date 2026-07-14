"use client";

import type { ReactNode } from "react";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import ClientRouteGuard from "@/components/auth/ClientRouteGuard";
import SmartSearchBar from "@/components/SartSearchBar";
import DashboardSmartSearch from "@/components/dashboard/DashboardSmartSearch";
import Sidebar from "@/components/layout/sidebar";
import { useAuthSession } from "@/hooks/useAuthSession";
import { broadcastAuthChange, clearStoredAuthData } from "@/lib/auth/client";
import { getLoginRouteForRole } from "@/lib/auth/navigation";

type ProtectedWorkspaceShellProps = {
  children: ReactNode;
  fallbackTitle: string;
  preloadLedger?: boolean;
};

function RouteGuardFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
        <span>Checking access...</span>
      </div>
    </div>
  );
}

export default function ProtectedWorkspaceShell({
  children,
  fallbackTitle,
  preloadLedger = false,
}: ProtectedWorkspaceShellProps) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { session, loading } = useAuthSession();

  useEffect(() => {
    if (!preloadLedger || !session || session.role === "dealer") return;
    void fetch("/api/ledger", { cache: "no-store" }).catch((error) => {
      console.error("[dashboard ledger preload]", error);
    });
  }, [preloadLedger, session]);

  const role = session?.role ?? null;
  const displayName =
    role === "accountant"
      ? session?.name || "Accountant"
      : role === "dealer"
        ? session?.dealerName || "Dealer"
        : role === "staff"
          ? session?.staffName || "Staff"
          : session?.name || "Admin";

  const displaySub =
    role === "accountant"
      ? session?.email ?? "Finance portal"
      : role === "dealer"
        ? session?.dealerCity ?? "Dealer dashboard"
        : role === "staff"
          ? [session?.staffLocation, session?.staffDesignation].filter(Boolean).join(" | ") || `ID: ${session?.staffId ?? ""}`
          : role === "admin"
            ? "System administration dashboard"
            : "";

  const searchPlaceholder =
    role === "admin"
      ? "Search products, orders, dealers, staff..."
      : role === "dealer"
        ? "Search products and your orders..."
        : role === "accountant"
          ? "Search orders, payments..."
          : "Search products and assigned orders...";

  const showDashboardLogout = pathname.startsWith("/dashboard");

  const handleLogout = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    clearStoredAuthData();
    broadcastAuthChange();
    router.push(getLoginRouteForRole(role));
    router.refresh();
    setLoggingOut(false);
  };

  return (
    <Suspense fallback={<RouteGuardFallback />}>
      <ClientRouteGuard>
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
            .dl-logout {
              width: auto;
              flex-shrink: 0;
              white-space: nowrap;
              padding: 9px 14px;
              border-radius: 11px;
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
              gap: 8px;
              transition: all .16s;
            }
            .dl-logout:hover {
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
              .dl-logout-label {
                display: none;
              }
              .dl-logout {
                padding: 9px 11px;
              }
            }
          `}</style>

          <div style={{ minHeight: "100vh", background: "#f0f2f5", fontFamily: "'DM Sans', sans-serif" }}>
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
                  <div className="dl-title">
                    {loading ? "Loading..." : session ? `Welcome, ${displayName}` : fallbackTitle}
                  </div>
                  {displaySub && <div className="dl-sub">{displaySub}</div>}
                </div>

                <div className="dl-top-actions">
                  {role === "accountant" ? (
                    <SmartSearchBar
                      role="accountant"
                      userId={session?.accountantId}
                      placeholder={searchPlaceholder}
                    />
                  ) : role ? (
                    <DashboardSmartSearch
                      role={role}
                      actorId={session?.dealerId ?? session?.staffId ?? session?.adminId ?? session?.userId}
                      roletype={session?.roletype}
                      placeholder={searchPlaceholder}
                    />
                  ) : null}

                  {showDashboardLogout ? (
                    <button className="dl-logout" onClick={handleLogout} disabled={loggingOut}>
                      <LogOut size={14} />
                      <span className="dl-logout-label">{loggingOut ? "Signing out..." : "Sign out"}</span>
                    </button>
                  ) : null}
                </div>
              </header>

              <main style={{ flex: 1 }}>{children}</main>
            </div>
          </div>
        </>
      </ClientRouteGuard>
    </Suspense>
  );
}
