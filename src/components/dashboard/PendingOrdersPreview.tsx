"use client";

import Link from "next/link";

const YEAR = new Date().getFullYear();

export type PendingPreviewItem = {
  id: string;
  title?: string;
  subtitle?: string;
  amount?: number | null;
  dueText?: string;
  statusText?: string;
  statusTone?: "amber" | "blue" | "green" | "red" | "slate";
};

type PendingOrdersPreviewProps = {
  title?: string;
  subtitle?: string;
  moreHref: string;
  moreLabel?: string;
  loading?: boolean;
  emptyText?: string;
  items: PendingPreviewItem[];
};

function formatAmount(amount?: number | null) {
  if (typeof amount !== "number" || Number.isNaN(amount)) return null;
  return `Rs${amount.toLocaleString("en-IN")}`;
}

function toneStyles(tone: PendingPreviewItem["statusTone"]) {
  switch (tone) {
    case "blue":
      return { background: "#dbeafe", color: "#1d4ed8" };
    case "green":
      return { background: "#d1fae5", color: "#059669" };
    case "red":
      return { background: "#fee2e2", color: "#b91c1c" };
    case "slate":
      return { background: "#e2e8f0", color: "#475569" };
    case "amber":
    default:
      return { background: "#fef3c7", color: "#b45309" };
  }
}

export default function PendingOrdersPreview({
  title = "Top 10 Pending Orders",
  subtitle = "Latest pending orders from the Mirisoft PHP API",
  moreHref,
  moreLabel = "More",
  loading = false,
  emptyText = "No pending orders right now.",
  items,
}: PendingOrdersPreviewProps) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 20,
        padding: 22,
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#111827" }}>{title}</div>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 2 }}>{subtitle}</div>
        </div>
        <Link
          href={moreHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "7px 12px",
            borderRadius: 10,
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            color: "#4f46e5",
            fontSize: 12,
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {moreLabel}
        </Link>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {loading
          ? Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 14,
                  padding: "14px 16px",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ width: 120, height: 14, borderRadius: 999, background: "#e5e7eb" }} />
                <div style={{ width: "55%", height: 12, borderRadius: 999, background: "#f3f4f6" }} />
              </div>
            ))
          : items.length > 0
            ? items.map((item) => {
                const amountLabel = formatAmount(item.amount);
                const badgeStyle = toneStyles(item.statusTone);
                return (
                  <div
                    key={item.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: "14px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1f2937" }}>
                        {`OM/${YEAR}/${item.id}`}
                      </div>
                      {item.title && (
                        <div
                          style={{
                            fontSize: 12.5,
                            color: "#111827",
                            marginTop: 3,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.title}
                        </div>
                      )}
                      {item.subtitle && (
                        <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 3 }}>{item.subtitle}</div>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                        marginLeft: "auto",
                      }}
                    >
                      {item.dueText && (
                        <span
                          style={{
                            fontSize: 11.5,
                            color: "#92400e",
                            background: "#fffbeb",
                            border: "1px solid #fde68a",
                            borderRadius: 999,
                            padding: "4px 10px",
                          }}
                        >
                          {item.dueText}
                        </span>
                      )}
                      {item.statusText && (
                        <span
                          style={{
                            ...badgeStyle,
                            fontSize: 11.5,
                            fontWeight: 700,
                            borderRadius: 999,
                            padding: "4px 10px",
                          }}
                        >
                          {item.statusText}
                        </span>
                      )}
                      {amountLabel && (
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#111827", fontFamily: "'DM Mono', monospace" }}>
                          {amountLabel}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            : (
              <div
                style={{
                  border: "1px dashed #d1d5db",
                  borderRadius: 14,
                  padding: "20px 16px",
                  textAlign: "center",
                  fontSize: 12.5,
                  color: "#6b7280",
                }}
              >
                {emptyText}
              </div>
            )}
      </div>
    </div>
  );
}
