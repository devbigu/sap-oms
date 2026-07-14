import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/server";
import dealerCategoryReportAccess from "@/lib/dealerCategoryReportAccess";
import { getPhpApiBaseUrl } from "@/lib/phpBackend";

export const runtime = "nodejs";

const BACKEND_URL = getPhpApiBaseUrl();
const PAGE_SIZE = 10;

type ReportActor = {
  role: "admin" | "staff";
  actorId: string;
};

type DealerRow = Record<string, unknown> & {
  Dealer_Id?: string;
  Dealer_Name?: string;
  Dealer_City?: string;
  Dealer_Number?: string;
  Dealer_Dealercode?: string;
  assignedstaff?: string;
  staffname?: string;
};

type DealerResponse = {
  data?: DealerRow[];
  total?: number;
  last_page?: number;
};

function safeText(value: unknown, max = 240) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : String(value ?? "").trim().slice(0, max);
}

function buildActorFromSession(req: NextRequest): ReportActor | NextResponse {
  const session = requireApiSession(req, {
    roles: ["admin", "staff"],
    unauthenticatedMessage: "Authentication required for dealer search",
    unauthorizedMessage: "Only admin and staff users can search report dealers",
  });
  if (session instanceof NextResponse) return session;

  return {
    role: session.role as ReportActor["role"],
    actorId: session.staffId ?? session.adminId ?? session.userId,
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`External API failed with ${response.status}`);
  }

  if (/^\s*</.test(text)) {
    throw new Error("External API returned HTML instead of JSON");
  }

  return JSON.parse(text) as T;
}

async function fetchStaffDealers(staffId: string) {
  const json = await fetchJson<{ data?: DealerRow[] }>(
    `${BACKEND_URL}/staffDealers?id=${encodeURIComponent(staffId)}`
  );

  return (Array.isArray(json.data) ? json.data : []).map(dealerCategoryReportAccess.normalizeDealerRecord);
}

export async function GET(req: NextRequest) {
  const actor = buildActorFromSession(req);
  if (actor instanceof NextResponse) return actor;

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") || "1") || 1);
  const search = safeText(req.nextUrl.searchParams.get("search"), 240);

  try {
    if (actor.role === "admin") {
      const json = await fetchJson<DealerResponse>(
        `${BACKEND_URL}/dealerpegination?page=${page}&limit=${PAGE_SIZE}&search=${encodeURIComponent(search)}`
      );

      return NextResponse.json({
        success: true,
        page,
        pageSize: PAGE_SIZE,
        total: Number(json.total ?? (Array.isArray(json.data) ? json.data.length : 0)),
        last_page: Number(json.last_page ?? 1),
        data: (Array.isArray(json.data) ? json.data : []).map(dealerCategoryReportAccess.normalizeDealerRecord),
      });
    }

    const assignedDealers = await fetchStaffDealers(actor.actorId);
    const paginated = dealerCategoryReportAccess.buildDealerSelectionPage({
      dealers: assignedDealers,
      search,
      page,
      pageSize: PAGE_SIZE,
    });

    return NextResponse.json({
      success: true,
      page: paginated.page,
      pageSize: PAGE_SIZE,
      total: paginated.total,
      last_page: paginated.lastPage,
      data: paginated.data,
    });
  } catch (error) {
    console.error("[GET /api/reports/dealer-category/dealers]", error);
    return NextResponse.json(
      { success: false, message: "Dealer search is unavailable right now." },
      { status: 500 }
    );
  }
}
