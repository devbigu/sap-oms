"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineBeaker,
  HiOutlineChartBarSquare,
  HiOutlineClipboardDocumentList,
  HiOutlineClock,
  HiOutlineCube,
  HiOutlineFire,
  HiOutlineShoppingCart,
  HiOutlineSquares2X2,
  HiOutlineUserGroup,
} from "react-icons/hi2";

import { broadcastAuthChange, clearStoredAuthData } from "@/lib/auth/client";
import { getDashboardRouteForRole, getLoginRouteForRole, getOrdersRouteForRole } from "@/lib/auth/navigation";
import { useAuthSession } from "@/hooks/useAuthSession";

function AccountList() {
  const router = useRouter();
  const { session, loading } = useAuthSession();
  const authSession = session;
  const role = authSession?.role ?? null;

  if (loading || !authSession || !role) return null;

  const userName =
    authSession.dealerName ??
    authSession.staffName ??
    authSession.name ??
    (role === "accountant" ? "Accountant" : role === "admin" ? "Administrator" : "Staff");

  const userEmail =
    authSession.email ??
    (role === "dealer"
      ? "dealer@omsons.com"
      : role === "accountant"
        ? "accountant@omsons.com"
        : role === "admin"
          ? "admin@omsons.com"
          : "staff@omsons.com");

  const dashboardLink = getDashboardRouteForRole(role);
  const ordersLink = getOrdersRouteForRole(role);
  const roleLabel =
    role === "admin"
      ? "Admin"
      : role === "dealer"
        ? "Dealer"
        : role === "accountant"
          ? "Accountant"
          : "Staff";

  const handleLogout = () => {
    clearStoredAuthData();
    broadcastAuthChange();
    router.push(getLoginRouteForRole(role));
    router.refresh();
  };

  const linkStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#374151",
    textDecoration: "none",
    padding: "4px 0",
    transition: "color .15s",
  };

  return (
    <div className="overflow-hidden rounded-lg bg-white text-black shadow-sm">
      <div className="w-full border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-purple-50 p-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-indigo-200 bg-indigo-100 text-sm font-semibold text-indigo-700">
              {userName.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-gray-900">{userName}</span>
              <span className="truncate text-xs text-gray-500">{userEmail}</span>
              <span className="text-xs font-medium text-indigo-600">{roleLabel}</span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <HiOutlineArrowRightOnRectangle className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-gray-100">
        <div className="px-5 py-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Quick Links</h3>
          <ul className="space-y-1">
            <li>
              <Link href="/Products" style={linkStyle} className="hover:text-indigo-600">
                <HiOutlineBeaker className="h-4 w-4 shrink-0" /> All Products
              </Link>
            </li>
            <li>
              <Link href="/categories" style={linkStyle} className="hover:text-indigo-600">
                <HiOutlineSquares2X2 className="h-4 w-4 shrink-0" /> Categories
              </Link>
            </li>
            {role === "dealer" && (
              <li>
                <Link href="/Pages/Cart" style={linkStyle} className="hover:text-indigo-600">
                  <HiOutlineShoppingCart className="h-4 w-4 shrink-0" /> My Cart
                </Link>
              </li>
            )}
            {role === "dealer" && (
              <li>
                <Link href="/dashboard/dealer/AddOrderForm" style={linkStyle} className="hover:text-indigo-600">
                  <HiOutlineClipboardDocumentList className="h-4 w-4 shrink-0" /> New Order
                </Link>
              </li>
            )}
          </ul>
        </div>

        <div className="px-5 py-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Your Account</h3>
          <ul className="space-y-1">
            <li>
              <Link href={dashboardLink} style={linkStyle} className="hover:text-indigo-600">
                <HiOutlineChartBarSquare className="h-4 w-4 shrink-0" />
                {role === "admin" ? "Admin Panel" : "Dashboard"}
              </Link>
            </li>
            <li>
              <Link href={ordersLink} style={linkStyle} className="hover:text-indigo-600">
                <HiOutlineCube className="h-4 w-4 shrink-0" /> Orders
              </Link>
            </li>
            {role !== "dealer" && (
              <li>
                <Link href="/Pages/Ordermanagement/outstandingorders" style={linkStyle} className="hover:text-indigo-600">
                  <HiOutlineClock className="h-4 w-4 shrink-0" /> Outstanding
                </Link>
              </li>
            )}
            {role === "admin" && (
              <li>
                <Link href="/dashboard/admin/dealer/DealerList" style={linkStyle} className="hover:text-indigo-600">
                  <HiOutlineUserGroup className="h-4 w-4 shrink-0" /> Dealers
                </Link>
              </li>
            )}
            {role === "admin" && (
              <li>
                <Link href="/dashboard/admin/hot-items" style={linkStyle} className="hover:text-indigo-600">
                  <HiOutlineFire className="h-4 w-4 shrink-0" /> Hot Items
                </Link>
              </li>
            )}
            {role === "staff" && (
              <li>
                <Link href="/dashboard/staff/orderstatus" style={linkStyle} className="hover:text-indigo-600">
                  <HiOutlineClipboardDocumentList className="h-4 w-4 shrink-0" /> Order Status
                </Link>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default AccountList;
