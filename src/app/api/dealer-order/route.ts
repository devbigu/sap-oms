import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { normalizeDealerStatus, type DealerStatus } from "@/lib/dealerStatus";
import { fetchStaffAssignedDealerIds, parseOrderActor } from "@/lib/orderScopeServer";
import walletUtils from "@/lib/wallet";

export const runtime = "nodejs";
const PHP_BASE = "https://mirisoft.co.in/sas/dealerapi/api";
const STATUS_COLLECTION = "dealer_statuses";

function safeText(value: unknown, max = 240) { return String(value ?? "").trim().slice(0, max); }
function money(value: FormDataEntryValue | null) {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
function closeMoney(a: number, b: number) { return Math.abs(a - b) <= 0.02; }

async function getDealerStatusOrDefault(dealerId: string): Promise<DealerStatus> {
  try {
    const doc = await (await getDb()).collection(STATUS_COLLECTION).findOne({ dealerId });
    return doc ? normalizeDealerStatus(doc.status) : "active";
  } catch (error) {
    if (isMongoDependencyError(error)) return "active";
    throw error;
  }
}

function authoritativeNetPayable(form: FormData) {
  const raw = safeText(form.get("productorder"), 2_000_000);
  let products: Array<Record<string, unknown>>;
  try { products = JSON.parse(raw); } catch { throw new walletUtils.WalletError("Order products are malformed.", 422, "invalid_order_amount"); }
  if (!Array.isArray(products) || products.length === 0) throw new walletUtils.WalletError("Order products are required.", 422, "invalid_order_amount");
  const gross = products.reduce((sum, row) => {
    const quantity = Number(row.producQuanity);
    const price = Number(row.price);
    if (!(quantity > 0) || !(price >= 0)) throw new walletUtils.WalletError("Order product amount is invalid.", 422, "invalid_order_amount");
    return sum + quantity * price;
  }, 0);
  const subtotal = money(form.get("subtotal"));
  const base = money(form.get("baseDiscountAmount"));
  const additional = money(form.get("additionalDiscountAmount"));
  const submittedNet = money(form.get("finalPayableAmount"));
  if (![subtotal, base, additional, submittedNet].every(Number.isFinite) || !closeMoney(gross, subtotal)) {
    throw new walletUtils.WalletError("Order amount verification failed.", 422, "invalid_order_amount");
  }
  const additionalType = safeText(form.get("additionalDiscountType"), 20).toLowerCase();
  if (additional > 0 && !["slab", "custom"].includes(additionalType)) throw new walletUtils.WalletError("Additional discount type is invalid.", 422, "invalid_discount");
  const calculated = Math.round(Math.max(0, gross - base - additional) * 100) / 100;
  if (!closeMoney(calculated, submittedNet)) throw new walletUtils.WalletError("Net Payable verification failed.", 422, "invalid_net_payable");
  return calculated;
}

async function assertCustomDiscountApproved(db: Awaited<ReturnType<typeof getDb>>, form: FormData, dealerId: string) {
  if (safeText(form.get("additionalDiscountType"), 20).toLowerCase() !== "custom") return;
  const ids = safeText(form.get("customDiscountRequestId"), 2000).split(",").map((id) => id.trim()).filter(Boolean);
  if (!ids.length) throw new walletUtils.WalletError("Approved custom-discount reference is required.", 409, "custom_discount_not_approved");
  const objectIds = ids.map((id) => { try { return new ObjectId(id); } catch { return null; } }).filter((id): id is ObjectId => Boolean(id));
  const approved = await db.collection("custom_discount_requests").countDocuments({ _id: { $in: objectIds }, dealerId, status: "approved" });
  if (approved !== ids.length) throw new walletUtils.WalletError("Custom discount is not approved for this order.", 409, "custom_discount_not_approved");
}

function extractOrderId(payload: any) {
  const values = [payload?.order_id, payload?.orderId, payload?.Order_Id, payload?.id, payload?.lastid, payload?.data?.order_id, payload?.data?.orderId, payload?.data?.id];
  const value = values.find((entry) => safeText(entry));
  return safeText(value || safeText(payload?.msg || payload?.message).match(/order\s*(?:id|no\.?)?\s*#?\s*(\d+)/i)?.[1], 120);
}

function phpSucceeded(response: Response, payload: any) {
  if (!response.ok) return false;
  const message = safeText(payload?.msg || payload?.message, 500);
  if (payload?.error) return false;
  if (/(fail|error|invalid|unable|not\s+saved|not\s+placed)/i.test(message)) return false;
  // The legacy PHP API commonly returns status:false alongside successful
  // messages (including "Success") after it has already persisted the order.
  // Treat an explicit false success flag as failure only when no positive
  // success message is present; never use the legacy status flag by itself.
  if (payload?.success === false && !/(success|saved|placed|created|inserted)/i.test(message)) return false;
  return true;
}

function orderIdFromRow(row: Record<string, unknown>) {
  return safeText(row.order_id ?? row.orderId ?? row.Order_Id ?? row.id, 120);
}

async function fetchRecentDealerOrders(dealerId: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `${PHP_BASE}/orderhispegination?page=1&limit=20&search=&id=${encodeURIComponent(dealerId)}`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) }
  );
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null);
  const rows: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
  return rows.filter((row: unknown): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

async function resolveCreatedOrderId(dealerId: string, payload: any, previousOrderIds: Set<string>) {
  const direct = extractOrderId(payload);
  if (direct) return direct;

  // Some successful PHP responses contain only a message. Poll the authoritative
  // Dealer order history briefly and select the ID that did not exist before POST.
  for (const delayMs of [0, 250, 600, 1200]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const rows = await fetchRecentDealerOrders(dealerId).catch(() => []);
    const created = rows.map(orderIdFromRow).find((id) => id && !previousOrderIds.has(id));
    if (created) return created;
  }
  return "";
}

export async function POST(request: NextRequest) {
  let reservation: { dealerId: string; key: string } | null = null;
  try {
    const incoming = await request.formData();
    const dealerId = safeText(incoming.get("id") ?? incoming.get("dealerId") ?? incoming.get("order_dealer"), 120);
    if (!dealerId) return NextResponse.json({ success: false, message: "dealerId is required" }, { status: 400 });
    const actor = parseOrderActor({ role: request.headers.get("x-omsons-actor-role"), actorId: request.headers.get("x-omsons-actor-id") });
    if (!actor) return NextResponse.json({ success: false, message: "Missing order identity." }, { status: 401 });
    if (actor.role === "accountant") return NextResponse.json({ success: false, message: "This role cannot create orders." }, { status: 403 });
    if (actor.role === "dealer" && actor.actorId !== dealerId) return NextResponse.json({ success: false, message: "Dealers can only order for their own account." }, { status: 403 });
    if (actor.role === "staff" && !(await fetchStaffAssignedDealerIds(actor.actorId)).includes(dealerId)) {
      return NextResponse.json({ success: false, message: "This Dealer is outside your assignment." }, { status: 403 });
    }
    if (await getDealerStatusOrDefault(dealerId) === "inactive") return NextResponse.json({ success: false, message: "This dealer account is inactive." }, { status: 403 });

    const db = await getDb();
    const isExcelUpload = incoming.has("exelefile");
    const idempotencyKey = safeText(request.headers.get("idempotency-key"), 240);
    const snapshot = await walletUtils.getWalletSnapshot(db, dealerId, { limit: 1 });
    let netPayable = 0;
    let previousOrderIds = new Set<string>();
    if (snapshot.status === "active") {
      if (isExcelUpload) throw new walletUtils.WalletError("Excel orders are unavailable while this Dealer wallet is active because Net Payable cannot be verified before import.", 422, "unverifiable_order_amount");
      netPayable = authoritativeNetPayable(incoming);
      await assertCustomDiscountApproved(db, incoming, dealerId);
      const reserved = await walletUtils.reserveOrderFunds(db, dealerId, netPayable, { idempotencyKey });
      if (reserved.duplicate) return NextResponse.json({ success: true, duplicate: true, wallet: reserved });
      reservation = { dealerId, key: idempotencyKey };
      previousOrderIds = new Set((await fetchRecentDealerOrders(dealerId).catch(() => [])).map(orderIdFromRow).filter(Boolean));
    }

    const forwarded = new FormData();
    incoming.forEach((value, key) => forwarded.append(key, value));
    const staffId = safeText(incoming.get("staffid"), 120);
    const endpoint = isExcelUpload ? `${PHP_BASE}/importdata` : `${PHP_BASE}/PlaceOrderarray?id=${encodeURIComponent(dealerId)}&staffid=${encodeURIComponent(staffId)}`;
    const phpResponse = await fetch(endpoint, { method: "POST", body: forwarded });
    const responseText = await phpResponse.text();
    let payload: any;
    try { payload = JSON.parse(responseText); } catch { payload = { success: phpResponse.ok, message: responseText || "Request failed" }; }
    if (!phpSucceeded(phpResponse, payload)) {
      if (reservation) await walletUtils.releaseOrderReservation(db, reservation.dealerId, reservation.key);
      reservation = null;
      return NextResponse.json({ success: false, message: safeText(payload?.msg || payload?.message, 500) || "Order creation failed." }, { status: phpResponse.status || 502 });
    }

    if (reservation) {
      const orderId = await resolveCreatedOrderId(dealerId, payload, previousOrderIds);
      if (!orderId) {
        await walletUtils.releaseOrderReservation(db, reservation.dealerId, reservation.key);
        reservation = null;
        return NextResponse.json({ success: false, message: "The order was created but its order ID was not returned; wallet was not charged. Contact Admin before retrying." }, { status: 502 });
      }
      const debit = await walletUtils.finalizeOrderDebit(db, dealerId, reservation.key, { id: orderId, number: safeText(payload?.order_number || payload?.orderNumber, 120) }, {
        actorId: actor.actorId, actorRole: actor.role, actorName: safeText(request.headers.get("x-omsons-actor-name"), 160),
      });
      reservation = null;
      payload.order_id ||= orderId;
      payload.success = true;
      payload.msg ||= payload.message || "Order placed successfully.";
      payload.wallet = { used: true, transactionId: debit.id, amountConsumed: netPayable, balanceAfter: debit.balanceAfter };
    }
    payload.success ??= true;
    payload.msg ||= payload.message || "Order placed successfully.";
    return NextResponse.json(payload, { status: phpResponse.status });
  } catch (error: any) {
    if (reservation) {
      try { await walletUtils.releaseOrderReservation(await getDb(), reservation.dealerId, reservation.key); } catch {}
    }
    console.error("dealer-order POST failed", error);
    const status = Number(error?.status) || (isMongoDependencyError(error) ? 503 : 500);
    return NextResponse.json({ success: false, code: error?.code || "order_failed", message: status >= 500 ? "Unable to submit order." : error?.message }, { status });
  }
}
