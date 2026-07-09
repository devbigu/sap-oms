"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, UserRoundPlus, Users, SquareUser,
  Plus, ClipboardList, Home, LogOut, Package, Images,
  ShieldCheck, Gift, Receipt, TrendingUp, BookOpen, FileText,
  Wallet,
} from "lucide-react";

type Role    = "admin" | "dealer" | "staff" | "accountant";
type NavItem = { label: string; href: string; icon: React.ReactNode; section?: string };
type SidebarUser = {
  role: Role;
  name?: string;
  username?: string;
  email?: string;
  Dealer_Name?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_Dealercode?: string;
  staff_name?: string;
  staff_email?: string;
  staff_roletype?: string;
};

const NAV: Record<Role, NavItem[]> = {
  admin: [
    { section: "Overview",    label: "Dashboard",          href: "/dashboard/admin",                                 icon: <LayoutDashboard size={15} /> },
    {                         label: "Profile",            href: "/dashboard/admin/profile",                         icon: <SquareUser size={15} />      },
    { section: "Dealers",     label: "Dealer List",        href: "/dashboard/admin/dealer/DealerList",               icon: <Users size={15} />           },
    {                         label: "Dealer Ledger",       href: "/dashboard/admin/ledger",                          icon: <BookOpen size={15} />        },
    {                         label: "Add Dealer",          href: "/dashboard/admin/dealer/AddDealerForm",            icon: <UserRoundPlus size={15} />   },
    { section: "Staff",       label: "Staff List",         href: "/dashboard/admin/staff/stafflist",                 icon: <Users size={15} />           },
    {                         label: "Add Staff",           href: "/dashboard/admin/staff/addstaff",                  icon: <SquareUser size={15} />      },
    { section: "Products",    label: "Products",           href: "/Pages/products",                                  icon: <Package size={15} />         },
    {                         label: "Add Product",         href: "/Pages/products/addproducts",                      icon: <Plus size={15} />            },
    { section: "Orders",      label: "Order List",         href: "/Pages/Ordermanagement",                           icon: <ClipboardList size={15} />   },
    {                         label: "Pending Orders",      href: "/Pages/Ordermanagement/outstandingorders",         icon: <ClipboardList size={15} />   },
    {                         label: "Discount Approvals",  href: "/dashboard/admin/custom-discount-approvals",       icon: <Receipt size={15} />         },
    { section: "Content",     label: "Slider Images",      href: "/dashboard/admin/slider",                          icon: <Images size={15} />          },
    {                         label: "Hot Items",           href: "/dashboard/admin/hot-items",                       icon: <Images size={15} />          },
    { section: "Reports",     label: "Dealer Category Report", href: "/dashboard/admin/reports/dealer-category",     icon: <TrendingUp size={15} />      },
    { section: "Accountants", label: "Manage Accountants", href: "/dashboard/admin/manageAccountants/add-account",   icon: <ShieldCheck size={15} />     },
    { section: "Rewards",     label: "Dealer Rewards",     href: "/dashboard/admin/rewards",                         icon: <Gift size={15} />            },
  ],
  dealer: [
    { section: "Home",     label: "Home",             href: "/home",                          icon: <Home size={15} />          },
    {                      label: "Dashboard",         href: "/dashboard/dealer",              icon: <LayoutDashboard size={15} /> },
    {                      label: "Profile",           href: "/dashboard/dealer/profile",      icon: <SquareUser size={15} />      },
    { section: "Orders",   label: "My Order Status",  href: "/Pages/Ordermanagement",         icon: <ClipboardList size={15} /> },
    {                      label: "My Order History",  href: "/orders",                        icon: <ClipboardList size={15} /> },
    {                      label: "Add Order",         href: "/dashboard/dealer/AddOrderForm", icon: <Plus size={15} />          },
    {                      label: "Saved Drafts",      href: "/drafts",                        icon: <FileText size={15} />      },
    {                      label: "Approved Discounts", href: "/dashboard/dealer/approved-discounts", icon: <Receipt size={15} /> },
    { section: "Finance",  label: "My Ledger",         href: "/Pages/ledger",                  icon: <Wallet size={15} />        },
    { section: "Products", label: "Products",         href: "/Pages/products",                icon: <Package size={15} />       },
  ],
  staff: [
    { section: "Overview", label: "Dashboard",     href: "/dashboard/staff",                                icon: <LayoutDashboard size={15} /> },
    {                     label: "Profile",       href: "/dashboard/staff/profile",                        icon: <SquareUser size={15} />      },
    {                     label: "Discount Requests", href: "/dashboard/staff/discount-requests",           icon: <Receipt size={15} />         },
    { section: "Orders",   label: "Order List",    href: "/Pages/Ordermanagement",                          icon: <ClipboardList size={15} />   },
    {                      label: "Pending Orders", href: "/Pages/Ordermanagement/outstandingorders",        icon: <ClipboardList size={15} />   },
    { section: "Dealers",  label: "Dealer List",   href: "/dashboard/admin/dealer/DealerList",              icon: <Users size={15} />           },
    {                      label: "Dealer Ledger",  href: "/dashboard/admin/ledger",                         icon: <BookOpen size={15} />        },
    { section: "Reports",  label: "Dealer Category Report", href: "/dashboard/staff/reports/dealer-category", icon: <TrendingUp size={15} />      },
  ],
  accountant: [
    { section: "Overview",  label: "Dashboard",      href: "/dashboard/accountant",                         icon: <LayoutDashboard size={15} /> },
    { section: "Orders",    label: "All Orders",     href: "/Pages/Ordermanagement",                        icon: <ClipboardList size={15} />   },
    {                       label: "Pending Orders",  href: "/Pages/Ordermanagement/outstandingorders",      icon: <Receipt size={15} />         },
    { section: "Finance",   label: "Order Book",     href: "/dashboard/accountant/order-book",              icon: <BookOpen size={15} />        },
    {                       label: "Dealer Ledger",   href: "/dashboard/admin/ledger",                       icon: <Wallet size={15} />          },
    {                       label: "Reports",        href: "/dashboard/accountant",                          icon: <TrendingUp size={15} />      },
    { section: "Dealers",   label: "Dealer List",   href: "/dashboard/admin/dealer/DealerList",             icon: <Users size={15} />           },
  ],
};

