export const ORDER_MONGO_DATA_CUTOFF_ISO = "2026-08-04T18:30:00.000Z";
export const ORDER_MONGO_DATA_CUTOFF_DATE = new Date(ORDER_MONGO_DATA_CUTOFF_ISO);

const DEFAULT_DATE_FIELDS = ["createdAt", "updatedAt"];

function readPath(source: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

function parseDateMs(value: unknown) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

export function orderMongoCutoffQuery(dateFields = DEFAULT_DATE_FIELDS) {
  return {
    $or: dateFields.flatMap((field) => [
      { [field]: { $gte: ORDER_MONGO_DATA_CUTOFF_DATE } },
      { [field]: { $gte: ORDER_MONGO_DATA_CUTOFF_ISO } },
    ]),
  };
}

export function withOrderMongoCutoff<T extends Record<string, unknown>>(query: T, dateFields = DEFAULT_DATE_FIELDS) {
  return {
    $and: [
      query,
      orderMongoCutoffQuery(dateFields),
    ],
  };
}

export function isOrderMongoDocumentVisible(doc: unknown, dateFields = DEFAULT_DATE_FIELDS) {
  return dateFields.some((field) => {
    const value = readPath(doc, field);
    const values = Array.isArray(value) ? value : [value];
    return values.some((entry) => {
      const time = parseDateMs(entry);
      return time !== null && time >= ORDER_MONGO_DATA_CUTOFF_DATE.getTime();
    });
  });
}

export function filterVisibleOrderMongoDocuments<T>(docs: T[], dateFields = DEFAULT_DATE_FIELDS) {
  return docs.filter((doc) => isOrderMongoDocumentVisible(doc, dateFields));
}
