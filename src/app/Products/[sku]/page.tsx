'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import axios from 'axios';
import { useCartStore } from "@/Store/store";
import {
  getCatalogueProductDescriptor,
  getCatalogueProductLabel,
  getCatalogueSection,
} from '@/lib/catalogue';

// ─────────────────────────────────────────────────────────────
// TYPES  (matches omsons_products_from_excel_with_images.json)
// ─────────────────────────────────────────────────────────────
type Variant = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  specs: Record<string, string>;
  specsText: string;
  pack: number;
  price: number | null;       // rupees
  priceLabel: string;
  inStock: boolean;
  images: string[];
};

type Product = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  category: string;
  categories: string[];
  page: number;
  features: string[];
  descriptionHtml: string;
  images: string[];
  variants?: Variant[];
};

type QuantityValue = number | "";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function getImage(product: Product, idx = 0): string | null {
  return product.images?.[idx] ?? null;
}

function getVariantImage(product: Product, variant?: Variant | null): string | undefined {
  return (variant?.images ?? []).find(Boolean) ?? product.images?.find(Boolean) ?? undefined;
}

// All prices kept as paise internally so fmt() and the cart stay consistent.
function variantPricePaise(v: Variant | null): number | null {
  return typeof v?.price === "number" && v.price > 0 ? v.price * 100 : null;
}

function fmt(paise: number | null): string {
  if (paise === null) return "—";
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Unique spec keys across all variants — drives the table columns.
function quantityAsNumber(value: QuantityValue): number {
  return value === "" ? 0 : Math.max(0, value);
}

function parseQuantityInput(rawValue: string): QuantityValue {
  if (rawValue === "") return "";
  return Math.max(0, Number.parseInt(rawValue, 10) || 0);
}

function getSpecKeys(variants: Variant[]): string[] {
  const seen = new Set<string>();
  variants.forEach(v => Object.keys(v.specs ?? {}).forEach(k => seen.add(k)));
  return Array.from(seen);
}

// Related products: same top-level category, excluding self.
function getRelated(all: Product[], current: Product, limit = 6): Product[] {
  if (!current.categories?.length) return [];
  const topCat = current.categories[0].split(">")[0].trim();
  return all
    .filter(p => p.sku !== current.sku && (p.categories ?? []).some(c => c.startsWith(topCat)))
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────
// CART TOAST
// ─────────────────────────────────────────────────────────────
function CartToast({ item, onDone }: { item: { name: string; sku: string; bulk?: boolean } | null; onDone: () => void }) {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    if (!item) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVis(true);
    const t = setTimeout(() => { setVis(false); setTimeout(onDone, 300); }, 2500);
    return () => clearTimeout(t);
  }, [item, onDone]);
  if (!item) return null;
  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, transform: vis ? "translateY(0)" : "translateY(-14px)", opacity: vis ? 1 : 0, transition: "all 0.28s cubic-bezier(0.34,1.56,0.64,1)", pointerEvents: "none" }}>
      <div style={{ background: "#0f172a", color: "#fff", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.22)", minWidth: 260 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>{item.bulk ? "All variants added" : "Added to cart"}</p>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#94a3b8" }}>{item.name} · SKU {item.sku}</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NO IMAGE PLACEHOLDER
