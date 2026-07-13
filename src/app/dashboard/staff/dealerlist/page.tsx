"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

type Dealer = {
  Dealer_Id: string | number;
  Dealer_Name?: string;
  Dealer_City?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_Username?: string;
  Dealer_Dealercode?: string;
  Dealer_Image?: string;

  assignedstaff?:
    | string
    | number
    | Array<string | number>;

  assignedStaff?:
    | string
    | number
    | Array<string | number>;

  staff_id?:
    | string
    | number
    | Array<string | number>;

  staffname?: string;
  status?: string;
};

type DealerApiResponse = {
  data?: Dealer[];
};

type StoredStaffRecord = Record<string, unknown>;

type StaffSession = {
  id: string;
  name: string;
  email: string;
};

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ??
  "https://mirisoft.co.in/sas/dealerapi"
).replace(/\/+$/, "");

function isRecord(value: unknown): value is StoredStaffRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function normalizeString(value: unknown): string {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return "";
  }

  return String(value).trim();
}

function parseStoredRecord(
  value: string | null
): StoredStaffRecord | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getFirstStoredValue(keys: string[]): string {
  for (const key of keys) {
    const value = normalizeString(
      localStorage.getItem(key)
    );

    if (value) return value;
  }

  return "";
}

function getFirstRecordValue(
  record: StoredStaffRecord,
  fields: string[]
): string {
  for (const field of fields) {
    const value = normalizeString(record[field]);

    if (value) return value;
  }

  return "";
}

/**
 * Reads the staff identity from localStorage.
 *
 * It supports both:
 * 1. Direct values such as localStorage.staff_id
 * 2. JSON objects stored under keys such as user, userdata, userData, etc.
 */
function getCurrentStaffSession(): StaffSession | null {
  if (typeof window === "undefined") return null;

  const directStaffId = getFirstStoredValue([
    "staff_id",
    "Staff_Id",
    "staffId",
    "userId",
    "StaffId",
  ]);

  if (directStaffId) {
    return {
      id: directStaffId,

      name:
        getFirstStoredValue([
          "staff_name",
          "Staff_Name",
          "staffName",
          "name",
          "username",
        ]) || "Staff",

      email: getFirstStoredValue([
        "staff_email",
        "Staff_Email",
        "staffEmail",
        "email",
      ]),
    };
  }

  const possibleUserStorageKeys = [
    "user",
    "userdata",
    "userData",
    "loggedInUser",
    "authUser",
    "staff",
    "staffData",
    "loginData",
  ];

  for (const storageKey of possibleUserStorageKeys) {
    const record = parseStoredRecord(
      localStorage.getItem(storageKey)
    );

    if (!record) continue;

    const staffId = getFirstRecordValue(record, [
      "staff_id",
      "Staff_Id",
      "staffId",
      "StaffId",
      "userId",
      "id",
    ]);

    if (!staffId) continue;

    return {
      id: staffId,

      name:
        getFirstRecordValue(record, [
          "staff_name",
          "Staff_Name",
          "staffName",
          "StaffName",
          "name",
          "username",
        ]) || "Staff",

      email: getFirstRecordValue(record, [
        "staff_email",
        "Staff_Email",
        "staffEmail",
        "email",
      ]),
    };
  }

  return null;
}

function isLoggedIn(): boolean {
  const rawStatus = localStorage.getItem("status");

  if (rawStatus === "true") return true;

  try {
    return JSON.parse(rawStatus ?? "false") === true;
  } catch {
    return false;
  }
}

function isStaffRole(): boolean {
  const roleType =
    localStorage.getItem("roletype") ??
    localStorage.getItem("roleType") ??
    localStorage.getItem("role");

  return roleType === "1" || roleType === "staff";
}

function normalizeAssignedStaff(
  value: unknown
): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) =>
        normalizeAssignedStaff(item)
      )
      .filter(Boolean);
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function getDealerAssignedStaffIds(
  dealer: Dealer
): string[] {
  return [
    ...normalizeAssignedStaff(
      dealer.assignedstaff
    ),
    ...normalizeAssignedStaff(
      dealer.assignedStaff
    ),
    ...normalizeAssignedStaff(
      dealer.staff_id
    ),
  ];
}

function isDealerAssignedToStaff(
  dealer: Dealer,
  currentStaffId: string
): boolean {
  if (!currentStaffId) return false;

  return getDealerAssignedStaffIds(
    dealer
  ).includes(currentStaffId);
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) =>
      word.charAt(0).toUpperCase()
    )
    .join("");
}

