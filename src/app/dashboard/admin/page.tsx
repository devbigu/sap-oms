"use client";

import Link from "next/link";
import { LayoutDashboard, UserRoundPlus, Users, SquareUser, Plus, ClipboardList, Search } from 'lucide-react';

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  useQuery,
  useQueries,
} from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fetchDealerStatusOverrides, normalizeDealerStatus, type DealerStatusDocument } from "@/lib/dealerStatus";
import PendingProductsPreview from "@/components/dashboard/PendingProductsPreview";
import { clearAuthStorage } from "@/lib/roleAccess";
import { filterActiveOrders } from "@/lib/activeOrderPeriod.js";

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";
const year = new Date().getFullYear();

type Item = {
  order_id: string;
  total: string;
};

type Dealer = {
  Dealer_Name: string;
  total: string;
};

type AdminStats = {
  dealerCount: number;
  staffCount: number;
  orderCount: number;
  PorderCount: number;
};

type AdminUser = {
  username?: string;
  email?: string;
  role?: string;
  name?: string;
};

type DealerSummary = {
  Dealer_Id: string;
  Dealer_Name: string;
  Dealer_City: string;
  Dealer_Number?: string;
  Dealer_Dealercode?: string;
  status: string;
  assignedstaff?: string;
  staffname?: string;
  currentlimit: string;
};

type DealerPaginationResponse = {
  data: DealerSummary[];
  total?: number;
  last_page?: number;
};

type StaffSummary = {
  staff_roletype: string;
};

type LedgerSummary = {
  Dealer_Id: string;
  Dealer_Name: string;
  netBalance: number;
  walletBalance: number;
};

type DiscountApproval = {
  status: string;
};

type PendingOrderRecord = {
  order_id: string;
  Dealer_Name?: string;
  order_date?: string;
  orderDate?: string;
  order_amount?: string | number;
  total?: string | number;
  outstandingDate?: string;
  order_status?: string;
  accept_order?: string;
};

const logoImage = "https://omsonsapp.vercel.app/headicon.png";


const NAV_ITEMS = [
  {
    label: "Dealer List",
    href: "/dashboard/admin/dealer/DealerList",
    icon: <LayoutDashboard />
  },
  {
    label: "Add Dealer",
    href: "/dashboard/admin/dealer/AddDealerForm",
    icon: <UserRoundPlus />
  },
  {
    label: "Staff List",
    href: "/dashboard/admin/staff/stafflist",
    icon: <Users />
  },
  {
    label: "Add Staff",
    href: "/dashboard/admin/staff/addstaff",
    icon: <SquareUser />
  },
  {
    label: "Products  ",
    href: "/Pages/products",
    icon: <SquareUser />
  },
  {
    label: "Add products",
    href: "/Pages/products/addproducts",
    icon: <SquareUser />
  },
  { label: "Order List",
     href: "/Pages/Ordermanagement", 
     icon: <ClipboardList size={15} /> 
  },
  { label: "Dealer Category Report",
     href: "/dashboard/admin/reports/dealer-category",
    icon: <ClipboardList size={15} /> 
  },
  { label: "Pending Orders",
     href: "/Pages/Ordermanagement/outstandingorders",
    icon: <ClipboardList size={15} /> 
  },
];

const STAT_CONFIG = [
  { key: "PorderCount", label: "Pending Orders", color: "#f59e0b" },
  { key: "dealerCount", label: "Total Distributors", color: "#10b981" },
  { key: "orderCount", label: "Total Orders", color: "#3b82f6" },
  { key: "staffCount", label: "Total Staff", color: "#8b5cf6" },
];

const dashboardQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 2,
    },
  },
});

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  return parseJsonResponse<T>(res);
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/^\s*</.test(text)) throw new Error("Expected JSON but received HTML");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Invalid JSON response");
  }
}

export default function AdminDashboard() {
  return (
    <QueryClientProvider client={dashboardQueryClient}>
      <AdminDashboardInner />
    </QueryClientProvider>
  );
}