function resolveUser() {
  if (typeof window === "undefined") return null;
  try {
    // Accountant session takes priority when the token is present
    const acctToken = localStorage.getItem("accountant_token");
    if (acctToken) {
      const acct = localStorage.getItem("AccountantData");
      if (acct) { const p = JSON.parse(acct); return { role: "accountant" as Role, ...p }; }
    }
    const d = localStorage.getItem("UserData");
    if (d) {
      const p = JSON.parse(d);
      if (p?.Dealer_Id) return { role: "dealer" as Role, ...p };
      if (p?.staff_id) return { role: (p.staff_roletype === "0" ? "admin" : "staff") as Role, ...p };
      if (localStorage.getItem("roletype") === "3" && p && Object.keys(p).length > 0)
        return { role: "admin" as Role, ...p };
    }
    const s = localStorage.getItem("staffData");
    if (s) { const p = JSON.parse(s); if (p?.staff_id) return { role: "staff" as Role, ...p }; }
    const a = localStorage.getItem("AdminData") || localStorage.getItem("admin");
    if (a) { const p = JSON.parse(a); return { role: "admin" as Role, ...p }; }
  } catch {}
  return null;
}

function getInitials(name?: string) {
  if (!name?.trim()) return "AD";
  return name.trim().split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function staffRoleLabel(rt?: string) {
  return rt === "0" ? "Admin" : rt === "1" ? "Executive" : rt === "2" ? "Field Executive" : "Staff";
}

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname              = usePathname();
  const router                = useRouter();
  const [user,    setUser]    = useState<SidebarUser | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setUser(resolveUser());
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const role: Role = user?.role ?? "admin";

  const name =
    role === "dealer"     ? user?.Dealer_Name :
    role === "staff"      ? user?.staff_name  :
    role === "accountant" ? user?.name        :
    user?.name ?? user?.username ?? "Administrator";

  const meta =
    role === "dealer"     ? (user?.Dealer_Email ?? user?.Dealer_Number ?? "") :
    role === "staff"      ? (user?.staff_email ?? "")                         :
    role === "accountant" ? (user?.email ?? "")                               :
    (user?.email ?? "admin@omsons.com");

  const badge =
    role === "dealer"     ? user?.Dealer_Dealercode          :
    role === "staff"      ? staffRoleLabel(user?.staff_roletype) :
    role === "accountant" ? "Accountant"                     :
    user?.role ?? "Administrator";

  const portal =
    role === "admin"      ? "Admin Portal"      :
    role === "dealer"     ? "Dealer Portal"     :
    role === "accountant" ? "Finance Portal"    :
    "Staff Portal";

  const handleLogout = () => {
    if (role === "accountant") {
      localStorage.removeItem("accountant_token");
      localStorage.removeItem("AccountantData");
      localStorage.removeItem("roletype");
      router.push("/auth/accountant-login");
    } else {
      localStorage.clear();
      router.push("/auth/login");
    }
  };

  // Group nav by section
  const grouped: { section?: string; items: NavItem[] }[] = [];
  (NAV[role] ?? NAV.admin).forEach(item => {
    if (item.section) {
      grouped.push({ section: item.section, items: [item] });
    } else {
      const last = grouped[grouped.length - 1];
      if (last) last.items.push(item);
    }
  });

  return (
    <>
      <style>{`
        .sb-overlay {
          position: fixed; inset: 0; z-index: 30;
          background: rgba(0,0,0,0.5); backdrop-filter: blur(3px);
          opacity: 0; pointer-events: none;
          transition: opacity .28s;
        }
        .sb-overlay.show { opacity: 1; pointer-events: all; }

        .sb-panel {
          position: fixed; top: 0; left: 0; bottom: 0;
          width: 256px; z-index: 40;
          background: #0d0c16;
          display: flex; flex-direction: column;
          transform: translateX(-100%);
          transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
          will-change: transform;
        }
        .sb-panel.open { transform: translateX(0); }

        /* Head */
        .sb-head { padding: 26px 22px 18px; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .sb-chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; background: rgba(99,102,241,0.16); color: #818cf8; font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px; }
        .sb-title { font-size: 17px; font-weight: 600; color: #fff; letter-spacing: -.3px; }

        /* User card */
        .sb-user { margin: 14px 14px 0; padding: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; }
        .sb-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 8px; }
        .sb-uname { font-size: 13px; font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-meta  { font-size: 10.5px; color: #475569; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-role  { margin-top: 6px; display: inline-block; font-size: 10px; font-family: monospace; background: rgba(99,102,241,0.18); color: #a5b4fc; padding: 2px 8px; border-radius: 6px; }

        /* Nav */
        .sb-nav { flex: 1; padding: 10px; margin-top: 10px; overflow-y: auto; }
        .sb-nav::-webkit-scrollbar { width: 4px; }
        .sb-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }

        .sb-section { font-size: 9.5px; font-weight: 700; color: #334155; text-transform: uppercase; letter-spacing: .1em; padding: 10px 13px 4px; }

        .sb-link { display: flex; align-items: center; gap: 11px; padding: 10px 13px; border-radius: 11px; font-size: 13.5px; font-weight: 500; color: #64748b; text-decoration: none; margin-bottom: 2px; transition: background .16s, color .16s; }
        .sb-link:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
        .sb-link.active { background: rgba(99,102,241,0.18); color: #a5b4fc; }
        .sb-link-dot { width: 5px; height: 5px; border-radius: 50%; background: #6366f1; margin-left: auto; flex-shrink: 0; opacity: 0; transition: opacity .15s; }
        .sb-link.active .sb-link-dot { opacity: 1; }

        /* Footer */
        .sb-foot { padding: 14px; border-top: 1px solid rgba(255,255,255,0.07); }
        .sb-logout { width: 100%; padding: 9px 14px; border-radius: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.09); font-size: 13px; font-weight: 500; color: #475569; cursor: pointer; font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all .16s; }
        .sb-logout:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.28); color: #f87171; }
      `}</style>

      {/* Overlay */}
      <div
        className={`sb-overlay${open ? " show" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside className={`sb-panel${open ? " open" : ""}`}>

        {/* Head */}
        <div className="sb-head">
          <div className="sb-chip">{portal}</div>
          <div className="sb-title">Workspace</div>
        </div>

        {/* User card */}
        <div className="sb-user">
          <div className="sb-avatar">
            {mounted ? getInitials(name) : "…"}
          </div>
          <div className="sb-uname">
            {mounted ? (name ?? "Administrator") : "Loading…"}
          </div>
          <div className="sb-meta">
            {mounted ? meta : ""}
          </div>
          {mounted && badge && (
            <span className="sb-role">{badge}</span>
          )}
        </div>

        {/* Nav */}
        <nav className="sb-nav">
          {grouped.map((group, gi) => (
            <div key={gi}>
              {group.section && (
                <div className="sb-section">{group.section}</div>
              )}
              {group.items.map(item => {
                const active =
                  pathname === item.href ||
                  (item.href.length > 1 && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`sb-link${active ? " active" : ""}`}
                  >
                    {item.icon}
                    {item.label}
                    <span className="sb-link-dot" />
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sb-foot">
          <button className="sb-logout" onClick={handleLogout}>
            <LogOut size={14} />
            Sign out
          </button>
        </div>

      </aside>
    </>
  );
}
