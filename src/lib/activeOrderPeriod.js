const ACTIVE_ORDER_CUTOFF_DATE = "2026-07-13";
const ACTIVE_ORDER_PERIOD_VERSION = "orders-from-2026-07-13-v1";
const OUTSIDE_ACTIVE_ORDER_PERIOD = "This order is outside the active order period.";

const ORDER_DATE_FIELDS = [
  "order_date",
  "orderDate",
  "order_datetime",
  "orderDatetime",
  "order_created_at",
  "orderCreatedAt",
];

const SNAPSHOT_DATE_FIELDS = ["createdAt", "created_at", "submittedAt", "submitted_at"];

function validCalendarDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeBusinessCalendarDate(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const pick = (type) => parts.find((part) => part.type === type)?.value;
    return validCalendarDate(pick("year"), pick("month"), pick("day"));
  }

  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)(?:[T\s].*)?$/);
  if (match) return validCalendarDate(match[1], match[2], match[3]);

  match = text.match(/^([0-3]?\d)[-\/]([01]?\d)[-\/](\d{4})(?:[T\s].*)?$/);
  if (match) return validCalendarDate(match[3], match[2], match[1]);

  return null;
}

function extractDate(record, fields) {
  if (!record || typeof record !== "object") return null;
  for (const field of fields) {
    const normalized = normalizeBusinessCalendarDate(record[field]);
    if (normalized) return normalized;
    if (record[field] !== undefined && record[field] !== null && String(record[field]).trim()) return null;
  }
  return null;
}

function getOriginalOrderDate(order) {
  return extractDate(order, ORDER_DATE_FIELDS);
}

function getSnapshotCreationDate(snapshot) {
  return extractDate(snapshot, SNAPSHOT_DATE_FIELDS);
}

function isCalendarDateInActiveOrderPeriod(date) {
  return typeof date === "string" && date >= ACTIVE_ORDER_CUTOFF_DATE;
}

function isActiveOrder(order) {
  return isCalendarDateInActiveOrderPeriod(getOriginalOrderDate(order));
}

function isActiveOrderSnapshot(snapshot) {
  const originalOrderDate = getOriginalOrderDate(snapshot);
  if (originalOrderDate) return isCalendarDateInActiveOrderPeriod(originalOrderDate);
  return isCalendarDateInActiveOrderPeriod(getSnapshotCreationDate(snapshot));
}

function filterActiveOrders(orders) {
  return Array.isArray(orders) ? orders.filter(isActiveOrder) : [];
}

function filterActiveOrderSnapshots(snapshots) {
  return Array.isArray(snapshots) ? snapshots.filter(isActiveOrderSnapshot) : [];
}

function filterActiveOrderResponse(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const data = filterActiveOrders(payload.data);
  if (payload.activeOrderPeriodVersion === ACTIVE_ORDER_PERIOD_VERSION) {
    return { ...payload, data };
  }
  return {
    ...payload,
    data,
    count: data.length,
    total: data.length,
    recordsTotal: data.length,
    recordsFiltered: data.length,
    last_page: data.length > 0 ? 1 : 0,
    lastPage: data.length > 0 ? 1 : 0,
    activeOrderPeriodVersion: ACTIVE_ORDER_PERIOD_VERSION,
  };
}

module.exports = {
  ACTIVE_ORDER_CUTOFF_DATE,
  ACTIVE_ORDER_PERIOD_VERSION,
  OUTSIDE_ACTIVE_ORDER_PERIOD,
  ORDER_DATE_FIELDS,
  normalizeBusinessCalendarDate,
  getOriginalOrderDate,
  getSnapshotCreationDate,
  isCalendarDateInActiveOrderPeriod,
  isActiveOrder,
  isActiveOrderSnapshot,
  filterActiveOrders,
  filterActiveOrderSnapshots,
  filterActiveOrderResponse,
};
