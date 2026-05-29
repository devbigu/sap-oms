export const PRIORITY_LABEL = "Priority";
export const PRIORITY_REMARK = "Priority delivery";

const PRIORITY_RE = /\b(asap|priority\s*:?\s*asap|urgent|deliver\s+asap)\b/i;

export function isPriorityValue(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;

  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "priority" ||
    normalized === "asap" ||
    normalized === "urgent" ||
    PRIORITY_RE.test(normalized)
  );
}

export function hasPriorityTag(...values: unknown[]): boolean {
  return values.some(isPriorityValue);
}

export function buildPriorityRemarks(variantCode: string, isPriority?: boolean): string {
  const parts = [];
  if (variantCode) parts.push(`Cat. No: ${variantCode}`);
  if (isPriority) parts.push(PRIORITY_REMARK);
  return parts.join(" | ");
}
