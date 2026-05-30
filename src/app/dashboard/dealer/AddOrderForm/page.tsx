// app/order/page.tsx
"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import axios from "axios";
import { useRouter, useSearchParams } from "next/navigation";
import { toast, ToastContainer } from "react-toastify";
import Select from "react-select";
import moment from "moment";
import { useCartStore } from "@/Store/store";
import discountUtils from "@/lib/discount";
import {
  saveDraft,
  updateDraft,
  getDraftById,
  type DraftProductRow,
} from "@/lib/drafts";
import { useDraft } from "@/lib/useDrafts";
import { buildPriorityRemarks } from "@/lib/orderPriority";

const { calculateStackedDiscount, getDiscountStatusMessage } = discountUtils;

// ─── Types ────────────────────────────────────────────────────────────────────
type ProductRow = {
  key: number;
  productname: string;
  displayName: string;
  variantCode: string;
  producQuanity: number;
  price: number; // rupees per unit
  packSize: number;
  isPriority?: boolean;
};

type OptionType = { value: string; label: string; price: number };
type CustomDiscountScope = "order" | "product";

type CustomDiscountRequest = {
  id: string;
  dealerId?: string;
  status: "pending" | "approved" | "rejected";
  discountScope?: CustomDiscountScope;
  requestedDiscountPercent: number;
  currentDiscountPercent: number;
  orderSignature: string;
  allowReorder?: boolean;
  targetProduct?: {
    productKey?: string;
    productname?: string;
    displayName?: string;
    variantCode?: string;
  };
  products?: any[];
  shipto?: string;
  refno?: string;
  orderNote?: string;
  adminNote?: string;
  createdAt?: string;
  reviewedAt?: string | null;
};

// ─── Product meta from nested_products.json ───────────────────────────────────
type ProductMeta = { image: string | null; productName: string; packSize: number };

function buildVariantLookup(data: any[]): Record<string, ProductMeta> {
  const map: Record<string, ProductMeta> = {};
  for (const product of data) {
    const image = (product.Images ?? []).find(Boolean) ?? null;
    const desc = product.Description ?? "";
    const packMap = parsePackSizes(desc);
    for (const variant of product.variants ?? []) {
      map[variant.SKU] = { image, productName: product.Name, packSize: packMap[variant.SKU] ?? 1 };
    }
  }
  return map;
}

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