function AdminDashboardInner() {
  const router = useRouter();
  const pathname = usePathname();

  const [data, setData] = useState<Item[]>([]);
  const [dealerData, setDealerData] = useState<Dealer[]>([]);
  const [adminData, setAdminData] = useState<AdminStats>({
    dealerCount: 0,
    staffCount: 0,
    orderCount: 0,
    PorderCount: 0,
  });
  const [adminUser, setAdminUser] = useState<AdminUser>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [distributorPage, setDistributorPage] = useState(1);
  const [distributorSearchInput, setDistributorSearchInput] = useState("");
  const [distributorSearch, setDistributorSearch] = useState("");

  // Load admin user from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const adminRaw = localStorage.getItem("AdminData") || localStorage.getItem("admin") || "{}";
      const adminParsed: AdminUser = JSON.parse(adminRaw);
      setAdminUser(adminParsed);
    } catch (err) {
      console.error("Error loading admin data from localStorage:", err);
    }
  }, []);

  // Fetch dashboard data
  useEffect(() => {
    async function fetchData() {
      try {
        const [activeOrdersRes, activePendingRes, dealerRes, staffRes] = await Promise.all([
          fetch(`/api/active-orders?source=orderpegination&role=admin&page=1&limit=1000&search=`),
          fetch(`/api/active-orders?source=orderpeginationnew&role=admin&page=1&limit=1&search=`),
          fetch(`${BACKEND_URL}/getMonthlyreporttopdealer`),
          fetch(`${BACKEND_URL}/dealercount`),
        ]);

        const activeOrdersJson = await parseJsonResponse<any>(activeOrdersRes);
        const activePendingJson = await parseJsonResponse<any>(activePendingRes);
        const dealerJson = await parseJsonResponse<any>(dealerRes);
        const staffJson = await parseJsonResponse<any>(staffRes);

        const activeOrders = filterActiveOrders<any>(activeOrdersJson.data || []);
        setData(activeOrders
          .map((order) => ({ order_id: String(order.order_id || ""), total: String(order.order_net_amount ?? order.order_discount ?? order.order_amount ?? 0) }))
          .sort((left, right) => Number(right.total) - Number(left.total))
          .slice(0, 10));
        setDealerData(dealerJson.top || []);

        // Handle staffJson.data - could be array or object
        const statsData = Array.isArray(staffJson.data) ? staffJson.data[0] : staffJson.data;
        setAdminData({ ...(statsData || {
          dealerCount: 0,
          staffCount: 0,
          orderCount: 0,
          PorderCount: 0,
        }), orderCount: Number(activeOrdersJson.total ?? activeOrders.length), PorderCount: Number(activePendingJson.total ?? 0) });
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const [
    outstandingOrdersQ,
    discountApprovalsQ,
    ledgerQ,
    dealersQ,
    distributorsCountQ,
    staffQ,
  ] = useQueries({
    queries: [
      {
        queryKey: ["adminSidebarSummary", "outstandingOrders"],
        queryFn: async () => {
          const result = await fetchJson<{ data: PendingOrderRecord[] }>(`/api/active-orders?source=orderpeginationnew&role=admin&page=1&limit=1000&search=`);
          return { ...result, data: filterActiveOrders(result.data) };
        },
      },
      {
        queryKey: ["adminSidebarSummary", "discountApprovals"],
        queryFn: () => fetchJson<{ data: DiscountApproval[] }>("/api/custom-discount-requests?limit=200"),
      },
      {
        queryKey: ["adminSidebarSummary", "ledger"],
        queryFn: () => fetchJson<{ data: LedgerSummary[] }>("/api/ledger"),
      },
      {
        queryKey: ["adminSidebarSummary", "dealers"],
        queryFn: () => fetchJson<{ data: DealerSummary[]; total?: number }>(`${BACKEND_URL}/dealerpegination?page=1&limit=1000&search=`),
      },
      {
        queryKey: ["adminSidebarSummary", "distributorCount"],
        queryFn: () => fetchJson<{ data: DealerSummary[]; total?: number }>(`${BACKEND_URL}/dealerpegination?page=1&limit=1&search=`),
      },
      {
        queryKey: ["adminSidebarSummary", "staff"],
        queryFn: () => fetchJson<{ data: StaffSummary[]; count?: number }>(`${BACKEND_URL}/staffpegination?page=1&limit=200&search=`),
      },
    ],
  });

  const { data: statusOverrides } = useQuery<DealerStatusDocument[]>({
    queryKey: ["adminSidebarSummary", "dealerStatuses"],
    queryFn: fetchDealerStatusOverrides,
    staleTime: 5 * 60 * 1000,
  });

  const summaryLoading = [outstandingOrdersQ, discountApprovalsQ, ledgerQ, dealersQ, distributorsCountQ, staffQ].some(q => q.isLoading);
  const summaryError = [outstandingOrdersQ, discountApprovalsQ, ledgerQ, dealersQ, distributorsCountQ, staffQ].find(q => q.isError);
  const retrySummary = () => {
    outstandingOrdersQ.refetch();
    discountApprovalsQ.refetch();
    ledgerQ.refetch();
    dealersQ.refetch();
    distributorsCountQ.refetch();
    staffQ.refetch();
  };

  const {
    data: distributorResponse,
    isLoading: distributorsLoading,
    isError: distributorsError,
  } = useQuery<DealerPaginationResponse>({
    queryKey: ["adminDashboardDistributors", distributorPage, distributorSearch],
    queryFn: () => fetchJson<DealerPaginationResponse>(`${BACKEND_URL}/dealerpegination?page=${distributorPage}&search=${distributorSearch}`),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDistributorPage(1);
      setDistributorSearch(distributorSearchInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [distributorSearchInput]);

  const outstandingOrders = (outstandingOrdersQ.data?.data ?? []).filter((o) => o.order_status === "0" || o.accept_order === "0");
  const pendingApprovals = (discountApprovalsQ.data?.data ?? []).filter(r => r.status === "pending").length;
  const statusMap = useMemo(() => new Map(
    (statusOverrides ?? []).map((row) => [String(row.dealerId), normalizeDealerStatus(row.status)])
  ), [statusOverrides]);
  const dealerRows = useMemo(() => (dealersQ.data?.data ?? []).map((dealer) => ({
    ...dealer,
    status: statusMap.get(String(dealer.Dealer_Id)) ?? normalizeDealerStatus(dealer.status),
  })), [dealersQ.data?.data, statusMap]);
  const activeDealers = dealerRows.filter(d => normalizeDealerStatus(d.status) === "active").length;
  const inactiveDealers = dealerRows.filter(d => normalizeDealerStatus(d.status) !== "active").length;
  const staffRows = staffQ.data?.data ?? [];
  const roleCounts = staffRows.reduce((acc, s) => {
    acc[s.staff_roletype || "unknown"] = (acc[s.staff_roletype || "unknown"] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const ledgerRows = ledgerQ.data?.data ?? [];
  const outstandingExposure = dealerRows.reduce((sum, row) => sum + Math.max(0, Number(row.currentlimit) || 0), 0);
  const highExposureDealers = [...dealerRows]
    .sort((a, b) => (Number(b.currentlimit) || 0) - (Number(a.currentlimit) || 0))
    .slice(0, 5);
  const totalDistributors = distributorsCountQ.data?.total ?? dealerRows.length;
  const distributorRows = useMemo(() => (distributorResponse?.data ?? []).map((dealer) => ({
    ...dealer,
    status: statusMap.get(String(dealer.Dealer_Id)) ?? normalizeDealerStatus(dealer.status),
  })), [distributorResponse?.data, statusMap]);
  const distributorTotal = distributorResponse?.total ?? ((distributorPage - 1) * 10 + distributorRows.length);
  const distributorTotalPages = distributorResponse?.last_page ?? Math.max(1, Math.ceil(distributorTotal / 10));
  const distributorStartIndex = distributorRows.length > 0 ? (distributorPage - 1) * 10 + 1 : 0;
  const distributorEndIndex = distributorRows.length > 0 ? (distributorPage - 1) * 10 + distributorRows.length : 0;

  const distributorPageNumbers = (): (number | "...")[] => {
    const pages: (number | "...")[] = [];
    if (distributorTotalPages <= 7) {
      for (let i = 1; i <= distributorTotalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (distributorPage > 3) pages.push("...");
      for (let i = Math.max(2, distributorPage - 1); i <= Math.min(distributorTotalPages - 1, distributorPage + 1); i++) pages.push(i);
      if (distributorPage < distributorTotalPages - 2) pages.push("...");
      pages.push(distributorTotalPages);
    }
    return pages;
  };

  const handleDistributorPageChange = (newPage: number) => {
    if (newPage < 1 || newPage > distributorTotalPages) return;
    setDistributorPage(newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const chartData = data.map((item) => ({
    name: `${item.order_id}`,
    value: Number(item.total),
  }));

  const dealerChartData = dealerData.map((dealer) => ({
    name: dealer.Dealer_Name.substring(0, 12),
    value: Number(dealer.total),
  }));

  const handleLogout = () => {
    clearAuthStorage(localStorage);
    window.dispatchEvent(new Event("omsons-auth-changed"));
    router.push("/auth/login");
  };

  const initials = (adminUser.name || adminUser.username || "Admin")
    .split(" ")
    .map((n: string) => n.charAt(0))
    .join("")
    .toUpperCase()
    .substring(0, 2) || "AD";

  
  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; }
        .root { min-height: 100vh; background: #f0f2f5; color: #111827; font-family: 'DM Sans', sans-serif; }

        /* ── Sidebar ─────────────────────────────── */
        .sidebar {
          position: fixed;
          top: 0; left: 0; bottom: 0;
          width: 256px;
          z-index: 40;
          background: #0d0c16;
          display: flex;
          flex-direction: column;
          transform: translateX(-100%);
          transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform;
        }
        .sidebar.open { transform: translateX(0); }

        .sb-head { padding: 26px 22px 18px; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .sb-chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; background: rgba(99,102,241,0.16); color: #818cf8; font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px; }
        .sb-title { font-size: 17px; font-weight: 600; color: #fff; letter-spacing: -.3px; }

        .sb-user { margin: 14px 14px 0; padding: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; }
        .sb-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 8px; }
        .sb-uname { font-size: 13px; font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-meta  { font-size: 10.5px; color: #475569; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sb-role  { margin-top: 6px; display: inline-block; font-size: 10px; font-family: 'DM Mono', monospace; background: rgba(99,102,241,0.18); color: #a5b4fc; padding: 2px 8px; border-radius: 6px; }

        .sb-nav { flex: 1; padding: 10px; margin-top: 10px; overflow-y: auto; }
        .sb-link { display: flex; align-items: center; gap: 11px; padding: 10px 13px; border-radius: 11px; font-size: 13.5px; font-weight: 500; color: #64748b; text-decoration: none; margin-bottom: 2px; transition: background .16s, color .16s; }
        .sb-link:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
        .sb-link.active { background: rgba(99,102,241,0.18); color: #a5b4fc; }

        .sb-foot { padding: 14px; border-top: 1px solid rgba(255,255,255,0.07); }
        .sb-logout { width: 100%; padding: 9px 14px; border-radius: 11px; background: transparent; border: 1px solid rgba(255,255,255,0.09); font-size: 13px; font-weight: 500; color: #475569; cursor: pointer; font-family: inherit; transition: all .16s; }
        .sb-logout:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.28); color: #f87171; }

        /* ── Overlay ─────────────────────────────── */
        .overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.5); backdrop-filter: blur(3px); opacity: 0; pointer-events: none; transition: opacity .28s; }
        .overlay.show { opacity: 1; pointer-events: all; }

        /* ── Main ────────────────────────────────── */
        .main { transition: padding-left .28s cubic-bezier(.4,0,.2,1); }

        /* ── Topbar ──────────────────────────────── */
        .topbar { position: sticky; top: 0; z-index: 20; height: 62px; padding: 0 22px; background: linear-gradient(to right, #1f4b8dff, #0d0c16); backdrop-filter: blur(18px); border-bottom: 1px solid #e0e3e8; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .topbar-l { display: flex; align-items: center; gap: 13px; min-width: 0; }
        .hamburger { flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px; border: 1px solid #dde1e8; background: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #374151; transition: background .15s; }
        .hamburger:hover { background: #f3f4f6; }
        .topbar-title { font-size: 15px; font-weight: 600; color: #ffffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .topbar-sub   { font-size: 11px; color: #ffffffff; letter-spacing: .04em; margin-top: 1px; }
        .btn-add { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 22px; background: #0d0c16; color: #fff; font-size: 13px; font-weight: 500; text-decoration: none; transition: opacity .16s, transform .16s; white-space: nowrap; }
        .btn-add:hover { opacity: .82; transform: translateY(-1px); }

        /* ── Content ─────────────────────────────── */
        .content { padding: 24px 22px; max-width: 1440px; margin: 0 auto; }

        /* ── Stat Cards ──────────────────────────── */
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px; }
        .stat-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px 20px; transition: box-shadow .2s, transform .2s; }
        .stat-card:hover { box-shadow: 0 6px 24px rgba(0,0,0,0.07); transform: translateY(-2px); }
        .stat-lbl { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; }
        .stat-val { font-size: 28px; font-weight: 700; color: #111827; letter-spacing: -.03em; font-family: 'DM Mono', monospace; line-height: 1; }
        .stat-badge { display: inline-flex; align-items: center; gap: 3px; margin-top: 9px; padding: 2px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 600; }
        .badge-amber  { background: #fef3c7; color: #b45309; }
        .badge-green  { background: #d1fae5; color: #059669; }
        .badge-blue   { background: #dbeafe; color: #1d4ed8; }
        .badge-purple { background: #ede9fe; color: #7c3aed; }
        .badge-red    { background: #fee2e2; color: #b91c1c; }
        .pulse-amber { box-shadow: 0 0 0 0 rgba(245,158,11,0.7); animation: pulseAmber 1.6s infinite; }
        @keyframes pulseAmber { 0%{box-shadow:0 0 0 0 rgba(245,158,11,0.7)} 70%{box-shadow:0 0 0 8px rgba(245,158,11,0)} 100%{box-shadow:0 0 0 0 rgba(245,158,11,0)} }
        .quick-action-btn { display: inline-flex; align-items: center; justify-content: center; margin-top: 10px; padding: 6px 10px; border-radius: 8px; background: #f9fafb; border: 1px solid #e5e7eb; color: #4f46e5; font-size: 11.5px; font-weight: 700; text-decoration: none; transition: background .15s, border-color .15s; }
        .quick-action-btn:hover { background: #ede9fe; border-color: #ddd6fe; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin-bottom: 20px; }
        .exposure-list { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
        .exposure-row { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; color: #374151; }
        .table-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 22px; margin-bottom: 16px; }
        .table-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
        .table-search { position: relative; min-width: 260px; max-width: 100%; flex: 1; }
        .table-search input {
          width: 100%;
          padding: 11px 14px 11px 40px;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          background: #fff;
          color: #111827;
          font-size: 13px;
          outline: none;
        }
        .table-search input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
        .table-search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #9ca3af; width: 16px; height: 16px; }
        .table-wrap { overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 16px; }
        .data-table { width: 100%; border-collapse: collapse; min-width: 900px; }
        .data-table thead tr { background: #f9fafb; }
        .data-table th { padding: 14px 16px; text-align: left; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
        .data-table td { padding: 14px 16px; border-bottom: 1px solid #f3f4f6; font-size: 13px; color: #374151; vertical-align: top; }
        .data-table tbody tr:hover { background: #fafafa; }
        .status-pill { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
        .status-active { background: #dcfce7; color: #047857; }
        .status-inactive { background: #fee2e2; color: #b91c1c; }
        .status-pending { background: #fef3c7; color: #b45309; }
        .view-button { display: inline-flex; align-items: center; justify-content: center; padding: 7px 12px; border-radius: 10px; background: #eff6ff; color: #1d4ed8; text-decoration: none; font-size: 12px; font-weight: 600; border: 1px solid #dbeafe; transition: all .15s; }
        .view-button:hover { background: #dbeafe; }
        .table-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 14px; }
        .table-count { font-size: 12px; color: #6b7280; }
        .pagination { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .page-btn { min-width: 36px; height: 34px; padding: 0 10px; border-radius: 10px; border: 1px solid #e5e7eb; background: #fff; color: #374151; font-size: 12px; cursor: pointer; transition: all .15s; }
        .page-btn:hover:not(:disabled) { background: #f9fafb; }
        .page-btn.active { background: #4f46e5; border-color: #4f46e5; color: #fff; font-weight: 600; }
        .page-btn:disabled { opacity: .4; cursor: not-allowed; }

        /* ── Charts row ──────────────────────────── */
        .charts-row { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 16px; }
        @media (min-width: 900px) { .charts-row { grid-template-columns: 1fr 1fr; } }

        /* ── Panel ───────────────────────────────── */
        .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 20px; padding: 22px; }
        .panel-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
        .panel-title  { font-size: 13.5px; font-weight: 600; color: #111827; }
        .panel-sub    { font-size: 11.5px; color: #9ca3af; margin-top: 2px; }
        .chart-canvas { height: 260px; width: 100%; }

        /* Legend */
        .legend { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .leg { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6b7280; }
        .leg-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

        /* ── Reports row ─────────────────────────── */
        .reports-row { display: grid; grid-template-columns: 1fr; gap: 16px; }
        @media (min-width: 900px) { .reports-row { grid-template-columns: 1fr 1fr; } }

        .report-section h3 { font-size: 11.5px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 12px; }
        .report-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
        .report-item:last-child { border-bottom: none; }
        .report-name { color: #374151; font-weight: 500; }
        .report-value { color: #111827; font-weight: 600; font-family: 'DM Mono', monospace; }
        .report-loading { padding: 20px; text-align: center; color: #9ca3af; }

        /* Scrollbar */
        .sb-nav::-webkit-scrollbar { width: 6px; }
        .sb-nav::-webkit-scrollbar-track { background: transparent; }
        .sb-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      `}</style>

      <div className="root">
        {/* Overlay */}
        <div
          className={`overlay${sidebarOpen ? " show" : ""}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />

        {/* ── Sidebar ── */}
        {/* <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="sb-head">
            <div className="sb-chip">Admin Portal</div>
            <div className="sb-title">Workspace</div>
          </div>

          <div className="sb-user">
            <div className="sb-avatar">{loading ? "…" : initials}</div>
            <div className="sb-uname">{loading ? "Loading…" : (adminUser.name || adminUser.username || "Administrator")}</div>
            <div className="sb-meta">{adminUser.email || "admin@omsons.com"}</div>
            {adminUser.role && (
              <span className="sb-role">{adminUser.role}</span>
            )}
          </div>

          <nav className="sb-nav">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`sb-link${pathname === item.href ? " active" : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="sb-foot">
            <button className="sb-logout" onClick={handleLogout}>Sign out</button>
          </div>
        </aside> */}

        {/* ── Main ── */}
        <div className="main">
          {/* <header className="topbar bg-linear from-bg-blue-500 to-bg-blue-600">
            <div className="topbar-l">
              <button
                className="hamburger"
                onClick={() => setSidebarOpen(v => !v)}
                aria-label="Toggle sidebar"
              >
                {sidebarOpen
                  ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
                }
              </button>
              <img src={logoImage} alt="amazonLogo" className="h-12" />
              <div style={{ minWidth: 0 }}>
                <div className="topbar-title">
                  {loading ? "Dashboard" : `Welcome, ${adminUser.name || adminUser.username || 'Admin'}`}
                </div>
                <div className="topbar-sub">System administration dashboard</div>
              </div>
            </div>
          </header> */}

          <main className="content">

            {/* ── Stat Cards ── */}
            <div className="stat-grid">
              {STAT_CONFIG.map((stat) => {
                const value = stat.key === "dealerCount"
                  ? totalDistributors
                  : adminData[stat.key as keyof AdminStats] || 0;
                const badgeClass = stat.key === "PorderCount" ? "badge-amber" :
                  stat.key === "dealerCount" ? "badge-green" :
                    stat.key === "orderCount" ? "badge-blue" : "badge-purple";

                return (

                  <div key={stat.key} className="stat-card">
                    <div className="stat-lbl">{stat.label}</div>
                    <div className="font-sans font-bold">{loading ? "—" : value}</div>
                    <div className={`stat-badge ${badgeClass}`}>{value.toLocaleString("en-IN")}</div>
                  </div>

                );
              })}
              <div className="stat-card"><div className="stat-lbl">Today&apos;s Sale</div>
                <div className="font-sans font-bold">₹0</div>
                <div className="stat-badge badge-green">0</div></div>
            </div>

            {/* ── Sidebar Summary Widgets ── */}
            {summaryError && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
                Some summary data failed to load.
                <button className="quick-action-btn" style={{ marginTop: 0, marginLeft: "auto", color: "#dc2626" }} onClick={retrySummary}>Retry</button>
              </div>
            )}
            <div className="summary-grid">
              <div className="stat-card">
                <div className="stat-lbl">Pending Orders</div>
                <div className="font-sans font-bold">{summaryLoading ? "—" : outstandingOrders.length}</div>
                <div className="stat-badge badge-amber pulse-amber">{outstandingOrders.length} pending</div>
                <Link href="/Pages/Ordermanagement/outstandingorders" className="quick-action-btn">+ Review orders</Link>
              </div>
              <div className="stat-card">
                <div className="stat-lbl">Total Distributors</div>
                <div className="font-sans font-bold">{summaryLoading ? "—" : totalDistributors}</div>
                <div className="stat-badge badge-green">{activeDealers} active</div>
                <div className="stat-badge badge-red" style={{ marginLeft: 6 }}>{inactiveDealers} inactive</div>
                <Link href="/dashboard/admin/dealer/DealerList" className="quick-action-btn">+ Open dealers</Link>
              </div>
              <div className="stat-card">
                <div className="stat-lbl">Staff Roles</div>
                <div className="font-sans font-bold">{summaryLoading ? "—" : (adminData.staffCount || staffQ.data?.count || staffRows.length)}</div>
                <div className="stat-badge badge-purple">{roleCounts["1"] ?? 0} executive</div>
                <div className="stat-badge badge-blue" style={{ marginLeft: 6 }}>{roleCounts["2"] ?? 0} field</div>
                <Link href="/dashboard/admin/staff/stafflist" className="quick-action-btn">+ View staff</Link>
              </div>
              <div className="stat-card">
                <div className="stat-lbl">Discount Approvals</div>
                <div className="font-sans font-bold">{summaryLoading ? "—" : pendingApprovals}</div>
                <div className={`stat-badge ${pendingApprovals > 0 ? "badge-amber pulse-amber" : "badge-green"}`}>{pendingApprovals} pending</div>
                <Link href="/dashboard/admin/custom-discount-approvals" className="quick-action-btn">+ Review discounts</Link>
              </div>
              <div className="stat-card">
                <div className="stat-lbl">Credit Exposure</div>
                <div className="font-sans font-bold">{summaryLoading ? "—" : `₹${outstandingExposure.toLocaleString("en-IN")}`}</div>
                <div className="stat-badge badge-blue">{ledgerRows.length} ledgers</div>
                <Link href="/dashboard/admin/ledger" className="quick-action-btn">+ Open ledger</Link>
              </div>
              <div className="stat-card">
                <div className="stat-lbl">Top Exposure</div>
                <div className="exposure-list">
                  {summaryLoading ? (
                    <div className="font-sans font-bold">—</div>
                  ) : highExposureDealers.length > 0 ? highExposureDealers.map(d => (
                    <div className="exposure-row" key={d.Dealer_Id}>
                      <span>{d.Dealer_Name}</span>
                      <strong>₹{Number(d.currentlimit || 0).toLocaleString("en-IN")}</strong>
                    </div>
                  )) : (
                    <div className="stat-badge badge-green">No exposure</div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Charts ── */}
            <PendingProductsPreview role="admin" moreHref="/dashboard/admin/pending-products" />

            <div className="table-card">
              <div className="table-toolbar">
                <div>
                  <div className="panel-title">Distributors</div>
                  <div className="panel-sub">Search and review all registered distributors</div>
                </div>
                <div className="table-search">
                  <Search className="table-search-icon" />
                  <input
                    type="text"
                    placeholder="Search distributors..."
                    value={distributorSearchInput}
                    onChange={(e) => setDistributorSearchInput(e.target.value)}
                  />
                </div>
              </div>

              {distributorsError && (
                <div style={{ marginBottom: 14, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 12, padding: "10px 14px", fontSize: 13 }}>
                  Failed to load distributors. Please try again.
                </div>
              )}

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Distributor Name</th>
                      <th>Dealer Code</th>
                      <th>City</th>
                      <th>Phone</th>
                      <th>Assigned Staff</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distributorsLoading ? (
                      Array.from({ length: 8 }).map((_, idx) => (
                        <tr key={idx}>
                          {Array.from({ length: 7 }).map((__, cellIdx) => (
                            <td key={cellIdx}>
                              <div style={{ height: 14, borderRadius: 8, background: "#e5e7eb", width: cellIdx === 6 ? 70 : "100%", opacity: 0.75 }} />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : distributorRows.length > 0 ? distributorRows.map((dealer) => {
                      const isActive = normalizeDealerStatus(dealer.status) === "active";
                      const statusClass = isActive ? "status-active" : "status-inactive";
                      const statusLabel = isActive ? "Active" : "Inactive";
                      return (
                        <tr key={dealer.Dealer_Id}>
                          <td>
                            <div style={{ fontWeight: 600, color: "#111827" }}>{dealer.Dealer_Name || "-"}</div>
                          </td>
                          <td>{dealer.Dealer_Dealercode || "-"}</td>
                          <td>{dealer.Dealer_City || "-"}</td>
                          <td>{dealer.Dealer_Number || "-"}</td>
                          <td>{dealer.staffname || dealer.assignedstaff || "-"}</td>
                          <td><span className={`status-pill ${statusClass}`}>{statusLabel}</span></td>
                          <td>
                            <Link href={`/dashboard/admin/dealer/${encodeURIComponent(dealer.Dealer_Id)}/view`} className="view-button">
                              View
                            </Link>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={7} style={{ padding: "24px 16px", textAlign: "center", color: "#9ca3af" }}>
                          No distributors found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="table-footer">
                <div className="table-count">
                  {distributorRows.length > 0
                    ? `Showing ${distributorStartIndex}–${distributorEndIndex} of ${distributorTotal}`
                    : "No results"}
                </div>
                <div className="pagination">
                  <button
                    className="page-btn"
                    onClick={() => handleDistributorPageChange(distributorPage - 1)}
                    disabled={distributorPage === 1}
                  >
                    Prev
                  </button>
                  {distributorPageNumbers().map((p, idx) => (
                    p === "..." ? (
                      <span key={`dist-ellipsis-${idx}`} style={{ color: "#9ca3af", fontSize: 12 }}>...</span>
                    ) : (
                      <button
                        key={p}
                        className={`page-btn${p === distributorPage ? " active" : ""}`}
                        onClick={() => handleDistributorPageChange(p)}
                      >
                        {p}
                      </button>
                    )
                  ))}
                  <button
                    className="page-btn"
                    onClick={() => handleDistributorPageChange(distributorPage + 1)}
                    disabled={distributorPage === distributorTotalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>

            <div className="charts-row">

              {/* Chart 1 — Top Orders */}
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Top Orders</div>
                    <div className="panel-sub">Order value distribution</div>
                  </div>
                  <div className="legend">
                    <span className="leg">
                      <span className="leg-dot" style={{ background: "rgba(99,102,241,0.78)" }} />
                      Order Value
                    </span>
                  </div>
                </div>
                <div className="chart-canvas">
                  {loading ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
                      Loading chart...
                    </div>
                  ) : data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e1b4b", border: "1px solid #4f46e5", borderRadius: "8px" }}
                          labelStyle={{ color: "#c7d2fe" }}
                          formatter={(value) => `₹${Number(value).toLocaleString("en-IN")}`}
                        />
                        <Bar dataKey="value" fill="rgba(99,102,241,0.78)" radius={[7, 7, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
                      No data available
                    </div>
                  )}
                </div>
              </div>

              {/* Chart 2 — Top Dealers */}
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Top Distributors</div>
                    <div className="panel-sub">Distributor performance ranking</div>
                  </div>
                  <div className="legend">
                    <span className="leg">
                      <span className="leg-dot" style={{ background: "rgba(159,122,234,0.78)" }} />
                      Total Value
                    </span>
                  </div>
                </div>
                <div className="chart-canvas">
                  {loading ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
                      Loading chart...
                    </div>
                  ) : dealerData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dealerChartData}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e1b4b", border: "1px solid #4f46e5", borderRadius: "8px" }}
                          labelStyle={{ color: "#c7d2fe" }}
                          formatter={(value) => `₹${Number(value).toLocaleString("en-IN")}`}
                        />
                        <Bar dataKey="value" fill="rgba(159,122,234,0.78)" radius={[7, 7, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#9ca3af" }}>
                      No data available
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Reports ── */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Reports</div>
                  <div className="panel-sub">Top performing orders and distributors</div>
                </div>
              </div>

              <div className="reports-row">
                {/* Top Orders */}
                <div>
                  <h3 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffffff", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "12px", background: "#d0d0d0ff", padding: "7px", borderRadius: "5px" }}>
                    Top Orders
                  </h3>
                  {loading ? (
                    <div className="report-loading">Loading...</div>
                  ) : data.length > 0 ? (
                    data.map((item) => (
                      <div key={item.order_id} className="report-item">
                        <span className="report-name">OM/{year}/{item.order_id}</span>
                        <span className="report-value">
                          ₹{Number(item.total).toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="report-loading">No data available</div>
                  )}
                </div>

                {/* Top Distributors */}
                <div className="">
                  <h3 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffffff", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "12px", background: "#d0d0d0ff", padding: "7px", borderRadius: "5px" }}>
                    Top Distributors
                  </h3>
                  {loading ? (
                    <div className="report-loading">Loading...</div>
                  ) : dealerData.length > 0 ? (
                    dealerData.map((dealer, index) => (
                      <div key={index} className="report-item">
                        <span className="report-name">{dealer.Dealer_Name}</span>
                        <span className="report-value">
                          ₹{Number(dealer.total).toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="report-loading">No data available</div>
                  )}
                </div>
              </div>
            </div>

          </main>
        </div>
      </div>
    </>
  );
}
