"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { useCartStore } from "@/Store/store";

// ─── Types ────────────────────────────────────────────────────────────────────
type ProductMeta = { image: string | null; productName: string; packSize: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parsePackSizes(html: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!html) return result;
  const theadMatch = html.match(/<thead>([\s\S]*?)<\/thead>/i);
  if (!theadMatch) return result;
  const headers = [...theadMatch[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
    .map(m => m[1].replace(/<[^>]*>/g, "").trim());
  const packIdx = headers.findIndex(h => /pack|qty|quantity/i.test(h));
  if (packIdx === -1) return result;
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return result;
  [...tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].forEach(tr => {
    const cells = [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
      .map(m => m[1].replace(/<[^>]*>/g, "").trim());
    const catNo = cells[0];
    const n = parseInt(cells[packIdx] ?? "1", 10);
    if (catNo) result[catNo] = isNaN(n) ? 1 : n;
  });
  return result;
}

function buildVariantLookup(data: any[]): Record<string, ProductMeta> {
  const map: Record<string, ProductMeta> = {};
  for (const product of data) {
    const image = (product.Images ?? []).find(Boolean) ?? null;
    const productName = product.Name ?? "";
    const packMap = parsePackSizes(product.Description ?? "");
    for (const variant of product.variants ?? []) {
      map[variant.SKU] = { image, productName, packSize: packMap[variant.SKU] ?? 1 };
    }
  }
  return map;
}

function fmt(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CartPage() {
  const router    = useRouter();
  const cart      = useCartStore(s => s.cart);
  const increment = useCartStore(s => s.incrementQty);
  const decrement = useCartStore(s => s.decrementQty);
  const remove    = useCartStore(s => s.removeFromCart);
  const clearCart = useCartStore(s => s.clearCart);

  const [lookup,    setLookup]    = useState<Record<string, ProductMeta>>({});
  const [removed,   setRemoved]   = useState<string[]>([]);
  const [dealerId,  setDealerId]  = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    axios.get("/data/products.json")
      .then(res => setLookup(buildVariantLookup(res.data)))
      .catch(() => {});
    try {
      const raw = localStorage.getItem("UserData");
      if (raw) setDealerId(JSON.parse(raw)?.Dealer_Id ?? null);
    } catch { /* ignore */ }
  }, []);

  const handleImportToOrder = async () => {
    if (cart.length === 0 || !dealerId) return;
    setImporting(true);
    try {
      const items = cart.map(item => {
        const nameParts   = item.name.split(" - ");
        const productName = nameParts[0] ?? item.name;
        const variantCode = nameParts.length > 1 ? nameParts[nameParts.length - 1] : item.id;
        const meta        = lookup[item.id];
        return {
          productName:  meta?.productName ?? productName,
          variantCode:  item.id,               // item.id = product_cat / SKU
          quantity:     item.quantity,
          unitPrice:    item.price,             // paise per pack
          packSize:     meta?.packSize ?? item.packSize ?? 1,
          displayName:  item.name,
        };
      });

      const res = await fetch("/api/draft-cart", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ dealer_id: dealerId, items }),
      });
      if (!res.ok) throw new Error("Save failed");

      router.push("/dashboard/dealer/AddOrderForm?from=cart");
    } catch {
      alert("Could not save cart. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  const totalPacks    = cart.reduce((acc, item) => acc + item.quantity, 0);
  const totalPcs      = cart.reduce((acc, item) => {
    const ps = lookup[item.id]?.packSize ?? item.packSize ?? 1;
    return acc + item.quantity * ps;
  }, 0);
  const subtotalPaise = cart.reduce((acc, item) => {
    const ps = lookup[item.id]?.packSize ?? item.packSize ?? 1;
    return acc + item.price * item.quantity * ps;
  }, 0);

  const handleRemove = (id: string) => {
    setRemoved(prev => [...prev, id]);
    setTimeout(() => remove(id), 260);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5", fontFamily: "'DM Sans', sans-serif" }}>
      
      {/* ── Breadcrumb bar ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "10px 24px", display: "flex", alignItems: "center", gap: 8 }}>
        <Link href="/Pages/products" style={{ fontSize: 13, color: "#6366f1", textDecoration: "none", fontWeight: 500 }}>
          Products
        </Link>

        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>

        <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>Shopping Cart</span>
        {cart.length > 0 && (
          <span style={{ marginLeft: 4, fontSize: 12, color: "#6b7280" }}>
            ({cart.length} item{cart.length !== 1 ? "s" : ""})
          </span>
        )}

        <button
          onClick={() => router.back()}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#fff", background: "#6A5ACD", border: "none", borderRadius: 20, padding: "6px 16px", cursor: "pointer" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back
        </button>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>


        {/* ── Cart Items Panel ─────────────────────────────────────── */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 20, overflow: "hidden" }}>

          {/* Panel header */}
          <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 600, color: "#111827", margin: 0 }}>Shopping Cart</h1>
              {cart.length > 0 && (
                <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 3, marginBottom: 0 }}>
                  {totalPacks} pack{totalPacks !== 1 ? "s" : ""} · {totalPcs} Pcs.
                </p>
              )}
            </div>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                style={{ fontSize: 13, color: "#ef4444", background: "none", border: "1px solid #fecaca", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontWeight: 500 }}
              >
                Clear all
              </button>
            )}
          </div>

          {/* Empty state */}
          {cart.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "72px 24px", gap: 16 }}>
              <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 17, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Your cart is empty</p>
                <p style={{ fontSize: 13, color: "#9ca3af" }}>Browse products and add items to get started</p>
              </div>
              <Link
                href="/Pages/products"
                style={{ marginTop: 4, padding: "10px 24px", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: "none" }}
              >
                Browse Products
              </Link>
            </div>
          )}

          {/* Item list */}
          <div>
            {cart.map((item, idx) => {
              const meta       = lookup[item.id];
              const packSize   = meta?.packSize ?? item.packSize ?? 1;
              const lineTotal  = item.price * item.quantity * packSize;
              const pcsCount   = item.quantity * packSize;
              const nameParts  = item.name.split(" - ");
              const prodName   = nameParts[0] ?? item.name;
              const varCode    = nameParts.length > 1 ? nameParts[nameParts.length - 1] : item.id;
              const isRemoving = removed.includes(item.id);

              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex", gap: 16, padding: "20px 24px",
                    borderBottom: idx < cart.length - 1 ? "1px solid #f9fafb" : "none",
                    opacity: isRemoving ? 0 : 1, transform: isRemoving ? "translateX(20px)" : "none",
                    transition: "opacity .25s, transform .25s",
                  }}
                >
                  {/* Image */}
                  <div style={{ width: 88, height: 88, borderRadius: 12, border: "1px solid #f3f4f6", background: "#fafafa", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                    {meta?.image ? (
                      <img src={meta.image} alt={prodName} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 6 }} />
                    ) : (
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                        <path d="m21 15-5-5L5 21"/>
                      </svg>
                    )}
                  </div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {prodName}
                    </p>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                      <span style={{ fontSize: 11, fontFamily: "monospace", background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>
                        {varCode}
                      </span>
                      {packSize > 1 && (
                        <span style={{ fontSize: 11, background: "#ede9fe", color: "#7c3aed", border: "1px solid #ddd6fe", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>
                          Pack of {packSize}
                        </span>
                      )}
                    </div>

                    {/* Quantity controls */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                        <button
                          onClick={() => decrement(item.id)}
                          style={{ width: 34, height: 34, border: "none", background: "transparent", cursor: "pointer", fontSize: 18, fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .15s" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f3f4f6")}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >−</button>
                        <span style={{ minWidth: 38, textAlign: "center", fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "monospace" }}>
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => increment(item.id)}
                          style={{ width: 34, height: 34, border: "none", background: "transparent", cursor: "pointer", fontSize: 18, fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", justifyContent: "center", transition: "background .15s" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f3f4f6")}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >+</button>
                      </div>

                      <span style={{ color: "#e5e7eb" }}>|</span>

                      <button
                        onClick={() => handleRemove(item.id)}
                        style={{ fontSize: 13, color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontWeight: 500, padding: 0 }}
                      >
                        Remove
                      </button>
                    </div>

                    {packSize > 1 && (
                      <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8, fontFamily: "monospace" }}>
                        {item.quantity} pack{item.quantity !== 1 ? "s" : ""} × {packSize} Pcs. = {pcsCount} Pcs. total
                      </p>
                    )}
                  </div>

                  {/* Price */}
                  <div style={{ textAlign: "right", flexShrink: 0, minWidth: 100 }}>
                    <p style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
                      {fmt(lineTotal)}
                    </p>
                    {item.quantity > 1 && (
                      <p style={{ fontSize: 11, color: "#9ca3af" }}>{fmt(item.price * packSize)} / pack</p>
                    )}
                    {packSize > 1 && (
                      <p style={{ fontSize: 11, color: "#9ca3af" }}>
                        {fmt(item.price)} / Pc.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Subtotal row */}
          {cart.length > 0 && (
            <div style={{ padding: "16px 24px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 6, background: "#fafafa" }}>
              <span style={{ fontSize: 14, color: "#6b7280" }}>
                Subtotal ({cart.length} item{cart.length !== 1 ? "s" : ""}):
              </span>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#111827", fontFamily: "monospace" }}>
                {fmt(subtotalPaise)}
              </span>
            </div>
          )}
        </div>

        {/* ── Order Summary Sidebar ──────────────────────────────────── */}
        <div style={{ position: "sticky", top: 20 }}>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 20, padding: 24, marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 20 }}>Order Summary</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#374151" }}>
                <span>Items</span>
                <span style={{ fontWeight: 600 }}>{cart.length}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#374151" }}>
                <span>Packs</span>
                <span style={{ fontWeight: 600 }}>{totalPacks}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#374151" }}>
                <span>Total Pcs.</span>
                <span style={{ fontWeight: 600 }}>{totalPcs}</span>
              </div>
              <div style={{ height: 1, background: "#f3f4f6", margin: "4px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: "#111827" }}>
                <span style={{ fontWeight: 600 }}>Subtotal</span>
                <span style={{ fontWeight: 700, fontFamily: "monospace" }}>{fmt(subtotalPaise)}</span>
              </div>
            </div>

            <button
              onClick={handleImportToOrder}
              disabled={cart.length === 0 || importing || !dealerId}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 12, border: "none",
                cursor: (cart.length === 0 || importing) ? "not-allowed" : "pointer",
                background: (cart.length === 0 || importing) ? "#e5e7eb" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                color: (cart.length === 0 || importing) ? "#9ca3af" : "#fff",
                fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "opacity .15s",
              }}
              onMouseEnter={e => !importing && cart.length > 0 && (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              {importing ? (
                <>
                  <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />
                  Saving…
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                  Import to Order
                </>
              )}
            </button>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

            <Link
              href="/Pages/products"
              style={{ display: "block", textAlign: "center", marginTop: 12, fontSize: 13, color: "#6366f1", textDecoration: "none", fontWeight: 500 }}
            >
              ← Continue Shopping
            </Link>
          </div>

          {/* Dealer note */}
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
              </svg>
              <p style={{ fontSize: 12, color: "#15803d", lineHeight: 1.5, margin: 0 }}>
                Your dealer discount and applicable coupons will be applied at the order confirmation step.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Responsive grid collapse */}
      <style>{`
        @media (max-width: 768px) {
          div[style*="grid-template-columns"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