/** Format paise → ₹ string */
function fmt(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toPaise(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

function payloadAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return String(Math.round((amount + Number.EPSILON) * 100) / 100);
}

function roundRupees(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function safePositiveNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function cartPriceToRupees(rawPrice: unknown, apiPrice: unknown = 0): number {
  const cartPrice = safePositiveNumber(rawPrice);
  const fallbackPrice = safePositiveNumber(apiPrice);
  if (!cartPrice) return fallbackPrice;

  const cartPriceAsRupees = roundRupees(cartPrice / 100);
  if (!fallbackPrice) return cartPriceAsRupees;

  if (Math.abs(cartPriceAsRupees - fallbackPrice) <= Math.max(0.01, fallbackPrice * 0.01)) {
    return fallbackPrice;
  }

  return cartPrice >= fallbackPrice * 20 ? cartPriceAsRupees : cartPrice;
}

function rowSubtotalPaise(row: ProductRow): number {
  const quantity = safePositiveNumber(row.producQuanity);
  const packSize = safePositiveNumber(row.packSize) || 1;
  const price = safePositiveNumber(row.price);
  return Math.max(0, Math.round(quantity * packSize * price * 100));
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function buildOrderSignature(rows: ProductRow[], subtotalAmount: number): string {
  const items = rows
    .filter((r) => r.productname)
    .map((r) => ({
      productname: r.productname,
      quantity: safePositiveNumber(r.producQuanity),
      price: safePositiveNumber(r.price),
      packSize: safePositiveNumber(r.packSize) || 1,
      priority: !!r.isPriority,
    }));
  return hashString(JSON.stringify({ subtotal: payloadAmount(subtotalAmount), items }));
}

function getProductKey(row: ProductRow): string {
  return String(row.variantCode || row.productname || "").trim();
}

function buildProductSignature(row: ProductRow): string {
  return buildOrderSignature([row], rowSubtotalPaise(row) / 100);
}

function buildOrderRemarks(variantCode: string, isPriority: boolean | undefined, orderNote: string): string {
  const remarks = buildPriorityRemarks(variantCode, isPriority);
  const note = orderNote.trim();
  return [remarks, note ? `Order note: ${note}` : ""].filter(Boolean).join(" | ");
}

function extractOrderIdFromResponse(data: any): string {
  const candidates = [
    data?.order_id,
    data?.orderId,
    data?.Order_Id,
    data?.OrderID,
    data?.id,
    data?.lastid,
    data?.last_id,
    data?.data?.order_id,
    data?.data?.orderId,
    data?.data?.id,
    Array.isArray(data?.data) ? data.data[0]?.order_id : undefined,
  ];
  const direct = candidates.find((v) => v !== undefined && v !== null && String(v).trim());
  if (direct) return String(direct).trim();

  const msg = String(data?.msg || data?.message || "");
  return msg.match(/OM\/\d{4}\/(\d+)/i)?.[1] || msg.match(/order\s*(?:id|no\.?)?\s*#?\s*(\d+)/i)?.[1] || "";
}

// ─── Coupons ──────────────────────────────────────────────────────────────────
const COUPONS: Record<string, number> = {
  "test60": 60,
  "SAVE50": 50,
  "VIP80": 80,
};

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api";

// ─── Empty row factory ────────────────────────────────────────────────────────
const emptyRow = (): ProductRow => ({
  key: Date.now() + Math.random(),
  productname: "",
  displayName: "",
  variantCode: "",
  producQuanity: 1,
  price: 0,
  packSize: 1,
  isPriority: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// Inner component — uses useSearchParams so must live inside <Suspense>
// ─────────────────────────────────────────────────────────────────────────────
function AddOrderPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdParam = searchParams.get("draft");
  const reorderIdParam = searchParams.get("reorder");

  const cartItems = useCartStore((s) => s.cart);
  const clearCart = useCartStore((s) => s.clearCart);

  const fromCart = searchParams.get("from") === "cart";

  const [loading, setLoading] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [variantLookup, setVariantLookup] = useState<Record<string, ProductMeta>>({});
  const [shipto, setShipto] = useState("");
  const [refno, setRefno] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tab, setTab] = useState<"manual" | "excel">("manual");
  const [mounted, setMounted] = useState(false);
  const seededRef = useRef(false);

  // ── Draft state ───────────────────────────────────────────────────────────
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("Untitled Draft");
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingDraftName, setPendingDraftName] = useState("");
  const [draftBanner, setDraftBanner] = useState<string | null>(null);

  // ── Coupon state ──────────────────────────────────────────────────────────
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; pct: number } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponSuccess, setCouponSuccess] = useState("");

  // ── Order note + custom discount approval ────────────────────────────────
  const [orderNote, setOrderNote] = useState("");
  const [showCustomDiscountEditor, setShowCustomDiscountEditor] = useState(false);
  const [customDiscountInput, setCustomDiscountInput] = useState("");
  const [customDiscountScope, setCustomDiscountScope] = useState<CustomDiscountScope>("order");
  const [customDiscountProductKey, setCustomDiscountProductKey] = useState("");
  const [customDiscountSubmitting, setCustomDiscountSubmitting] = useState(false);
  const [customDiscountRequests, setCustomDiscountRequests] = useState<CustomDiscountRequest[]>([]);
  const [reorderRequest, setReorderRequest] = useState<CustomDiscountRequest | null>(null);

  const [arr1, setArr] = useState<ProductRow[]>([emptyRow()]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const stored = localStorage.getItem("UserData");
    const loggedIn = localStorage.getItem("status");
    if (!stored || JSON.parse(loggedIn ?? "false") !== true) { router.push("/login"); return; }
    const u = JSON.parse(stored);
    setUser(u);
    setShipto(u.Dealer_Address[0].toUpperCase() + u.Dealer_Address.slice(1).toLowerCase());
  }, []);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch(`${BACKEND_URL}/productname`).then(r => r.json()),
      axios.get("/data/products.json").then(r => r.data),
    ]).then(([apiData, localData]) => {
      setProducts(apiData.data ?? []);
      setVariantLookup(buildVariantLookup(localData));
    }).catch(() => {
      fetch(`${BACKEND_URL}/productname`)
        .then(r => r.json()).then(d => setProducts(d.data ?? []));
    });
  }, [user]);

  useEffect(() => {
    if (!user?.Dealer_Id) return;
    fetch(`/api/custom-discount-requests?dealer_id=${encodeURIComponent(user.Dealer_Id)}&limit=25`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setCustomDiscountRequests(json.data ?? []);
      })
      .catch(() => { });
  }, [user?.Dealer_Id]);

  // ── Load draft from ?draft=<id> (via React Query cache) ────────────────────
  const { data: cachedDraft, isError: draftError } = useDraft(
    user?.Dealer_Id,
    draftIdParam
  );

  useEffect(() => {
    if (!reorderIdParam || !user || products.length === 0) return;
    if (seededRef.current) return;

    setReorderLoading(true);
    fetch(`/api/custom-discount-requests/${encodeURIComponent(reorderIdParam)}`)
      .then((r) => {
        if (r.status === 404) throw new Error("NOT_FOUND");
        if (!r.ok) throw new Error("NETWORK");
        return r.json();
      })
      .then((json) => {
        if (!json.success) throw new Error("API_FAIL");
        const req = json.data as CustomDiscountRequest;

        if (String(req.dealerId) !== String(user.Dealer_Id)) throw new Error("WRONG_DEALER");
        if (!req.allowReorder) throw new Error("REVOKED");
        if (req.status !== "approved") throw new Error("NOT_APPROVED");

        const rows: ProductRow[] = (req.products || []).map((p: any, i: number) => {
          const match = products.find(
            (prod: any) => String(prod.product_cat).trim() === String(p.productname).trim()
          );
          return {
            key: i + 1,
            productname: p.productname || match?.product_cat || "",
            displayName: p.displayName || match?.product_name || p.productname || "",
            variantCode: p.variantCode || p.productname || match?.product_cat || "",
            producQuanity: safePositiveNumber(p.quantity) || 1,
            price: safePositiveNumber(p.price) || safePositiveNumber(match?.product_price),
            packSize: safePositiveNumber(p.packSize) || 1,
            isPriority: !!(p.priority || p.isPriority),
          };
        });

        seededRef.current = true;
        setReorderRequest(req);
        setArr(rows.length > 0 ? rows : [emptyRow()]);
        if (req.shipto) setShipto(req.shipto);
        if (req.refno) setRefno(req.refno);
        if (req.orderNote) setOrderNote(req.orderNote);
        setDraftBanner(null);
      })
      .catch((err) => {
        seededRef.current = true;
        const messages: Record<string, string> = {
          NOT_FOUND: "This discount request no longer exists.",
          WRONG_DEALER: "This discount request does not belong to your account.",
          REVOKED: "Reorder permission has been revoked by admin.",
          NOT_APPROVED: "This discount request is not approved.",
          NETWORK: "Could not load reorder data. Please try again.",
          API_FAIL: "Could not load reorder data.",
        };
        toast.error(messages[err?.message] || messages.NETWORK);
        window.history.replaceState({}, "", "/dashboard/dealer/AddOrderForm");
      })
      .finally(() => setReorderLoading(false));
  }, [reorderIdParam, user, products]);

  useEffect(() => {
    if (!draftIdParam || !user || products.length === 0) return;
    if (seededRef.current) return;
    if (!cachedDraft && !draftError) return;        // still loading

    seededRef.current = true;

    if (draftError || !cachedDraft) {
      toast.error("Draft not found or does not belong to your account.");
      return;
    }

    setActiveDraftId(cachedDraft.id);
    setDraftName(cachedDraft.name);
    if (cachedDraft.shipto) setShipto(cachedDraft.shipto);
    if (cachedDraft.refno) setRefno(cachedDraft.refno);
    if (cachedDraft.order_note) setOrderNote(cachedDraft.order_note);
    if (cachedDraft.coupon_code && cachedDraft.coupon_pct) {
      setAppliedCoupon({ code: cachedDraft.coupon_code, pct: cachedDraft.coupon_pct });
    }
    setArr(cachedDraft.rows.length > 0 ? cachedDraft.rows : [emptyRow()]);
    setDraftBanner(`Loaded: "${cachedDraft.name}"`);
  }, [draftIdParam, user, products, cachedDraft, draftError]);

  // ── Seed rows from DraftCart (when navigated from Cart page) ─────────────
  useEffect(() => {
    if (!fromCart || !user || products.length === 0) return;
    if (reorderIdParam) return;
    if (seededRef.current) return;
    seededRef.current = true;

    fetch(`/api/draft-cart?dealer_id=${encodeURIComponent(user.Dealer_Id)}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && Array.isArray(json.data?.items) && json.data.items.length > 0) {
          const rows: ProductRow[] = json.data.items.map((item: any, i: number) => {
            const match = products.find(
              (p: any) =>
                String(p.product_cat).trim() === String(item.variantCode).trim() ||
                String(p.product_id).trim() === String(item.variantCode).trim()
            );
            return {
              key: i + 1,
              productname: match ? String(match.product_cat) : item.variantCode,
              displayName: match ? (match.product_name ?? item.productName) : item.productName,
              variantCode: item.variantCode,
              producQuanity: item.quantity,
              price: cartPriceToRupees(item.unitPrice, match?.product_price),
              packSize: item.packSize ?? 1,
              isPriority: item.isPriority ?? item.priority ?? false,
            };
          });
          setArr(rows);
          setDraftBanner(`${rows.length} item${rows.length !== 1 ? "s" : ""} imported from your cart`);
        } else {
          setArr([emptyRow()]);
        }
      })
      .catch(() => toast.error("Could not load cart draft."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromCart, user, products, reorderIdParam]);

  // ── Seed rows from cart ───────────────────────────────────────────────────
  useEffect(() => {
    if (seededRef.current) return;
    if (products.length === 0) return;
    if (draftIdParam) return;
    if (reorderIdParam) return;
    if (fromCart) return;           // DraftCart takes priority when ?from=cart
    seededRef.current = true;

    if (cartItems.length === 0) { setArr([emptyRow()]); return; }

    const cartRows: ProductRow[] = cartItems.map((item, i) => {
      const match = products.find(
        (p) =>
          String(p.product_cat).trim() === String(item.id).trim() ||
          String(p.product_id).trim() === String(item.id).trim()
      );
      const nameParts = item.name.split(" - ");
      const productName = nameParts[0] ?? item.name;
      const variantCode = nameParts.length > 1 ? nameParts[nameParts.length - 1] : item.id;
      const localMeta = variantLookup[item.id];
      const packSize = localMeta?.packSize ?? (item as any).packSize ?? 1;
      const cartPrice = Number(item.price);
      const apiPrice = match ? Number(match.product_price) : 0;
      const price = cartPriceToRupees(cartPrice, apiPrice);

      return {
        key: i + 1,
        productname: match ? String(match.product_cat) : String(item.id),
        displayName: match ? (match.product_name ?? productName) : productName,
        variantCode,
        producQuanity: item.quantity,
        price,
        packSize,
        isPriority: item.isPriority ?? false,
      };
    });

    setArr(cartRows);
  }, [products, cartItems, variantLookup, draftIdParam, reorderIdParam]);

  // ── Discount ──────────────────────────────────────────────────────────────
  const subtotalPaise = arr1.reduce((acc, row) => acc + rowSubtotalPaise(row), 0);
  const subtotal = subtotalPaise / 100;
  const dealerDiscount = safePositiveNumber(user?.discount);
  const couponDiscount = appliedCoupon?.pct ?? 0;
  const baseDiscountPayload = calculateStackedDiscount(subtotal, {
    allocatedDiscountPercent: dealerDiscount,
    couponDiscountPercent: couponDiscount,
  });
  const currentOrderSignature = buildOrderSignature(arr1, subtotal);
  const productRows = arr1.filter((r) => r.productname);
  const selectedCustomDiscountProduct = productRows.find((r) => getProductKey(r) === customDiscountProductKey) ?? productRows[0] ?? null;
  const selectedCustomDiscountSignature = selectedCustomDiscountProduct ? buildProductSignature(selectedCustomDiscountProduct) : "";
  const customDiscountBaseSubtotal = customDiscountScope === "product" && selectedCustomDiscountProduct
    ? rowSubtotalPaise(selectedCustomDiscountProduct) / 100
    : subtotal;
  const matchingCustomRequests = customDiscountRequests.filter(
    (r) => (r.discountScope ?? "order") !== "product" && r.orderSignature === currentOrderSignature
  );
  const approvedCustomRequest = matchingCustomRequests.find((r) => r.status === "approved");
  const pendingCustomRequest = matchingCustomRequests.find((r) => r.status === "pending");
  const rejectedCustomRequest = matchingCustomRequests.find((r) => r.status === "rejected");
  const matchingProductCustomRequests = selectedCustomDiscountSignature
    ? customDiscountRequests.filter(
      (r) => (r.discountScope ?? "order") === "product" && r.orderSignature === selectedCustomDiscountSignature
    )
    : [];
  const approvedProductCustomRequest = matchingProductCustomRequests.find((r) => r.status === "approved");
  const pendingProductCustomRequest = matchingProductCustomRequests.find((r) => r.status === "pending");
  const rejectedProductCustomRequest = matchingProductCustomRequests.find((r) => r.status === "rejected");
  const visibleCustomRequest = customDiscountScope === "product"
    ? approvedProductCustomRequest ?? pendingProductCustomRequest ?? rejectedProductCustomRequest ?? null
    : approvedCustomRequest ?? pendingCustomRequest ?? rejectedCustomRequest ?? null;
  const reorderDiscountPercent = reorderRequest && (reorderRequest.discountScope ?? "order") !== "product"
    ? Math.min(100, Math.max(0, Number(reorderRequest.requestedDiscountPercent) || 0))
    : null;
  const approvedCustomDiscountPercent = reorderDiscountPercent ?? (approvedCustomRequest
    ? Math.min(100, Math.max(0, Number(approvedCustomRequest.requestedDiscountPercent) || 0))
    : null);
  const getApprovedProductCustomRequest = (row: ProductRow) => {
    const rowSignature = buildProductSignature(row);
    if (
      reorderRequest?.status === "approved" &&
      (reorderRequest.discountScope ?? "order") === "product" &&
      reorderRequest.orderSignature === rowSignature
    ) {
      return reorderRequest;
    }
    return customDiscountRequests.find(
      (r) => r.status === "approved" && (r.discountScope ?? "order") === "product" && r.orderSignature === rowSignature
    );
  };
  const getRowDiscountPercent = (row: ProductRow) => {
    if (approvedCustomDiscountPercent !== null) return approvedCustomDiscountPercent;
    const productRequest = getApprovedProductCustomRequest(row);
    if (productRequest) return Math.min(100, Math.max(0, Number(productRequest.requestedDiscountPercent) || 0));
    return baseDiscountPayload.discountPercent;
  };
  const discountAmountFromRows = productRows.reduce((acc, row) => (
    acc + (rowSubtotalPaise(row) / 100) * (getRowDiscountPercent(row) / 100)
  ), 0);
  const effectiveDiscountPercent = subtotal > 0
    ? Number(payloadAmount((discountAmountFromRows / subtotal) * 100))
    : 0;
  const discountPayload = {
    ...baseDiscountPayload,
    discountPercent: approvedCustomDiscountPercent !== null ? approvedCustomDiscountPercent : effectiveDiscountPercent,
    discountAmount: Number(payloadAmount(discountAmountFromRows)),
    finalPayableAmount: Number(payloadAmount(Math.max(0, subtotal - discountAmountFromRows))),
  };
  const activeDiscount: number = discountPayload.discountPercent;
  const discountAmountPaise = toPaise(discountPayload.discountAmount);
  const finalPayablePaise = toPaise(discountPayload.finalPayableAmount);
  const discountStatusMessage = getDiscountStatusMessage(discountPayload.slabDiscountPercent);
  const hasSlabDiscount = discountPayload.slabDiscountPercent > 0;
  const hasAnyDiscount = discountPayload.discountPercent > 0;
  const approvedProductCustomRequests = approvedCustomDiscountPercent !== null
    ? []
    : productRows
      .map((row) => getApprovedProductCustomRequest(row))
      .filter((r): r is CustomDiscountRequest => !!r);
  const hasApprovedCustomDiscount = approvedCustomDiscountPercent !== null || approvedProductCustomRequests.length > 0;
  const requestedCustomDiscountPercent = Math.min(100, Math.max(0, Number(customDiscountInput) || 0));
  const requestedCustomDiscountAmount = customDiscountBaseSubtotal * (requestedCustomDiscountPercent / 100);
  const requestedCustomFinalPayable = Math.max(0, customDiscountBaseSubtotal - requestedCustomDiscountAmount);

  // ── Coupon handlers ───────────────────────────────────────────────────────
  const handleApplyCoupon = () => {
    setCouponError(""); setCouponSuccess("");
    const trimmed = couponInput.trim().toUpperCase();
    if (!trimmed) { setCouponError("Please enter a coupon code."); return; }
    const pct = COUPONS[trimmed];
    if (pct === undefined) { setCouponError("Invalid coupon code."); return; }
    setAppliedCoupon({ code: trimmed, pct });
    setCouponSuccess(`"${trimmed}" applied — ${pct}% coupon discount added`);
    setCouponInput("");
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null); setCouponError(""); setCouponSuccess(""); setCouponInput("");
  };

  const refreshCustomDiscountRequests = async () => {
    if (!user?.Dealer_Id) return [];
    const res = await fetch(`/api/custom-discount-requests?dealer_id=${encodeURIComponent(user.Dealer_Id)}&limit=25`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message ?? "Could not load discount requests");
    setCustomDiscountRequests(json.data ?? []);
    return json.data ?? [];
  };

  const handleRequestCustomDiscount = async () => {
    if (arr1.every(r => !r.productname)) { toast("Please select at least one product before requesting approval."); return; }
    if (customDiscountScope === "product" && !selectedCustomDiscountProduct) {
      toast("Please select a product for product-level discount approval.");
      return;
    }
    if (requestedCustomDiscountPercent <= baseDiscountPayload.discountPercent) {
      toast(`Enter a custom discount above the current ${baseDiscountPayload.discountPercent}%.`);
      return;
    }

    setCustomDiscountSubmitting(true);
    try {
      const scopedRows = customDiscountScope === "product" && selectedCustomDiscountProduct
        ? [selectedCustomDiscountProduct]
        : arr1.filter(r => r.productname);
      const scopedSubtotal = customDiscountScope === "product" ? customDiscountBaseSubtotal : subtotal;
      const scopedSignature = customDiscountScope === "product" && selectedCustomDiscountProduct
        ? buildProductSignature(selectedCustomDiscountProduct)
        : currentOrderSignature;
      const requestProducts = scopedRows.map((r) => ({
        productname: r.productname,
        displayName: r.displayName,
        variantCode: r.variantCode,
        quantity: r.producQuanity,
        price: r.price,
        packSize: r.packSize,
        priority: !!r.isPriority,
        rowSubtotal: payloadAmount(rowSubtotalPaise(r) / 100),
      }));

      const res = await fetch("/api/custom-discount-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerId: user.Dealer_Id,
          dealerName: user.Dealer_Name,
          dealerCode: user.Dealer_Dealercode,
          dealerEmail: user.Dealer_Email,
          dealerPhone: user.Dealer_Number,
          requestedDiscountPercent: requestedCustomDiscountPercent,
          currentDiscountPercent: baseDiscountPayload.discountPercent,
          subtotal: Number(payloadAmount(scopedSubtotal)),
          currentDiscountAmount: Number(payloadAmount(scopedSubtotal * (baseDiscountPayload.discountPercent / 100))),
          requestedDiscountAmount: Number(payloadAmount(requestedCustomDiscountAmount)),
          currentFinalPayable: Number(payloadAmount(Math.max(0, scopedSubtotal - scopedSubtotal * (baseDiscountPayload.discountPercent / 100)))),
          requestedFinalPayable: Number(payloadAmount(requestedCustomFinalPayable)),
          discountScope: customDiscountScope,
          targetProduct: selectedCustomDiscountProduct ? {
            productKey: getProductKey(selectedCustomDiscountProduct),
            productname: selectedCustomDiscountProduct.productname,
            displayName: selectedCustomDiscountProduct.displayName,
            variantCode: selectedCustomDiscountProduct.variantCode,
          } : null,
          shipto,
          refno,
          orderNote: orderNote.trim(),
          orderSignature: scopedSignature,
          discountBreakdown: {
            allocatedDiscountPercent: baseDiscountPayload.allocatedDiscountPercent,
            slabDiscountPercent: baseDiscountPayload.slabDiscountPercent,
            couponDiscountPercent: baseDiscountPayload.couponDiscountPercent,
            couponCode: appliedCoupon?.code ?? "",
          },
          products: requestProducts,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Request failed");
      setCustomDiscountRequests((prev) => [json.data, ...prev.filter((r) => r.id !== json.data.id)]);
      toast.success("Custom discount request sent to admin.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not request custom discount.");
    } finally {
      setCustomDiscountSubmitting(false);
    }
  };

  // ── Select options ────────────────────────────────────────────────────────
  const optionList: OptionType[] = products.map((p) => ({
    value: String(p.product_cat),
    label: `${p.product_cat} — ${p.product_name}${p.product_discription ? ` (${p.product_discription})` : ""}`,
    price: Number(p.product_price),
  }));

  const getSelectValue = (row: ProductRow): OptionType | null =>
    optionList.find((o) => String(o.value).trim() === String(row.productname).trim()) ?? null;

  // ── Row helpers ───────────────────────────────────────────────────────────
  const handleChangeSelect = (opt: OptionType, idx: number) => {
    const labelParts = opt.label.split(" — ");
    const catNo = labelParts[0]?.trim() ?? opt.value;
    const rest = labelParts.slice(1).join(" — ");
    const namePart = rest.split("(")[0].trim();
    const localMeta = variantLookup[opt.value];
    const packSize = localMeta?.packSize ?? 1;

    setArr((prev) => {
      const n = [...prev];
      n[idx] = { ...n[idx], productname: opt.value, displayName: namePart || opt.label, variantCode: catNo, price: opt.price, packSize };
      return n;
    });
  };

  const updateQuantity = (i: number, val: number) => {
    const v = Math.max(1, val || 1);
    setArr((prev) => { const n = [...prev]; n[i] = { ...n[i], producQuanity: v }; return n; });
  };

  const togglePriority = (i: number) => {
    setArr((prev) => {
      const n = [...prev];
      n[i] = { ...n[i], isPriority: !n[i].isPriority };
      return n;
    });
  };

  const addRow = () => setArr((prev) => [...prev, emptyRow()]);
  const removeRow = (key: number) => setArr((prev) => prev.filter((r) => r.key !== key));

  // ── Save Draft ────────────────────────────────────────────────────────────
  const commitSaveDraft = async (nameToUse: string) => {
    if (!user) return;
    setShowNameModal(false);
    setDraftSaving(true);
    const draftRows: DraftProductRow[] = arr1.map((r) => ({ ...r }));
    try {
      if (activeDraftId) {
        await updateDraft(activeDraftId, user.Dealer_Id, {
          name: nameToUse, shipto, refno,
          order_note: orderNote.trim() || null,
          coupon_code: appliedCoupon?.code ?? null,
          coupon_pct: appliedCoupon?.pct ?? null,
          rows: draftRows,
        });
        setDraftName(nameToUse);
        toast.success("Draft updated ✓");
      } else {
        const created = await saveDraft({
          dealer_id: user.Dealer_Id, name: nameToUse, shipto, refno,
          order_note: orderNote.trim() || null,
          coupon_code: appliedCoupon?.code ?? null,
          coupon_pct: appliedCoupon?.pct ?? null,
          rows: draftRows,
        });
        setActiveDraftId(created.id);
        setDraftName(nameToUse);
        toast.success("Draft saved ✓");
        window.history.replaceState({}, "", `/order?draft=${created.id}`);
      }
    } catch {
      toast.error("Could not save draft.");
    } finally {
      setDraftSaving(false);
    }
  };

  const handleSaveDraft = () => {
    if (arr1.every(r => !r.productname)) { toast("Add at least one product before saving a draft."); return; }
    if (activeDraftId) {
      commitSaveDraft(draftName);
    } else {
      setPendingDraftName(`Draft ${moment().format("MMM D, h:mm a")}`);
      setShowNameModal(true);
    }
  };

  const fetchLatestOrderId = async () => {
    if (!user?.Dealer_Id) return "";
    try {
      const res = await fetch(`${BACKEND_URL}/orderhispegination?page=1&search=&id=${encodeURIComponent(user.Dealer_Id)}`);
      const json = await res.json();
      return String(json?.data?.[0]?.order_id ?? "").trim();
    } catch {
      return "";
    }
  };

  const saveOrderNoteForHistory = async (orderId: string) => {
    const note = orderNote.trim();
    if (!orderId || !note || !user?.Dealer_Id) return;
    await fetch("/api/order-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        dealerId: user.Dealer_Id,
        dealerName: user.Dealer_Name,
        note,
      }),
    }).catch(() => { });
  };

  // ── Submit Order ──────────────────────────────────────────────────────────
  const handleSubmitProductArray = async () => {
    if (arr1.every(r => !r.productname)) { toast("Please select at least one product"); return; }
    setLoading(true);
    const payload = arr1.filter(r => r.productname).map(r => {
      const rowDiscountPercent = getRowDiscountPercent(r);
      const rowSubtotal = rowSubtotalPaise(r) / 100;
      const rowDiscountAmount = rowSubtotal * (rowDiscountPercent / 100);
      return {
        productname: r.productname,
        producQuanity: String(r.producQuanity),
        price: String(r.price),
        discount: payloadAmount(rowDiscountAmount),
        discountPercent: String(rowDiscountPercent),
        afterDiscountPrice: payloadAmount(Math.max(0, rowSubtotal - rowDiscountAmount)),
        remarks: buildOrderRemarks(r.variantCode, r.isPriority, orderNote),
        priority: r.isPriority ? "1" : "0",
        isPriority: !!r.isPriority,
      };
    });

    console.log(payload.map(r=>r.price))
    const fd = new FormData();
    fd.append("productorder", JSON.stringify(payload));
    fd.append("Dealer_shipto", shipto);
    fd.append("id", user.Dealer_Id);
    fd.append("discount", String(activeDiscount));
    fd.append("subtotal", payloadAmount(discountPayload.subtotal));
    fd.append("discountPercent", String(discountPayload.discountPercent));
    fd.append("discountAmount", payloadAmount(discountPayload.discountAmount));
    fd.append("finalPayableAmount", payloadAmount(discountPayload.finalPayableAmount));
    fd.append("allocatedDiscountPercent", String(discountPayload.allocatedDiscountPercent));
    fd.append("slabDiscountPercent", String(discountPayload.slabDiscountPercent));
    fd.append("couponDiscountPercent", String(discountPayload.couponDiscountPercent));
    if (orderNote.trim()) {
      fd.append("note", orderNote.trim());
      fd.append("order_note", orderNote.trim());
      fd.append("Dealer_note", orderNote.trim());
    }
    const customDiscountSources = [
      ...(reorderRequest ? [reorderRequest] : approvedCustomRequest ? [approvedCustomRequest] : []),
      ...approvedProductCustomRequests,
    ].filter((request, idx, arr) => arr.findIndex((r) => r.id === request.id) === idx);
    if (customDiscountSources.length > 0) {
      fd.append("customDiscountRequestId", customDiscountSources.map((r) => r.id).join(","));
      fd.append("customDiscountStatus", customDiscountSources.every((r) => r.status === "approved") ? "approved" : customDiscountSources[0].status);
      fd.append("customDiscountPercent", String(discountPayload.discountPercent));
      fd.append("customDiscountRequests", JSON.stringify(customDiscountSources.map((r) => ({
        id: r.id,
        scope: r.discountScope ?? "order",
        percent: r.requestedDiscountPercent,
        product: r.targetProduct ?? null,
      }))));
    }
    if (refno) fd.append("refno", refno);
    if (appliedCoupon) fd.append("coupon_code", appliedCoupon.code);
    try {
      const { data } = await axios.post(
        `${BACKEND_URL}/PlaceOrderarray?id=${user.Dealer_Id}&staffid=${user.assignedstaff}`,
        fd
      );
      const placedOrderId = extractOrderIdFromResponse(data) || await fetchLatestOrderId();
      await saveOrderNoteForHistory(placedOrderId);
      if (reorderRequest) {
        fetch(`/api/custom-discount-requests/${reorderRequest.id}/reorder-log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: placedOrderId,
            dealerId: user.Dealer_Id,
          }),
        }).catch((err) => console.error("[reorder-log] failed:", err));
      }
      toast.success(data.msg, { autoClose: 5000 });
      clearCart();
      seededRef.current = false;
      setArr([emptyRow()]);
      setOrderNote("");
      handleRemoveCoupon();
      setActiveDraftId(null);
      setDraftBanner(null);
      setReorderRequest(null);
      // Clear the DraftCart from MongoDB if this order originated from the cart page
      if (fromCart && user?.Dealer_Id) {
        fetch(`/api/draft-cart?dealer_id=${encodeURIComponent(user.Dealer_Id)}`, { method: "DELETE" }).catch(() => { });
      }
    } catch {
      toast.error("Order failed, please try again.", { autoClose: 5000 });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    const fd = new FormData();
    fd.append("staffid", user.assignedstaff);
    fd.append("order_dealer", user.Dealer_Id);
    fd.append("exelefile", file);
    try {
      const { data } = await axios.post(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/importdata`, fd);
      toast.success(data.msg);
    } catch {
      toast.error("Upload failed.");
    } finally {
      setLoading(false);
    }
  };

  if (!user) return (
    <div className="flex items-center justify-center h-[60vh] text-gray-400 text-sm">Loading…</div>
  );

  const docDate = moment().format("MMMM Do YYYY");

  const selectStyles = {
    control: (base: any, state: any) => ({
      ...base,
      border: `1px solid ${state.isFocused ? "#6366f1" : "#e5e7eb"}`,
      borderRadius: 10, boxShadow: state.isFocused ? "0 0 0 3px rgba(99,102,241,0.1)" : "none",
      fontSize: 13, minHeight: 38, fontFamily: "inherit",
      "&:hover": { borderColor: "#d1d5db" },
    }),
    option: (base: any, state: any) => ({
      ...base, fontSize: 13,
      backgroundColor: state.isSelected ? "#6366f1" : state.isFocused ? "#f5f5ff" : "white",
      color: state.isSelected ? "#fff" : "#111827",
    }),
    placeholder: (base: any) => ({ ...base, color: "#9ca3af", fontSize: 13 }),
    singleValue: (base: any) => ({ ...base, color: "#111827", fontSize: 13 }),
    menu: (base: any) => ({ ...base, borderRadius: 10, border: "1px solid #e5e7eb", boxShadow: "0 8px 30px rgba(0,0,0,0.1)" }),
    indicatorSeparator: () => ({ display: "none" }),
  };

  return (
    <>
      <ToastContainer position="top-right" autoClose={5000} />

      {/* ── Draft Name Modal ──────────────────────────────────────────────── */}
      {showNameModal && (
        <div className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-[15px] font-bold text-gray-900 mb-1">Save as Draft</h3>
            <p className="text-[12.5px] text-gray-400 mb-4">Give this draft a name so you can find it easily.</p>
            <input
              autoFocus
              type="text"
              value={pendingDraftName}
              onChange={(e) => setPendingDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pendingDraftName.trim()) commitSaveDraft(pendingDraftName.trim());
                if (e.key === "Escape") setShowNameModal(false);
              }}
              placeholder="e.g. Q2 Restock Order"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[13.5px] text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => pendingDraftName.trim() && commitSaveDraft(pendingDraftName.trim())}
                disabled={!pendingDraftName.trim()}
                className="flex-1 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-[13px] font-semibold transition-colors cursor-pointer border-none"
              >
                Save Draft
              </button>
              <button
                onClick={() => setShowNameModal(false)}
                className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-[13px] font-medium transition-colors cursor-pointer border-none"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Busy overlay ──────────────────────────────────────────────────── */}
      {(loading || draftSaving || reorderLoading) && (
        <div className="fixed inset-0 z-[999] bg-black/35 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl px-10 py-7 flex flex-col items-center gap-3 shadow-2xl">
            <div className="w-9 h-9 border-[3px] border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
            <span className="text-sm font-medium text-gray-600">
              {reorderLoading ? "Loading reorder data..." : draftSaving ? "Saving draft…" : "Processing…"}
            </span>
          </div>
        </div>
      )}

      <div className="p-7 max-w-[1440px] mx-auto font-[family-name:var(--font-dm-sans)]">

        {/* Draft loaded banner */}
        {draftBanner && (
          <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 mb-5 text-[12.5px] text-indigo-700 font-medium">
            <div className="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              {draftBanner}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => router.push("/drafts")}
                className="text-indigo-500 hover:text-indigo-700 text-[11.5px] underline underline-offset-2 cursor-pointer">
                All Drafts
              </button>
              <button onClick={() => setDraftBanner(null)} className="text-indigo-400 hover:text-indigo-600 cursor-pointer">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {reorderRequest && (
          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 mb-5 text-[12.5px] text-emerald-700 font-medium">
            <div className="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                <path d="M3 21v-5h5" />
                <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              Reorder from approved discount - {reorderRequest.requestedDiscountPercent}% discount locked
            </div>
            <button
              onClick={() => {
                setReorderRequest(null);
                seededRef.current = false;
                window.history.replaceState({}, "", "/dashboard/dealer/AddOrderForm");
              }}
              className="text-emerald-500 hover:text-emerald-700 cursor-pointer"
              title="Clear reorder"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Page heading */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Place Order</h1>
            <p className="text-sm text-gray-500 mt-1">{docDate} · {user.Dealer_Name}</p>
          </div>
          <button onClick={() => router.push("/drafts")}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-gray-400 hover:text-indigo-600 border border-gray-200 hover:border-indigo-200 hover:bg-indigo-50 px-3 py-2 rounded-xl transition-all cursor-pointer bg-white">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            My Drafts
          </button>
        </div>

        {/* Dealer info card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-5">
          <h2 className="text-lg font-bold text-gray-900 tracking-tight">{user.Dealer_Name}</h2>
          <p className="text-xs text-gray-400 mb-5">Dealer code: {user.Dealer_Dealercode ?? "—"}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Bill To</label>
              <div className="text-[13.5px] text-gray-800 font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 min-h-[72px] whitespace-pre-wrap">
                {user.Dealer_Address[0].toUpperCase() + user.Dealer_Address.slice(1).toLowerCase()}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">GST Number</label>
              <div className="text-[13.5px] text-gray-800 font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 font-mono">{user.gst}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Ship To</label>
              <textarea
                className="text-[13.5px] text-gray-800 bg-white border border-gray-200 rounded-xl px-3 py-2.5 outline-none resize-none min-h-[72px] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                value={shipto} onChange={(e) => setShipto(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Document Date</label>
              <div className="text-[13.5px] text-gray-800 font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">{docDate}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Phone</label>
              <div className="text-[13.5px] text-gray-800 font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 font-mono">{user.Dealer_Number}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Email</label>
              <div className="text-[13.5px] text-gray-800 font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 truncate">{user.Dealer_Email}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Customer Ref No.</label>
              <input type="text" placeholder="Enter reference number" value={refno} onChange={(e) => setRefno(e.target.value)}
                className="text-[13.5px] text-gray-800 bg-white border border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-gray-300" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Discount Rate</label>
                <button
                  type="button"
                  onClick={() => {
                    setCustomDiscountInput(String(visibleCustomRequest?.requestedDiscountPercent ?? activeDiscount));
                    setShowCustomDiscountEditor(true);
                  }}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-lg px-2 py-1 transition-colors"
                >
                  ✏️ Edit
                </button>
              </div>
              <div className={`text-[13.5px] font-semibold rounded-xl px-3 py-2.5 border flex items-center justify-between ${hasAnyDiscount ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-slate-600 bg-slate-50 border-slate-200"
                }`}>
                <span>{discountPayload.discountPercent}% total discount</span>
                <span className="text-[11px] font-medium">{hasApprovedCustomDiscount ? "custom approved" : `${dealerDiscount}% allocated`}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Discount Stack */}
        <div className={`border rounded-2xl p-5 mb-5 ${hasAnyDiscount ? "bg-emerald-50/70 border-emerald-200" : "bg-white border-gray-200"
          }`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${hasAnyDiscount ? "bg-emerald-600 border-emerald-600 text-white" : "bg-slate-50 border-slate-200 text-slate-500"
                }`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1" />
                </svg>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-900">Combined Discount</p>
                <p className={`text-[12px] mt-0.5 ${hasAnyDiscount ? "text-emerald-700" : "text-gray-500"}`}>
                  Allocated discount + slab discount + coupon code
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <button
                type="button"
                onClick={() => {
                  setCustomDiscountInput(String(visibleCustomRequest?.requestedDiscountPercent ?? activeDiscount));
                  setShowCustomDiscountEditor((v) => !v);
                }}
                className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-[12px] font-bold text-indigo-700 hover:bg-indigo-50 transition-colors sm:col-span-1"
              >
                <span>✏️</span>
                Custom Discount
              </button>
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Subtotal</p>
                <p className="font-mono text-[13px] font-semibold text-gray-900">{fmt(subtotalPaise)}</p>
              </div>
              <div className={`rounded-xl border px-3 py-2 ${hasAnyDiscount ? "border-emerald-200 bg-white text-emerald-700" : "border-gray-200 bg-white text-gray-500"
                }`}>
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">Savings</p>
                <p className="font-mono text-[13px] font-bold">{hasAnyDiscount ? `-${fmt(discountAmountPaise)}` : fmt(0)}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Allocated</p>
              <p className="mt-1 font-mono text-[13px] font-semibold text-gray-900">{discountPayload.allocatedDiscountPercent}%</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Slab</p>
              <p className={`mt-1 font-mono text-[13px] font-semibold ${hasSlabDiscount ? "text-emerald-700" : "text-gray-500"}`}>
                {discountPayload.slabDiscountPercent}%
              </p>
              <p className="mt-0.5 text-[10px] text-gray-400">{discountStatusMessage}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Coupon</p>
              <p className={`mt-1 font-mono text-[13px] font-semibold ${appliedCoupon ? "text-violet-700" : "text-gray-500"}`}>
                {discountPayload.couponDiscountPercent}%
              </p>
              <p className="mt-0.5 text-[10px] text-gray-400">{appliedCoupon?.code ?? "No code applied"}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Total</p>
              <p className="mt-1 font-mono text-[13px] font-bold text-emerald-700">{discountPayload.discountPercent}%</p>
            </div>
          </div>
        </div>

        {(showCustomDiscountEditor || visibleCustomRequest) && (
          <div className="bg-white border border-indigo-200 rounded-2xl p-5 mb-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[14px] font-bold text-gray-900">Custom Discount Approval</h3>
                  {visibleCustomRequest && (
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${visibleCustomRequest.status === "approved"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : visibleCustomRequest.status === "rejected"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}>
                      {visibleCustomRequest.status === "rejected" ? "Disapproved" : visibleCustomRequest.status}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-gray-500 mt-1">
                  Request a one-time discount for this order or one selected product. Approved requests are applied automatically while the matching items stay unchanged.
                </p>
                {visibleCustomRequest?.discountScope === "product" && (
                  <p className="mt-2 text-[12px] font-semibold text-indigo-700">
                    Product: {visibleCustomRequest.targetProduct?.displayName || visibleCustomRequest.targetProduct?.variantCode || "Selected product"}
                  </p>
                )}
                {visibleCustomRequest?.adminNote && (
                  <p className="mt-2 text-[12px] text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                    Admin note: {visibleCustomRequest.adminNote}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] min-w-[260px]">
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="font-bold uppercase tracking-wider text-gray-400">Current</p>
                  <p className="mt-1 font-mono text-[13px] font-bold text-gray-900">{baseDiscountPayload.discountPercent}%</p>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                  <p className="font-bold uppercase tracking-wider text-indigo-500">Requested</p>
                  <p className="mt-1 font-mono text-[13px] font-bold text-indigo-700">
                    {visibleCustomRequest?.requestedDiscountPercent ?? requestedCustomDiscountPercent}%
                  </p>
                </div>
              </div>
            </div>

            {showCustomDiscountEditor && (
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[220px_260px_1fr_auto] lg:items-end">
                <div>
                  <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Applies To</label>
                  <select
                    value={customDiscountScope}
                    onChange={(e) => setCustomDiscountScope(e.target.value as CustomDiscountScope)}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13.5px] font-semibold text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="order">Entire order</option>
                    <option value="product">Individual product</option>
                  </select>
                </div>
                {customDiscountScope === "product" && (
                  <div>
                    <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Product</label>
                    <select
                      value={selectedCustomDiscountProduct ? getProductKey(selectedCustomDiscountProduct) : ""}
                      onChange={(e) => setCustomDiscountProductKey(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13.5px] font-semibold text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    >
                      {productRows.map((row) => (
                        <option key={`${row.key}-${getProductKey(row)}`} value={getProductKey(row)}>
                          {row.variantCode || row.productname} - {row.displayName || "Product"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Custom Discount %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={customDiscountInput}
                    onChange={(e) => setCustomDiscountInput(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13.5px] font-mono font-semibold text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    placeholder="e.g. 18"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-gray-200 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Requested Savings</p>
                    <p className="mt-1 font-mono text-[13px] font-bold text-indigo-700">-{fmt(toPaise(requestedCustomDiscountAmount))}</p>
                  </div>
                  <div className="rounded-xl border border-gray-900 bg-gray-900 px-3 py-2 text-white">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Requested Payable</p>
                    <p className="mt-1 font-mono text-[13px] font-bold">{fmt(toPaise(requestedCustomFinalPayable))}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleRequestCustomDiscount}
                    disabled={customDiscountSubmitting || requestedCustomDiscountPercent <= baseDiscountPayload.discountPercent}
                    className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {customDiscountSubmitting ? "Sending..." : "Request Approval"}
                  </button>
                  <button
                    type="button"
                    onClick={() => refreshCustomDiscountRequests()
                      .then(() => toast.success("Approval status refreshed."))
                      .catch(() => toast.error("Could not refresh approval status."))}
                    className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Refresh
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Coupon */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-violet-500">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1" />
            </svg>
            <span className="text-[13px] font-semibold text-gray-800">Discount Code</span>
            {appliedCoupon && (
              <span className="ml-auto text-[11px] font-bold px-2.5 py-0.5 bg-violet-100 text-violet-700 rounded-full border border-violet-200">
                {appliedCoupon.code} · +{appliedCoupon.pct}%
              </span>
            )}
          </div>
          {!appliedCoupon ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="text" placeholder="Enter discount code" value={couponInput}
                onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(""); setCouponSuccess(""); }}
                onKeyDown={e => { if (e.key === "Enter") handleApplyCoupon(); }}
                className={`flex-1 text-[13px] text-gray-900 border rounded-xl px-4 py-2.5 outline-none transition-all font-mono tracking-wider placeholder:text-gray-300 placeholder:font-normal ${couponError ? "border-red-300 bg-red-50/30 focus:ring-2 focus:ring-red-100" : "border-gray-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  }`}
              />
              <button onClick={handleApplyCoupon} disabled={!couponInput.trim()}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-xl transition-colors">
                Apply
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                </div>
                <div>
                  <p className="text-[13px] font-bold text-violet-800 font-mono tracking-wider">{appliedCoupon.code}</p>
                  <p className="text-[11px] text-violet-600 mt-0.5">Coupon adds {appliedCoupon.pct}% to the allocated and slab discounts</p>
                </div>
              </div>
              <button onClick={handleRemoveCoupon}
                className="text-[12px] font-semibold text-violet-600 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-all border border-violet-200 hover:border-red-200">
                Remove
              </button>
            </div>
          )}
          {couponError && (
            <p className="text-[12px] text-red-600 mt-2 flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
              {couponError}
            </p>
          )}
          {couponSuccess && appliedCoupon && <p className="text-[12px] text-emerald-600 mt-2">{couponSuccess}</p>}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {(["manual", "excel"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-xl text-[13px] font-medium border transition-all duration-150 cursor-pointer ${tab === t ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700"
                }`}>
              {t === "manual" ? "Manual Entry" : "Upload Excel"}
            </button>
          ))}
        </div>

        {/* ── MANUAL TAB ───────────────────────────────────────────────────── */}
        {tab === "manual" && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">

            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-[15px] font-semibold text-gray-900">Product List</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {arr1.filter(r => r.productname).length} product{arr1.filter(r => r.productname).length !== 1 ? "s" : ""} selected
                  {activeDraftId && <span className="ml-2 text-indigo-500 font-medium">· {draftName}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {hasAnyDiscount && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[11px] font-semibold">
                    {discountPayload.discountPercent}% total discount
                  </span>
                )}
                {cartItems.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[11px] font-semibold">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                    {cartItems.length} from cart
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="pl-6 pr-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-10">#</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 min-w-[360px]">Product / Priority</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">Cat. No / Variant</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-32">Quantity</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">Pack Size</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-24">Pieces</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">List Price</th>
                    <th className={`px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider w-28 ${hasAnyDiscount ? "text-emerald-600" : "text-gray-400"}`}>
                      Discount
                    </th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">Final Price</th>
                    <th className="pl-3 pr-6 py-3 w-14"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {arr1.map((row, idx) => {
                    const listPrice = rowSubtotalPaise(row);
                    const rowDiscountPercent = getRowDiscountPercent(row);
                    const discAmt = Math.round(listPrice * (rowDiscountPercent / 100));
                    const rowTotal = Math.max(0, listPrice - discAmt);
                    const totalUnits = safePositiveNumber(row.producQuanity) * (safePositiveNumber(row.packSize) || 1);
                    const meta = variantLookup[row.productname];

                    return (
                      <tr key={row.key} className="hover:bg-gray-50/50 transition-colors">
                        <td className="pl-6 pr-3 py-3">
                          <span className="text-[11px] text-gray-300 font-mono">{String(idx + 1).padStart(2, "0")}</span>
                        </td>
                        <td className="px-3 py-3">
                          {row.productname && (row.displayName || meta) && (
                            <div className="flex items-center gap-2 mb-2">
                              {meta?.image ? (
                                <img src={meta.image} alt={row.displayName}
                                  className="w-8 h-8 object-contain rounded border border-gray-100 bg-gray-50 flex-shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded border border-gray-100 bg-gray-50 flex-shrink-0 flex items-center justify-center">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
                                    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                                  </svg>
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-[12px] font-semibold text-gray-800 truncate leading-tight">
                                  {row.displayName || meta?.productName || row.productname}
                                </p>
                                {row.isPriority && (
                                  <span className="inline-flex mt-1 px-2 py-0.5 bg-red-50 border border-red-200 text-red-700 rounded-full text-[10px] font-bold">
                                    Priority delivery
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <div className="min-w-[240px] flex-1">
                              <Select
                                options={optionList}
                                placeholder="Search and select product…"
                                value={getSelectValue(row)}
                                onChange={(opt) => opt && handleChangeSelect(opt, idx)}
                                isSearchable
                                styles={selectStyles}
                                menuPortalTarget={mounted ? document.body : undefined}
                                menuPosition="fixed"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => togglePriority(idx)}
                              title="Mark this product as priority"
                              className={`inline-flex h-[38px] shrink-0 items-center gap-2 rounded-xl border px-3 text-[11px] font-bold transition-colors ${row.isPriority
                                  ? "bg-red-600 border-red-600 text-white shadow-sm"
                                  : "bg-white border-red-200 text-red-600 hover:bg-red-50"
                                }`}
                            >
                              <span
                                className={`relative inline-flex h-4 w-7 items-center rounded-full ${row.isPriority ? "bg-white/30" : "bg-red-100"
                                  }`}
                              >
                                <span
                                  className={`inline-block h-3 w-3 rounded-full transition-transform ${row.isPriority ? "translate-x-3.5 bg-white" : "translate-x-0.5 bg-red-500"
                                    }`}
                                />
                              </span>
                              {row.isPriority ? "Priority on" : "Priority"}
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {row.variantCode ? (
                            <span className="inline-flex items-center px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-[11px] font-mono font-semibold whitespace-nowrap">
                              {row.variantCode}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-[11px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden w-fit">
                            <button onClick={() => updateQuantity(idx, row.producQuanity - 1)}
                              className="w-8 h-[34px] flex items-center justify-center bg-gray-50 hover:bg-gray-100 text-gray-600 text-base transition-colors border-none cursor-pointer">−</button>
                            <input type="number" value={row.producQuanity} onChange={(e) => updateQuantity(idx, parseInt(e.target.value) || 1)} min={1}
                              className="w-12 h-[34px] text-center text-[13px] font-semibold text-gray-900 font-mono border-x border-gray-200 outline-none bg-white" />
                            <button onClick={() => updateQuantity(idx, row.producQuanity + 1)}
                              className="w-8 h-[34px] flex items-center justify-center bg-gray-50 hover:bg-gray-100 text-gray-600 text-base transition-colors border-none cursor-pointer">+</button>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-1 font-mono">{row.producQuanity} pack{row.producQuanity !== 1 ? "s" : ""}</p>
                        </td>
                        <td className="px-3 py-3">
                          {row.packSize > 1 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[11px] font-semibold font-mono">
                              {row.producQuanity} × {row.packSize}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 bg-gray-50 border border-gray-200 text-gray-500 rounded text-[11px] font-mono">
                              1
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-[12px] font-bold font-mono">
                            {totalUnits}
                          </span>
                          <p className="text-[10px] text-gray-400 mt-0.5">pc{totalUnits !== 1 ? "s" : ""}</p>
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-mono text-[13px] text-gray-600 font-semibold">
                            {listPrice > 0 ? fmt(listPrice) : "—"}
                          </span>
                          {listPrice > 0 && (
                            <p className="text-[10px] text-gray-400 mt-0.5">{totalUnits} pcs. × ₹{row.price}</p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`font-mono text-[12px] font-semibold ${hasAnyDiscount ? "text-emerald-600" : "text-gray-400"}`}>
                            {discAmt > 0 ? `−${fmt(discAmt)}` : "—"}
                          </span>
                          {discAmt > 0 && <p className="text-[10px] text-gray-400 mt-0.5">{rowDiscountPercent}% off</p>}
                        </td>
                        <td className="px-3 py-3">
                          {listPrice > 0 && discAmt > 0 && (
                            <span className="block font-mono text-[11px] text-gray-400 line-through">{fmt(listPrice)}</span>
                          )}
                          <span className="font-mono text-[13px] font-semibold text-emerald-700">
                            {rowTotal > 0 ? fmt(rowTotal) : "—"}
                          </span>
                        </td>
                        <td className="pl-3 pr-6 py-3">
                          <button onClick={() => removeRow(row.key)} title="Remove row"
                            className="w-[30px] h-[30px] flex items-center justify-center rounded-lg border border-red-100 text-red-400 hover:bg-red-50 hover:border-red-200 transition-colors cursor-pointer bg-transparent">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-dashed border-gray-100">
                    <td colSpan={10} className="px-6 py-3">
                      <button onClick={addRow}
                        className="inline-flex items-center gap-2 text-[12px] text-gray-400 hover:text-indigo-600 transition-colors cursor-pointer">
                        <span className="w-5 h-5 rounded-md border border-gray-200 flex items-center justify-center text-sm hover:border-indigo-300 hover:bg-indigo-50 transition-colors">+</span>
                        Add another product
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Order note */}
            <div className="px-6 py-4 border-t border-gray-100 bg-white">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Order Note</label>
                  <span className="text-[11px] text-gray-400">{orderNote.trim().length}/1200</span>
                </div>
                <textarea
                  value={orderNote}
                  maxLength={1200}
                  onChange={(e) => setOrderNote(e.target.value)}
                  placeholder="Add packing, dispatch, or billing instructions for this order..."
                  className="min-h-[82px] w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>

            {/* Order summary */}
            <div className={`px-6 py-5 border-t border-gray-100 ${hasAnyDiscount ? "bg-emerald-50/60" : "bg-gray-50"
              }`}>
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">Order Summary</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 font-mono">
                    {arr1.reduce((a, r) => a + safePositiveNumber(r.producQuanity) * (safePositiveNumber(r.packSize) || 1), 0)} pcs. ·{" "}
                    {arr1.filter(r => r.productname).length} product{arr1.filter(r => r.productname).length !== 1 ? "s" : ""}
                  </p>
                  <p className={`text-[12px] font-semibold mt-2 ${hasAnyDiscount ? "text-emerald-700" : "text-gray-500"
                    }`}>
                    Total discount: {discountPayload.discountPercent}% · Slab: {discountStatusMessage}
                  </p>
                </div>

                <div className="w-full lg:max-w-md">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Subtotal</p>
                      <p className="mt-1 font-mono text-[14px] font-semibold text-gray-900">{fmt(subtotalPaise)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Discount Percentage</p>
                      <p className={`mt-1 font-mono text-[14px] font-semibold ${hasAnyDiscount ? "text-emerald-700" : "text-gray-600"}`}>
                        {discountPayload.discountPercent}%
                      </p>
                    </div>
                    <div className={`rounded-xl border px-4 py-3 ${hasAnyDiscount ? "border-emerald-200 bg-white text-emerald-700" : "border-gray-200 bg-white text-gray-500"
                      }`}>
                      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">Discount Amount</p>
                      <p className="mt-1 font-mono text-[15px] font-bold">
                        {hasAnyDiscount ? `-${fmt(discountAmountPaise)}` : fmt(0)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-900 bg-gray-900 px-4 py-3 text-white">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Final Payable Amount</p>
                      <p className="mt-1 font-mono text-[17px] font-bold">{fmt(finalPayablePaise)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 flex-wrap">
              <button onClick={handleSubmitProductArray}
                className={`inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-[13.5px] font-semibold transition-all shadow-sm hover:shadow-md hover:-translate-y-px cursor-pointer border-none ${hasAnyDiscount
                    ? "bg-gradient-to-r from-emerald-700 to-emerald-500 hover:from-emerald-800 hover:to-emerald-600"
                    : "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600"
                  }`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Place Order
              </button>

              <button onClick={handleSaveDraft} disabled={draftSaving}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-gray-600 rounded-xl text-[13.5px] font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                {activeDraftId ? "Update Draft" : "Save as Draft"}
              </button>

              <button onClick={addRow}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-gray-600 rounded-xl text-[13.5px] font-medium transition-all cursor-pointer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add Row
              </button>
            </div>
          </div>
        )}

        {/* ── EXCEL TAB ────────────────────────────────────────────────────── */}
        {tab === "excel" && (
          <div className="bg-white border border-gray-200 rounded-2xl p-7">
            <h3 className="text-[15px] font-semibold text-gray-900 mb-1">Upload Excel File</h3>
            <p className="text-[13px] text-gray-400 mb-6">Place orders in bulk using a formatted Excel spreadsheet.</p>
            <form onSubmit={handleSubmitFile}>
              <label className={`block border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 ${file ? "border-emerald-300 bg-emerald-50" : "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30"
                }`}>
                <input required type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {file ? (
                  <><div className="text-4xl mb-3">📄</div>
                    <p className="text-[14px] font-semibold text-emerald-700 mb-1">{file.name}</p>
                    <p className="text-[12px] text-gray-400">{(file.size / 1024).toFixed(1)} KB · Click to change</p></>
                ) : (
                  <><div className="text-4xl mb-3">📂</div>
                    <p className="text-[14px] font-semibold text-gray-700 mb-1">Click to upload Excel file</p>
                    <p className="text-[12px] text-gray-400">.xlsx, .xls, .csv accepted</p></>
                )}
              </label>
              <div className="mt-5">
                <button type="submit" disabled={!file}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white rounded-xl text-[13.5px] font-semibold transition-all cursor-pointer border-none">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  Submit via Excel
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default export — wraps inner component in Suspense so useSearchParams()
// does not break static prerendering in Next.js.
// ─────────────────────────────────────────────────────────────────────────────
export default function AddOrderPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[60vh] text-gray-400 text-sm">
        Loading…
      </div>
    }>
      <AddOrderPageInner />
    </Suspense>
  );
}
