const ORDER_DATE_FIELDS = [
  "order_date",
  "orderDate",
  "order_datetime",
  "orderDatetime",
  "order_created_at",
  "orderCreatedAt",
  "created_at",
  "createdAt",
];

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

function getOriginalOrderDate(order) {
  if (!order || typeof order !== "object") return null;
  for (const field of ORDER_DATE_FIELDS) {
    const normalized = normalizeBusinessCalendarDate(order[field]);
    if (normalized) return normalized;
    if (order[field] !== undefined && order[field] !== null && String(order[field]).trim()) return null;
  }
  return null;
}

module.exports = { ORDER_DATE_FIELDS, normalizeBusinessCalendarDate, getOriginalOrderDate };