async function parseDealerResponse(
  response: Response
): Promise<DealerApiResponse> {
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Dealer API returned HTTP ${response.status}`
    );
  }

  if (/^\s*</.test(responseText)) {
    throw new Error(
      "Dealer API returned HTML instead of JSON."
    );
  }

  try {
    return JSON.parse(
      responseText
    ) as DealerApiResponse;
  } catch {
    throw new Error(
      "Dealer API returned invalid JSON."
    );
  }
}

export default function StaffDealerListPage() {
  const router = useRouter();

  const [dealers, setDealers] = useState<Dealer[]>(
    []
  );

  const [staffSession, setStaffSession] =
    useState<StaffSession | null>(null);

  const [search, setSearch] = useState("");
  const [loading, setLoading] =
    useState(true);

  const [error, setError] = useState<
    string | null
  >(null);

  useEffect(() => {
    const controller = new AbortController();

    const loadAssignedDealers = async () => {
      if (!isLoggedIn()) {
        router.replace("/auth/login");
        return;
      }

      if (!isStaffRole()) {
        router.replace("/dashboard");
        return;
      }

      const currentStaff =
        getCurrentStaffSession();

      if (!currentStaff?.id) {
        setDealers([]);
        setError(
          "Unable to identify the logged-in staff account from localStorage."
        );
        setLoading(false);
        return;
      }

      setStaffSession(currentStaff);

      try {
        setLoading(true);
        setError(null);

        console.log(
          "Loading dealers for staff ID:",
          currentStaff.id
        );

        const response = await fetch(
          `${API_BASE}/api/test`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const payload =
          await parseDealerResponse(response);

        const allDealers = Array.isArray(
          payload.data
        )
          ? payload.data
          : [];

        const assignedDealers =
          allDealers.filter((dealer) =>
            isDealerAssignedToStaff(
              dealer,
              currentStaff.id
            )
          );

        console.log(
          `Found ${assignedDealers.length} assigned dealers for staff ${currentStaff.id}`
        );

        setDealers(assignedDealers);
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }

        console.error(
          "Failed to load assigned dealers:",
          fetchError
        );

        setDealers([]);

        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Unable to load assigned dealers."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadAssignedDealers();

    return () => {
      controller.abort();
    };
  }, [router]);

  const visibleDealers = useMemo(() => {
    const query = search
      .trim()
      .toLowerCase();

    if (!query) return dealers;

    return dealers.filter((dealer) =>
      [
        dealer.Dealer_Name,
        dealer.Dealer_City,
        dealer.Dealer_Email,
        dealer.Dealer_Number,
        dealer.Dealer_Username,
        dealer.Dealer_Dealercode,
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query)
      )
    );
  }, [dealers, search]);

  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Dealer List
            </h1>

            <p className="mt-1 text-sm text-gray-500">
              Dealers assigned to{" "}
              {staffSession?.name || "your account"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/staff/dealer-requests"
              className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Dealer Requests
            </Link>
            <Link
              href="/dashboard/admin/dealer/AddDealerForm"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              Add Dealer
            </Link>
          </div>
        </div>

        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />

            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search dealers..."
              className="w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {!loading && !error && (
            <div className="text-sm text-gray-500">
              Assigned dealers:{" "}
              <span className="font-semibold text-gray-900">
                {dealers.length}
              </span>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="font-semibold text-gray-900">
              Dealer List
            </h2>

            {staffSession?.id && (
              <p className="mt-1 text-xs text-gray-400">
                Staff ID: {staffSession.id}
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    S.No.
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Dealer name
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    City
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Email
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Phone no.
                  </th>

                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Username
                  </th>

                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Operations
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {loading &&
                  Array.from({
                    length: 5,
                  }).map((_, index) => (
                    <tr key={index}>
                      {Array.from({
                        length: 7,
                      }).map(
                        (_, columnIndex) => (
                          <td
                            key={columnIndex}
                            className="px-4 py-4"
                          >
                            <div className="h-4 animate-pulse rounded bg-gray-200" />
                          </td>
                        )
                      )}
                    </tr>
                  ))}

                {!loading &&
                  !error &&
                  visibleDealers.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-6 py-14 text-center text-sm text-gray-500"
                      >
                        {search
                          ? "No assigned dealers match your search."
                          : "No dealers are assigned to your account."}
                      </td>
                    </tr>
                  )}

                {!loading &&
                  visibleDealers.map(
                    (dealer, index) => {
                      const dealerId =
                        String(
                          dealer.Dealer_Id
                        ).trim();

                      const dealerName =
                        dealer.Dealer_Name?.trim() ||
                        "Unnamed dealer";

                      const staffDealerRoute =
                        `/dashboard/staff/dealer/${encodeURIComponent(
                          dealerId
                        )}`;

                      return (
                        <tr
                          key={dealerId}
                          className="hover:bg-gray-50"
                        >
                          <td className="px-4 py-4 text-gray-500">
                            {index + 1}
                          </td>

                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                                {getInitials(
                                  dealerName
                                ) || "D"}
                              </div>

                              <Link
                                href={
                                  staffDealerRoute
                                }
                                className="font-medium text-gray-900 hover:text-indigo-700"
                              >
                                {dealerName}
                              </Link>
                            </div>
                          </td>

                          <td className="px-4 py-4 text-gray-600">
                            {dealer.Dealer_City ||
                              "-"}
                          </td>

                          <td className="px-4 py-4 text-gray-600">
                            {dealer.Dealer_Email ||
                              "-"}
                          </td>

                          <td className="px-4 py-4 text-gray-600">
                            {dealer.Dealer_Number ||
                              "-"}
                          </td>

                          <td className="px-4 py-4 text-gray-600">
                            {dealer.Dealer_Username ||
                              "-"}
                          </td>

                          <td className="px-4 py-4 text-right">
                            <Link
                              href={
                                staffDealerRoute
                              }
                              className="inline-flex rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      );
                    }
                  )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
