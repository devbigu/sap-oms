import { NextRequest, NextResponse } from "next/server";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { normalizeDealerStatus, type DealerStatus } from "@/lib/dealerStatus";

type DealerStatusDbDocument = {
  dealerId: string;
  status: DealerStatus;
  updatedAt: Date;
  updatedBy?: string;
};

const PHP_BASE = "https://mirisoft.co.in/sas/dealerapi/api";
const STATUS_COLLECTION = "dealer_statuses";

function safeJsonResponse(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status });
}

async function getDealerStatusOrDefault(dealerId: string): Promise<DealerStatus> {
  try {
    const db = await getDb();
    const collection = db.collection<DealerStatusDbDocument>(STATUS_COLLECTION);
    const doc = await collection.findOne({ dealerId });
    return doc ? normalizeDealerStatus(doc.status) : "active";
  } catch (error) {
    if (isMongoDependencyError(error)) {
      console.warn("dealer-order status fallback activated", error);
      return "active";
    }
    throw error;
  }
}

async function forwardToPhp(endpoint: string, formData: FormData) {
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return safeJsonResponse(json, response.status);
  } catch {
    return safeJsonResponse(
      {
        success: response.ok,
        message: text || (response.ok ? "Request completed" : "Request failed"),
      },
      response.status
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const incoming = await request.formData();
    const dealerId = String(incoming.get("id") ?? incoming.get("dealerId") ?? incoming.get("order_dealer") ?? "").trim();

    if (!dealerId) {
      return safeJsonResponse({ success: false, message: "dealerId is required" }, 400);
    }

    const dealerStatus = await getDealerStatusOrDefault(dealerId);
    if (dealerStatus === "inactive") {
      return safeJsonResponse({ success: false, message: "This dealer account is inactive." }, 403);
    }

    const forwarded = new FormData();
    incoming.forEach((value, key) => {
      forwarded.append(key, value);
    });

    const isExcelUpload = incoming.has("exelefile");
    const staffId = String(incoming.get("staffid") ?? "").trim();
    const endpoint = isExcelUpload
      ? `${PHP_BASE}/importdata`
      : `${PHP_BASE}/PlaceOrderarray?id=${encodeURIComponent(dealerId)}&staffid=${encodeURIComponent(staffId)}`;

    const response = await forwardToPhp(endpoint, forwarded);
    return response;
  } catch (error) {
    console.error("dealer-order POST failed", error);
    return safeJsonResponse({ success: false, message: "Unable to submit order." }, 500);
  }
}