// ─────────────────────────────────────────────────────────────
function NoImageBox({ height = 280 }: { height?: number }) {
  return (
    <div style={{ width: "100%", height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#cbd5e1", background: "#f8fafc", borderRadius: 8 }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="m21 15-5-5L5 21"/>
      </svg>
      <span style={{ fontSize: 12 }}>No image available</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// RELATED CARD
// ─────────────────────────────────────────────────────────────
function RelatedCard({ product }: { product: Product }) {
  const img        = getImage(product, 0);
  const firstVar   = product.variants?.[0] ?? null;
  const pricePaise = variantPricePaise(firstVar);
  const packSize   = firstVar?.pack ?? 1;
  const perUnit    = pricePaise && packSize > 1 ? Math.round(pricePaise / packSize) : null;

  return (
    <Link href={`/Products/${product.sku}`} style={{ textDecoration: "none" }}>
      <div
        style={{ background: "#fff", borderRadius: 10, border: "1px solid #e8edf3", overflow: "hidden", transition: "box-shadow .2s, transform .2s" }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.10)"; el.style.transform = "translateY(-2px)"; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = "none"; el.style.transform = "translateY(0)"; }}
      >
        <div style={{ background: "#f8fafc", padding: 14, aspectRatio: "1/1", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {img
            ? <img src={img} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} loading="lazy" />
            : <NoImageBox height={120} />
          }
        </div>
        <div style={{ padding: "10px 12px 12px" }}>
          <h4 style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", lineHeight: 1.4, margin: "0 0 4px" }}>{product.name}</h4>
          <span style={{ fontSize: 10.5, color: "#94a3b8", display: "block", marginBottom: 5 }}>SKU: {product.sku}</span>
          {pricePaise !== null ? (
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#6A5ACD" }}>{fmt(pricePaise)}</span>
              {packSize > 1 && (
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <span style={{ fontSize: 10, color: "#64748b", background: "#f1f5f9", padding: "1px 5px", borderRadius: 3 }}>Pack of {packSize}</span>
                  {perUnit && <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmt(perUnit)}/unit</span>}
                </div>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>On request</p>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────
export default function ProductDetailsPage() {
  const params = useParams<{ sku?: string | string[] }>();
  const rawSku = Array.isArray(params?.sku) ? params.sku[0] : params?.sku;
  const sku = decodeURIComponent(String(rawSku ?? ""));
  const router = useRouter();

  const [allProducts,         setAllProducts]         = useState<Product[]>([]);
  const [product,             setProduct]             = useState<Product | null>(null);
  const [loading,             setLoading]             = useState(true);
  const [notFound,            setNotFound]            = useState(false);
  const [selectedVariantSKU,  setSelectedVariantSKU]  = useState<string | null>(null);
  const [selectedImageIdx,    setSelectedImageIdx]    = useState(0);
  const [rowPacks,            setRowPacks]            = useState<Record<string, QuantityValue>>({});
  const [toast,               setToast]               = useState<{ name: string; sku: string; bulk?: boolean } | null>(null);

  const addToCart = useCartStore(s => s.addToCart);
  const cart      = useCartStore(s => s.cart);

  // Sync row quantities from cart
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRowPacks(prev => {
      const u = { ...prev };
      cart.forEach(item => { if (item.id in u) u[item.id] = item.quantity ?? u[item.id]; });
      return u;
    });
  }, [cart]);

  // Fetch data
  useEffect(() => {
    axios.get("/data/omsons_products_from_excel_with_images.json")
      .then(res => {
        const data: Product[] = res.data;
        setAllProducts(data);

        // Match by product sku or by variant sku
        let found = data.find(p => p.sku === sku);
        if (!found) {
          found = data.find(p => p.variants?.some(v => v.sku === sku));
          if (found) setSelectedVariantSKU(sku);
        }

        if (found) {
          setProduct(found);
          if (!selectedVariantSKU && found.variants?.length)
            setSelectedVariantSKU(found.variants[0].sku);
          const init: Record<string, QuantityValue> = {};
          found.variants?.forEach(v => { init[v.sku] = cart.find(c => c.id === v.sku)?.quantity ?? 0; });
          setRowPacks(init);
        } else {
          setNotFound(true);
        }
        setLoading(false);
      })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [sku]);

  // ── Derived ───────────────────────────────────────────────
  const selectedVariant   = product?.variants?.find(v => v.sku === selectedVariantSKU) ?? null;
  const selectedQuantityValue = selectedVariantSKU
    ? rowPacks[selectedVariantSKU] ?? ""
    : "";
  const selectedQuantity  = quantityAsNumber(selectedQuantityValue);
  const displayPricePaise = variantPricePaise(selectedVariant);   // per unit (paise)
  const selectedPackSize  = selectedVariant?.pack ?? 1;
  const packPricePaise    = displayPricePaise !== null ? displayPricePaise * selectedPackSize : null;
  const perUnitPaise      = displayPricePaise;                    // price IS already per unit
  const lineTotalPaise    = displayPricePaise !== null
    ? displayPricePaise * selectedQuantity * selectedPackSize : null;     // price × total units

  // Spec keys from all variants → variant table columns
  const specKeys = product?.variants?.length ? getSpecKeys(product.variants) : [];

  // Per-row calculation for the variants table
  const rowCalc = (variantSku: string) => {
    const quantityValue = rowPacks[variantSku] ?? "";
    const numPacks  = quantityAsNumber(quantityValue);
    const vm        = product?.variants?.find(v => v.sku === variantSku);
    const packSize  = vm?.pack ?? 1;
    const unitPaise = variantPricePaise(vm ?? null) ?? 0;          // per unit
    const packPaise = unitPaise * packSize;              // per pack
    return {
      quantityValue, numPacks, packSize, unitPaise, packPaise,
      totalPaise: unitPaise * numPacks * packSize,       // price × total units
      perUnit: unitPaise || null,
    };
  };

  const related    = product ? getRelated(allProducts, product) : [];
  const inStock    = product?.variants?.some(v => v.inStock) ?? false;
  const stickyInCart = cart.some(c => c.id === selectedVariantSKU);
  const sectionLabel = product ? getCatalogueSection(product) : "";
  const descriptor = product ? getCatalogueProductDescriptor(product) : "";
  const canBuyNow = Boolean(
    selectedVariantSKU &&
    selectedVariant &&
    displayPricePaise !== null &&
    selectedQuantity > 0 &&
    selectedVariant.inStock
  );
  const canAddSelected = Boolean(
    selectedVariantSKU &&
    selectedVariant &&
    displayPricePaise !== null &&
    selectedQuantity > 0 &&
    selectedVariant.inStock
  );

  const updateSelectedQuantity = (
    nextValue: number | ((current: number) => number)
  ) => {
    if (!selectedVariantSKU) return;

    setRowPacks((previous) => {
      const current = quantityAsNumber(previous[selectedVariantSKU] ?? "");

      const next =
        typeof nextValue === "function"
          ? nextValue(current)
          : nextValue;

      return {
        ...previous,
        [selectedVariantSKU]: Math.max(0, Number.isFinite(next) ? Math.floor(next) : 0),
      };
    });
  };

  // ── Cart actions ──────────────────────────────────────────
  const addVariant = (vSku: string, name: string, pricePaise: number, qty: number, packSize: number, image?: string) => {
    addToCart({ id: vSku, name, price: pricePaise, packSize, image, initialQty: qty });
    setToast({ name, sku: vSku });
  };

  const addAll = () => {
    if (!product?.variants) return;
    product.variants.forEach(v => {
      const { numPacks, packSize, unitPaise } = rowCalc(v.sku);
      if (unitPaise <= 0 || numPacks <= 0 || !v.inStock) return;
      addToCart({ id: v.sku, name: v.name, price: unitPaise, packSize, image: getVariantImage(product, v), initialQty: numPacks });
    });
    setToast({ name: product.name, sku: `${product.variants.length} variants`, bulk: true });
  };

  const handleAddSelected = () => {
    if (!selectedVariantSKU || !product || !selectedVariant || displayPricePaise === null || selectedQuantity <= 0 || !selectedVariant.inStock) return;
    addVariant(
      selectedVariantSKU,
      selectedVariant.name ?? product.name,
      displayPricePaise,
      selectedQuantity,
      selectedPackSize,
      getVariantImage(product, selectedVariant)
    );
  };

  const handleAddRow = (variantSku: string) => {
    if (!product) return;
    const vm = product.variants?.find(v => v.sku === variantSku);
    const { numPacks, packSize, unitPaise } = rowCalc(variantSku);
    if (!vm || unitPaise <= 0 || numPacks <= 0 || !vm.inStock) return;
    addVariant(variantSku, vm?.name ?? product.name, unitPaise, numPacks, packSize, getVariantImage(product, vm));
    setSelectedVariantSKU(variantSku);
  };

  const handleBuyNow = () => {
    if (
      !selectedVariantSKU ||
      !selectedVariant ||
      !product ||
      displayPricePaise === null ||
      selectedQuantity <= 0 ||
      !selectedVariant.inStock
    ) {
      return;
    }

    addToCart({
      id: selectedVariantSKU,
      name: selectedVariant.name ?? product.name,
      price: displayPricePaise,
      packSize: selectedPackSize,
      image: getVariantImage(product, selectedVariant),
      initialQty: selectedQuantity,
    });

    router.push("/dashboard/dealer/AddOrderForm");
  };

  // ── Guards ────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#94a3b8", fontSize: 14 }}>Loading product…</p>
    </div>
  );
  if (notFound || !product) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
      <p style={{ color: "#64748b", fontSize: 14 }}>Product not found: <strong>{sku}</strong></p>
      <Link href="/Products" style={{ color: "#d97706", fontSize: 14, textDecoration: "underline" }}>← Back to Products</Link>
    </div>
  );

  const images = product.images?.filter(Boolean) ?? [];

  return (
    <>
      <CartToast item={toast} onDone={() => setToast(null)} />

      <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', sans-serif", color: "#0f172a" }}>

        {/* BREADCRUMB */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", padding: "12px 28px", fontSize: 13, color: "#64748b", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <Link href="/" style={{ color: "#64748b", textDecoration: "none" }}>Home</Link>
            <span>/</span>
            <Link href="/Products" style={{ color: "#64748b", textDecoration: "none" }}>Products</Link>
            {product.category && <>
              <span>/</span>
              <span>{product.category}</span>
            </>}
            <span>/</span>
            <span style={{ color: "#0f172a", fontWeight: 600 }}>{getCatalogueProductLabel(product)}</span>
          </div>
        </div>

        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 28px" }}>

          {/* ── 3-COLUMN LAYOUT ─────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 320px", gap: 36, alignItems: "start" }}>

            {/* IMAGE COLUMN */}
            <div style={{ display: "flex", gap: 10 }}>
              {images.length > 1 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {images.map((img, i) => (
                    <div key={i} onClick={() => setSelectedImageIdx(i)}
                      style={{ width: 58, height: 58, border: `2px solid ${selectedImageIdx === i ? "#6A5ACD" : "#e2e8f0"}`, borderRadius: 8, overflow: "hidden", cursor: "pointer", background: "#fff", padding: 4, transition: "border-color .2s", flexShrink: 0 }}>
                      <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ flex: 1, background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, minHeight: 320 }}>
                {images.length > 0
                  ? <img src={images[selectedImageIdx] ?? images[0]} alt={product.name} style={{ maxWidth: "100%", maxHeight: 280, objectFit: "contain" }} />
                  : <NoImageBox height={280} />
                }
              </div>
            </div>

            {/* INFO COLUMN */}
            <div>
              {/* Category tags */}
              {product.categories?.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {product.categories.map((cat, i) => (
                    <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", background: "#eff6ff", color: "#1e40af", borderRadius: 4, letterSpacing: ".05em", textTransform: "uppercase" }}>
                      {cat.split(">").pop()?.trim()}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {sectionLabel && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", background: "#eff6ff", color: "#1e40af", borderRadius: 4, letterSpacing: ".05em", textTransform: "uppercase" }}>
                    {sectionLabel}
                  </span>
                )}
                {descriptor && (
                  <span style={{ fontSize: 11, padding: "3px 8px", background: "#f8fafc", color: "#475569", borderRadius: 4 }}>
                    {descriptor}
                  </span>
                )}
              </div>

              <span style={{ fontSize: 11, color: "#94a3b8", display: "inline-block", marginBottom: 8, background: "#f1f5f9", padding: "2px 8px", borderRadius: 4 }}>
                SKU: {product.sku}
              </span>

              <h1 style={{ fontSize: 26, fontWeight: 300, lineHeight: 1.3, margin: "0 0 16px" }}>{getCatalogueProductLabel(product)}</h1>

              {/* Features / bullets */}
              {product.features?.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: ".07em", textTransform: "uppercase", margin: "0 0 10px" }}>About this item</p>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    {product.features.map((f, i) => (
                      <li key={i} style={{ display: "flex", gap: 10, fontSize: 13.5, color: "#374151", lineHeight: 1.5 }}>
                        <span style={{ color: "#f59e0b", fontWeight: 700, marginTop: 2, flexShrink: 0 }}>▸</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Variant chips */}
              {product.variants && product.variants.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: ".07em", textTransform: "uppercase", margin: "0 0 10px" }}>
                    Select Variant
                    {selectedVariantSKU && (
                      <span style={{ color: "#f59e0b", textTransform: "none", marginLeft: 6, fontWeight: 600 }}>
                        ({selectedVariantSKU})
                      </span>
                    )}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {(() => {
                      const firstVals = product.variants!.map(v => Object.values(v.specs ?? {})[0] ?? v.sku);
                      const hasDup = firstVals.length !== new Set(firstVals).size;
                      return product.variants!.map((v, idx) => {
                      const isSel  = selectedVariantSKU === v.sku;
                      const inCart = cart.some(c => c.id === v.sku);
                      const label  = hasDup
                        ? Object.values(v.specs ?? {}).join(" / ") || v.sku
                        : (Object.values(v.specs ?? {})[0] ?? v.sku);
                      return (
                        <button key={`${v.sku}-${idx}`} onClick={() => { setSelectedVariantSKU(v.sku); }}
                          style={{ position: "relative", padding: "6px 12px", fontSize: 12, borderRadius: 6,
                            border: `2px solid ${isSel ? "#6A5ACD" : inCart ? "#22c55e" : "#e2e8f0"}`,
                            background: isSel ? "#6A5ACD" : inCart ? "#f0fdf4" : "#fff",
                            color: isSel ? "#fff" : inCart ? "#15803d" : "#374151",
                            fontWeight: isSel ? 700 : 500, cursor: "pointer", transition: "all .15s" }}>
                          {label}
                          {inCart && !isSel && (
                            <span style={{ position: "absolute", top: -5, right: -5, width: 10, height: 10, borderRadius: "50%", background: "#22c55e", border: "2px solid #fff" }} />
                          )}
                        </button>
                      );
                    });
                    })()}
                  </div>
                </div>
              )}

              {/* Selected variant summary */}
              {selectedVariant && (
                <div style={{ background: "#f8fafc", borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "#64748b" }}>Catalogue No.</span>
                    <span style={{ fontWeight: 700 }}>{selectedVariant.sku}</span>
                  </div>
                  {Object.entries(selectedVariant.specs).map(([k, val]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: "#64748b" }}>{k}</span>
                      <span style={{ fontWeight: 600 }}>{val}</span>
                    </div>
                  ))}
                  {selectedPackSize > 1 && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: "#64748b" }}>Pack of</span>
                      <span style={{ fontWeight: 700 }}>{selectedPackSize} Pcs.</span>
                    </div>
                  )}
                  {perUnitPaise !== null && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: "#64748b" }}>Price per unit</span>
                      <span style={{ fontWeight: 700, color: "#64748b" }}>{fmt(perUnitPaise)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "#64748b" }}>{selectedPackSize > 1 ? "Price per pack" : "Price"}</span>
                    <span style={{ fontWeight: 700, color: "#6A5ACD" }}>{packPricePaise !== null ? fmt(packPricePaise) : "On request"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#64748b" }}>Availability</span>
                    <span style={{ fontWeight: 700, color: selectedVariant.inStock ? "#16a34a" : "#dc2626" }}>
                      {selectedVariant.inStock ? "In Stock" : "Out of Stock"}
                    </span>
                  </div>
                </div>
              )}

              {/* Meta */}
              <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 13, color: "#475569", borderTop: "1px solid #f1f5f9", paddingTop: 14 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "#0f172a", minWidth: 110 }}>Supplier:</span>
                  <span>Omson Scientific Labs</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "#0f172a", minWidth: 110 }}>Certification:</span>
                  <span>NABL Certified, ISO 9001:2015</span>
                </div>
              </div>
            </div>

            {/* PURCHASE CARD */}
            <div style={{ background: "#fff", border: "2px solid #e2e8f0", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", gap: 18, position: "sticky", top: 20 }}>

              {/* Price */}
              <div>
                <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 4px" }}>
                  {product.variants && product.variants.length > 1 ? "Starting from" : "Price"}
                </p>
                {packPricePaise !== null ? (
                  <>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#0f172a" }}>{fmt(packPricePaise)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                      {selectedPackSize > 1 && (
                        <span style={{ fontSize: 11.5, color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                          Pack of {selectedPackSize}
                        </span>
                      )}
                      {displayPricePaise !== null && (
                        <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
                          = {fmt(displayPricePaise)} / unit
                        </span>
                      )}
                    </div>
                    {selectedQuantity > 0 && lineTotalPaise !== null && (
                      <p style={{ fontSize: 12, color: "#64748b", margin: "6px 0 0" }}>
                        {selectedPackSize > 1
                          ? `${selectedQuantity} packs × ${selectedPackSize} Pcs. = `
                          : `${selectedQuantity} Pcs. × `}
                        <strong>{fmt(lineTotalPaise)}</strong>
                      </p>
                    )}
                  </>
                ) : (
                  <p style={{ fontSize: 16, fontWeight: 600, color: "#94a3b8", margin: 0 }}>Price on request</p>
                )}
              </div>

              {/* Availability */}
              <div style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: "#64748b" }}>Availability</span>
                  <span style={{ fontWeight: 700, color: inStock ? "#16a34a" : "#dc2626" }}>
                    {inStock ? "In Stock" : "Out of Stock"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b" }}>Ships from</span>
                  <span style={{ fontWeight: 600 }}>Delhi · Mumbai · Chennai</span>
                </div>
              </div>

              {/* Quantity spinner */}
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>
                  {selectedPackSize > 1 ? "Packs:" : "Quantity:"}
                </p>
                <div style={{ display: "flex", alignItems: "center", border: "1px solid #e2e8f0", borderRadius: 8, width: "fit-content" }}>
                  <button onClick={() => updateSelectedQuantity(current => Math.max(0, current - 1))} style={{ padding: "8px 16px", border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "#374151" }}>−</button>
                   <input 
                    type="number" 
                    value={selectedQuantityValue} 
                    onChange={(e) => {
                      const rawValue = e.target.value;
                      if (!selectedVariantSKU) return;
                      setRowPacks((previous) => ({
                        ...previous,
                        [selectedVariantSKU]: parseQuantityInput(rawValue),
                      }));
                    }} 
                    style={{ padding: "1px 1px", fontSize: 15, fontWeight: 700, borderLeft: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", width:60, textAlign: "center" }} 
                    min={0}
                  />
                  <button onClick={() => updateSelectedQuantity(current => current + 1)} style={{ padding: "8px 16px", border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "#374151" }}>+</button>
                </div>
              </div>

              <button onClick={handleAddSelected} disabled={!canAddSelected}
                style={{ width: "100%", padding: "13px 0", fontSize: 14, fontWeight: 700, borderRadius: 10, border: "2px solid",
                  cursor: !canAddSelected ? "not-allowed" : "pointer", transition: "all .15s",
                  background: stickyInCart ? "#f0fdf4" : "#6A5ACD",
                  borderColor: stickyInCart ? "#22c55e" : "#6A5ACD",
                  color: stickyInCart ? "#15803d" : "#fff",
                  opacity: !canAddSelected ? 0.5 : 1 }}>
                {stickyInCart ? "✓ Added — Add More" : "Add to Cart"}
              </button>

              {/* <button
                onClick={handleBuyNow}
                disabled={!canBuyNow}
                style={{ width: "100%", padding: "13px 0", fontSize: 14, fontWeight: 700, borderRadius: 10, border: "2px solid #0f172a", background: "#fff", cursor: canBuyNow ? "pointer" : "not-allowed", color: "#0f172a", transition: "background .15s", opacity: canBuyNow ? 1 : 0.5 }}
                onMouseEnter={e => { if (canBuyNow) e.currentTarget.style.background = "#f8fafc"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#fff"; }}>
                Buy Now
              </button> */}

              {product.variants && product.variants.length > 1 && (
                <p style={{ fontSize: 11, color: "#94a3b8", margin: 0, textAlign: "center" }}>
                  {product.variants.length} variants · prices may vary by size
                </p>
              )}
            </div>
          </div>

          {/* ── VARIANTS TABLE ─────────────────────────────── */}
          {product.variants && product.variants.length > 0 && specKeys.length > 0 && (
            <div style={{ marginTop: 56 }}>
              <h2 style={{ fontSize: 20, fontWeight: 300, margin: "0 0 16px" }}>Variants &amp; Specifications</h2>

              <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff" }}>
                <table style={{ width: "100%", fontSize: 13, textAlign: "left", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "12px 16px", fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>CAT NO</th>
                      {specKeys.map(k => (
                        <th key={k} style={{ padding: "12px 16px", fontWeight: 700, color: "#374151", whiteSpace: "nowrap" }}>{k}</th>
                      ))}
                      <th style={{ padding: "12px 16px", fontWeight: 700, color: "#374151" }}>Qty</th>
                      <th style={{ padding: "12px 16px", fontWeight: 700, color: "#374151" ,  display:"none"}}>Price</th>
                      <th style={{ padding: "12px 16px", fontWeight: 700, color: "#374151" }}>Price/Unit</th>
                      <th style={{ padding: "12px 16px", fontWeight: 700, color: "#374151" }}>Total</th>
                      <th style={{ padding: "12px 16px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {product.variants.map((v, idx) => {
                      const isSel    = v.sku === selectedVariantSKU;
                      const { quantityValue, numPacks, packSize, unitPaise, packPaise, totalPaise } = rowCalc(v.sku);
                      const cartItem = cart.find(c => c.id === v.sku);
                      const canAddRow = unitPaise > 0 && numPacks > 0 && v.inStock;

                      return (
                        <tr key={`${v.sku}-${idx}`}
                          onClick={() => setSelectedVariantSKU(v.sku)}
                          style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#fefce8" : "transparent", transition: "background .15s" }}
                          onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "#f8fafc"; }}
                          onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>

                          {/* CAT NO */}
                          <td style={{ padding: "11px 16px", color: "#d97706", fontWeight: 700, whiteSpace: "nowrap" }}>
                            {v.sku}
                          </td>

                          {/* Spec columns */}
                          {specKeys.map(k => (
                            <td key={k} style={{ padding: "11px 16px", color: "#374151" }}>
                              {v.specs?.[k] ?? "—"}
                            </td>
                          ))}

                          {/* Qty spinner */}
                          <td style={{ padding: "11px 16px" }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
                                <button onClick={() => setRowPacks((previous) => ({ ...previous, [v.sku]: Math.max(0, quantityAsNumber(previous[v.sku] ?? "") - 1) }))}
                                  style={{ padding: "4px 8px", border: "none", background: "#f8fafc", cursor: "pointer", fontSize: 14, color: "#374151" }}>−</button>
                                <input
                                  type="number"
                                  value={quantityValue}
                                  onChange={(e) => {
                                    const rawValue = e.target.value;
                                    setRowPacks((previous) => ({ ...previous, [v.sku]: parseQuantityInput(rawValue) }));
                                  }}
                                  style={{ width: 48, padding: "4px 4px", fontSize: 12, fontWeight: 700, borderLeft: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", border: "none", borderLeftStyle: "solid", borderLeftWidth: 1, borderLeftColor: "#e2e8f0", borderRightStyle: "solid", borderRightWidth: 1, borderRightColor: "#e2e8f0", textAlign: "center", outline: "none", MozAppearance: "textfield", background: "transparent" }}
                                  min={0}
                                />
                                <button onClick={() => setRowPacks((previous) => ({ ...previous, [v.sku]: quantityAsNumber(previous[v.sku] ?? "") + 1 }))}
                                  style={{ padding: "4px 8px", border: "none", background: "#f8fafc", cursor: "pointer", fontSize: 14, color: "#374151" }}>+</button>
                              </div>
                              {(cartItem?.quantity ?? 0) > 0 && (
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap" }}>
                                  {cartItem!.quantity} in cart
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: 10, color: "#1e1e1e", marginTop: 3, display: "block" }}>
                              = {numPacks * packSize} {packSize > 1 ? "Pcs." : "Pcs."}
                            </span>
                          </td>

                          <td style={{ padding: "11px 16px", color: "#374151", fontWeight: 600 , display:"none" }}>
                            {packPaise ? fmt(packPaise) : "On request"}
                          </td>

                          <td style={{ padding: "11px 16px", color: "#1e1e1e", fontSize: 12 }}>
                            {unitPaise ? fmt(unitPaise) : "On request"}
                          </td>

                          <td style={{ padding: "11px 16px" }} onClick={e => e.stopPropagation()}>
                            <span style={{ fontWeight: 700, color: totalPaise ? "#15803d" : "#94a3b8" }}>{totalPaise ? fmt(totalPaise) : "On request"}</span>
                          </td>

                          <td style={{ padding: "11px 16px" }} onClick={e => e.stopPropagation()}>
                            <button onClick={() => handleAddRow(v.sku)}
                              disabled={!canAddRow}
                              style={{ padding: "6px 14px", fontSize: 12, fontWeight: 700, background: "#6A5ACD", color: "#fff", border: "none", borderRadius: 6, cursor: canAddRow ? "pointer" : "not-allowed", whiteSpace: "nowrap", transition: "background .15s", opacity: canAddRow ? 1 : 0.5 }}
                              onMouseEnter={e => { if (canAddRow) e.currentTarget.style.background = "#0f2a4a"; }}
                              onMouseLeave={e => (e.currentTarget.style.background = "#6A5ACD")}>
                              Add to Cart
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
                Click a row to select · Prices shown per pack
              </p>
            </div>
          )}

          {/* ── RELATED PRODUCTS ──────────────────────────── */}
          <div style={{ marginTop: 64, paddingTop: 48, borderTop: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 300, margin: 0 }}>Related Products</h2>
              <Link href="/Products" style={{ fontSize: 13, color: "#6A5ACD", fontWeight: 700, textDecoration: "none" }}>View All →</Link>
            </div>
            {related.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 16 }}>
                {related.map(p => <RelatedCard key={p.sku} product={p} />)}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <Link href="/Products" style={{ display: "inline-block", padding: "10px 24px", background: "#6A5ACD", color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 700 }}>
                  Browse All Products →
                </Link>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

