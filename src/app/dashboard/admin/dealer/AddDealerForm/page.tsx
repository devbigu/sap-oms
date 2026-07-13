"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import DealerFormCard from "@/components/dealers/DealerFormCard";
import { type DealerFormSnapshot } from "@/lib/dealerForm";
import { buildDealerRequestHeaders, type PublicDealerRequest } from "@/lib/dealerRequests";
import { readDashboardActor, type DashboardActor } from "@/lib/dealerRequestClient";

type RequestMode = "admin-create" | "staff-submit" | "admin-review" | "staff-resubmit";

const DIRECT_DEALER_CREATE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  "https://mirisoft.co.in/sas/dealerapi"
).replace(/\/+$/, "") + "/api/formdata1";
const STAFF_REQUESTS_ROUTE = "/dashboard/staff/dealer-requests";
const ADMIN_REQUESTS_ROUTE = "/dashboard/admin/dealer/requests";
const DEALER_LIST_ROUTE = "/dashboard/admin/dealer/DealerList";

function resolveMode(actor: DashboardActor | null, requestData: PublicDealerRequest | null): RequestMode | null {
  if (!actor) return null;
  if (!requestData) {
    if (actor.role === "admin") return "admin-create";
    if (actor.role === "staff") return "staff-submit";
    return null;
  }

  if (actor.role === "admin" && requestData.status === "pending") {
    return "admin-review";
  }

  if (actor.role === "staff" && requestData.status === "rejected" && requestData.submittedById === actor.actorId) {
    return "staff-resubmit";
  }

  return null;
}

function AddDealerPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("requestId")?.trim() ?? "";

  const [actor] = useState<DashboardActor | null>(() => readDashboardActor());
  const [requestData, setRequestData] = useState<PublicDealerRequest | null>(null);
  const [loading, setLoading] = useState(() => !!requestId);
  const [activeAction, setActiveAction] = useState<"submit" | "reject" | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const hasAccess = actor?.role === "admin" || actor?.role === "staff";

  useEffect(() => {
    if (!actor) {
      router.replace("/auth/login");
    }
  }, [actor, router]);

  useEffect(() => {
    if (!actor || !hasAccess || !requestId) return;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setMessage(null);

      fetch(`/api/dealer-requests/${encodeURIComponent(requestId)}`, {
        headers: buildDealerRequestHeaders(actor),
        cache: "no-store",
      })
        .then(async (response) => {
          const json = await response.json();
          if (!response.ok || !json.success) {
            throw new Error(json.message ?? "Failed to load dealer request");
          }
          return json.data as PublicDealerRequest;
        })
        .then((data) => {
          if (!active) return;
          setRequestData(data);
        })
        .catch((error) => {
          if (!active) return;
          setMessage({ text: error instanceof Error ? error.message : "Failed to load dealer request", type: "error" });
          setRequestData(null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });

    return () => {
      active = false;
    };
  }, [actor, hasAccess, requestId]);

  const mode = useMemo(() => resolveMode(actor, requestData), [actor, requestData]);
  const cancelRoute = mode === "admin-review"
    ? ADMIN_REQUESTS_ROUTE
    : actor?.role === "staff"
      ? STAFF_REQUESTS_ROUTE
      : DEALER_LIST_ROUTE;

  const handleSubmit = async (snapshot: DealerFormSnapshot) => {
    if (!actor || !mode) return;

    setActiveAction("submit");
    setMessage(null);

    try {
      if (mode === "admin-create") {
        const response = await fetch(DIRECT_DEALER_CREATE_URL, {
          method: "POST",
          body: (() => {
            const formData = new FormData();
            formData.append("Dealer_Name", snapshot.name);
            formData.append("Dealer_Email", snapshot.email);
            formData.append("Dealer_Number", snapshot.whatsapp);
            formData.append("Dealer_City", snapshot.city);
            formData.append("Dealer_Address", snapshot.address);
            formData.append("Dealer_Pincode", snapshot.pincode);
            formData.append("Dealer_Dealercode", snapshot.dealerCode);
            formData.append("Dealer_Username", snapshot.username);
            formData.append("Dealer_Password", snapshot.password);
            formData.append("gst", snapshot.gstNo);
            formData.append("discount", snapshot.discount);
            formData.append("creditdays", snapshot.creditDays);
            formData.append("annualtarget", snapshot.annualTarget);
            formData.append("currentlimit", snapshot.currentLimit);
            formData.append("Dealer_Notes", snapshot.notes);
            formData.append("assignedstaff", snapshot.assignedStaffIds.join(","));
            formData.append("staffname", snapshot.staffNames);
            return formData;
          })(),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.msg || "Something went wrong. Please try again.");
        }
        setMessage({ text: payload?.msg || "Dealer created successfully", type: "success" });
        setFormKey((value) => value + 1);
        return;
      }

      if (mode === "staff-submit") {
        const response = await fetch("/api/dealer-requests", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildDealerRequestHeaders(actor),
          },
          body: JSON.stringify({ formSnapshot: snapshot }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.message ?? "Failed to submit dealer request");
        }
        setMessage({ text: "Dealer request sent for approval.", type: "success" });
        router.push(STAFF_REQUESTS_ROUTE);
        return;
      }

      if (!requestData?.id) {
        throw new Error("Missing request id");
      }

      const action = mode === "admin-review" ? "accept" : "resubmit";
      const response = await fetch(`/api/dealer-requests/${encodeURIComponent(requestData.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...buildDealerRequestHeaders(actor),
        },
        body: JSON.stringify({ action, formSnapshot: snapshot }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Failed to update dealer request");
      }

      setMessage({
        text: mode === "admin-review"
          ? "Dealer request accepted and dealer created."
          : "Dealer request resubmitted for approval.",
        type: "success",
      });

      router.push(mode === "admin-review" ? ADMIN_REQUESTS_ROUTE : STAFF_REQUESTS_ROUTE);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Something went wrong. Please try again.", type: "error" });
    } finally {
      setActiveAction(null);
    }
  };

  const handleReject = async (snapshot: DealerFormSnapshot) => {
    if (!actor || !requestData?.id) return;

    const rejectionReason = window.prompt("Enter a rejection reason");
    if (!rejectionReason || !rejectionReason.trim()) {
      setMessage({ text: "Rejection reason is required.", type: "error" });
      return;
    }

    setActiveAction("reject");
    setMessage(null);

    try {
      const response = await fetch(`/api/dealer-requests/${encodeURIComponent(requestData.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...buildDealerRequestHeaders(actor),
        },
        body: JSON.stringify({
          action: "reject",
          rejectionReason: rejectionReason.trim(),
          formSnapshot: snapshot,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Failed to reject dealer request");
      }

      setMessage({ text: "Dealer request rejected.", type: "success" });
      router.push(ADMIN_REQUESTS_ROUTE);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Failed to reject dealer request", type: "error" });
    } finally {
      setActiveAction(null);
    }
  };

  if (loading && hasAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading dealer form...</p>
        </div>
      </div>
    );
  }

  if (!hasAccess || !mode || !actor) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">Dealer form is unavailable</h1>
          <p className="mt-2 text-sm text-gray-500">
            {message?.text || (actor ? "Only admin and staff can access dealer creation." : "This dealer request can no longer be edited in the current context.")}
          </p>
          <button
            type="button"
            onClick={() => router.push(cancelRoute)}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {message ? (
        <div
          className={`fixed right-6 top-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            message.type === "success"
              ? "border border-green-200 bg-green-50 text-green-800"
              : "border border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <DealerFormCard
        key={`${mode}-${formKey}-${requestData?.id ?? "create"}`}
        mode={mode}
        initialSnapshot={requestData?.formSnapshot}
        isSubmitting={activeAction === "submit"}
        secondaryAction={mode === "admin-review" ? {
          label: "Reject Request",
          loadingLabel: "Rejecting...",
          onAction: handleReject,
        } : undefined}
        isSecondarySubmitting={activeAction === "reject"}
        onSubmit={handleSubmit}
        onCancel={() => router.push(cancelRoute)}
        requestMeta={requestData ? {
          requestReference: requestData.requestReference,
          rejectionReason: requestData.rejectionReason || requestData.lastRejectionReason,
          submittedByName: requestData.submittedByName,
          submittedAt: requestData.submittedAt,
        } : undefined}
      />
    </>
  );
}

export default function AddDealerPage() {
  return (
    <Suspense
      fallback={(
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            <p className="text-sm text-gray-500">Loading dealer form...</p>
          </div>
        </div>
      )}
    >
      <AddDealerPageContent />
    </Suspense>
  );
}
