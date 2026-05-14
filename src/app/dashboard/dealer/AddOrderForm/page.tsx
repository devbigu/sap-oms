// app/order/page.tsx
"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import axios from "axios";
import { useRouter, useSearchParams } from "next/navigation";
import { toast, ToastContainer } from "react-toastify";
import Select from "react-select";
import moment from "moment";
import { useCartStore } from "@/Store/store";
import {
  saveDraft,
  updateDraft,
  getDraftById,
  type DraftProductRow,
} from "@/lib/drafts";

// ─── Types ────────────────────────────────────────────────────────────────────
type ProductRow = {
  key: number;
  productname: string;
  displayName: string;
  variantCode: string;
  producQuanity: number;
  price: number;
  packSize: number;
};

type OptionType = { value: string; label: string; price: number };

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

// ─── Coupons ──────────────────────────────────────────────────────────────────
const COUPONS: Record<string, number> = {
  "test60": 60,
  "SAVE50": 50,
  "VIP80":  80,
};

// ─── Empty row factory ────────────────────────────────────────────────────────
const emptyRow = (): ProductRow => ({
  key: Date.now() + Math.random(),
  productname:   "",
  displayName:   "",
  variantCode:   "",
  producQuanity: 1,
  price:         0,
  packSize:      1,
});

// ─────────────────────────────────────────────────────────────────────────────
// Inner component — uses useSearchParams so must live inside <Suspense>
// ─────────────────────────────────────────────────────────────────────────────
function AddOrderPageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const draftIdParam = searchParams.get("draft");

  const cartItems = useCartStore((s) => s.cart);
  const clearCart = useCartStore((s) => s.clearCart);

  const fromCart = searchParams.get("from") === "cart";

  const [loading,       setLoading]       = useState(false);
  const [draftSaving,   setDraftSaving]   = useState(false);
  const [user,          setUser]          = useState<any>(null);
  const [products,      setProducts]      = useState<any[]>([]);
  const [variantLookup, setVariantLookup] = useState<Record<string, ProductMeta>>({});
  const [shipto,        setShipto]        = useState("");
  const [refno,         setRefno]         = useState("");
  const [file,          setFile]          = useState<File | null>(null);
  const [tab,           setTab]           = useState<"manual" | "excel">("manual");
  const [mounted,       setMounted]       = useState(false);
  const seededRef                         = useRef(false);

  // ── Draft state ───────────────────────────────────────────────────────────
  const [activeDraftId,    setActiveDraftId]    = useState<string | null>(null);
  const [draftName,        setDraftName]        = useState("Untitled Draft");
  const [showNameModal,    setShowNameModal]    = useState(false);
  const [pendingDraftName, setPendingDraftName] = useState("");
  const [draftBanner,      setDraftBanner]      = useState<string | null>(null);

  // ── Coupon state ──────────────────────────────────────────────────────────
  const [couponInput,   setCouponInput]   = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; pct: number } | null>(null);
  const [couponError,   setCouponError]   = useState("");
  const [couponSuccess, setCouponSuccess] = useState("");

  const [arr1, setArr] = useState<ProductRow[]>([emptyRow()]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const stored   = localStorage.getItem("UserData");
    const loggedIn = localStorage.getItem("status");
    if (!stored || JSON.parse(loggedIn ?? "false") !== true) { router.push("/login"); return; }
    const u = JSON.parse(stored);
    setUser(u);
    setShipto(u.Dealer_Address[0].toUpperCase() + u.Dealer_Address.slice(1).toLowerCase());
  }, []);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch(`https://mirisoft.co.in/sas/dealerapi/api/productname`).then(r => r.json()),
      axios.get("/data/products.json").then(r => r.data),
    ]).then(([apiData, localData]) => {
      setProducts(apiData.data ?? []);
      setVariantLookup(buildVariantLookup(localData));
    }).catch(() => {
      fetch(`https://mirisoft.co.in/sas/dealerapi/api/productname`)
        .then(r => r.json()).then(d => setProducts(d.data ?? []));
    });
  }, [user]);

  // ── Load draft from ?draft=<id> ───────────────────────────────────────────
  useEffect(() => {
    if (!draftIdParam || !user || products.length === 0) return;
    if (seededRef.current) return;
    seededRef.current = true;

    getDraftById(draftIdParam, user.Dealer_Id).then((draft) => {
      if (!draft) { toast.error("Draft not found or does not belong to your account."); return; }
      setActiveDraftId(draft.id);
      setDraftName(draft.name);
      if (draft.shipto)  setShipto(draft.shipto);
      if (draft.refno)   setRefno(draft.refno);
      if (draft.coupon_code && draft.coupon_pct) {
        setAppliedCoupon({ code: draft.coupon_code, pct: draft.coupon_pct });
      }
      setArr(draft.rows.length > 0 ? draft.rows : [emptyRow()]);
      setDraftBanner(`Loaded: "${draft.name}"`);
    }).catch(() => toast.error("Could not load draft."));
  }, [draftIdParam, user, products]);

  // ── Seed rows from DraftCart (when navigated from Cart page) ─────────────
  useEffect(() => {
    if (!fromCart || !user || products.length === 0) return;
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
                String(p.product_id).trim()  === String(item.variantCode).trim()
            );
            return {
              key:           i + 1,
              productname:   match ? String(match.product_cat) : item.variantCode,
              displayName:   match ? (match.product_name ?? item.productName) : item.productName,
              variantCode:   item.variantCode,
              producQuanity: item.quantity,
              price:         item.unitPrice,
              packSize:      item.packSize ?? 1,
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
  }, [fromCart, user, products]);

  // ── Seed rows from cart ───────────────────────────────────────────────────
  useEffect(() => {
    if (seededRef.current) return;
    if (products.length === 0) return;
    if (draftIdParam) return;
    if (fromCart) return;           // DraftCart takes priority when ?from=cart
    seededRef.current = true;

    if (cartItems.length === 0) { setArr([emptyRow()]); return; }

    const cartRows: ProductRow[] = cartItems.map((item, i) => {
      const match = products.find(
        (p) =>
          String(p.product_cat).trim() === String(item.id).trim() ||
          String(p.product_id).trim()  === String(item.id).trim()
      );
      const nameParts   = item.name.split(" - ");
      const productName = nameParts[0] ?? item.name;
      const variantCode = nameParts.length > 1 ? nameParts[nameParts.length - 1] : item.id;
      const localMeta   = variantLookup[item.id];
      const packSize    = localMeta?.packSize ?? (item as any).packSize ?? 1;
      const cartPrice   = Number(item.price);
      const apiPrice    = match ? Number(match.product_price) : 0;
      const price       = cartPrice > 0 ? cartPrice : apiPrice;

      return {
        key:           i + 1,
        productname:   match ? String(match.product_cat) : String(item.id),
        displayName:   match ? (match.product_name ?? productName) : productName,
        variantCode,
        producQuanity: item.quantity,
        price,
        packSize,
      };
    });

    setArr(cartRows);
  }, [products, cartItems, variantLookup, draftIdParam]);

  // ── Discount ──────────────────────────────────────────────────────────────
  const activeDiscount: number = appliedCoupon ? appliedCoupon.pct : (user?.discount ?? 0);
  const dealerDiscount: number = user?.discount ?? 0;

  // ── Coupon handlers ───────────────────────────────────────────────────────
  const handleApplyCoupon = () => {
    setCouponError(""); setCouponSuccess("");
    const trimmed = couponInput.trim();
    if (!trimmed) { setCouponError("Please enter a coupon code."); return; }
    const pct = COUPONS[trimmed];
    if (pct === undefined) { setCouponError("Invalid coupon code."); return; }
    if (pct <= dealerDiscount) {
      setCouponError(`This coupon gives ${pct}% off — your dealer rate (${dealerDiscount}%) is already better.`);
      return;
    }
    setAppliedCoupon({ code: trimmed, pct });
    setCouponSuccess(`"${trimmed}" applied — ${pct}% off (was ${dealerDiscount}%)`);
    setCouponInput("");
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null); setCouponError(""); setCouponSuccess(""); setCouponInput("");
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
    const catNo      = labelParts[0]?.trim() ?? opt.value;
    const rest       = labelParts.slice(1).join(" — ");
    const namePart   = rest.split("(")[0].trim();
    const localMeta  = variantLookup[opt.value];
    const packSize   = localMeta?.packSize ?? 1;

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

  const addRow    = () => setArr((prev) => [...prev, emptyRow()]);
  const removeRow = (key: number) => setArr((prev) => prev.filter((r) => r.key !== key));

  // ── Totals ────────────────────────────────────────────────────────────────
  const grandTotal = arr1.reduce((acc, row) => {
    const listPrice = row.producQuanity * row.packSize * row.price;
    return acc + (listPrice - listPrice * (activeDiscount / 100));
  }, 0);

  const grandTotalWithoutCoupon = appliedCoupon
    ? arr1.reduce((acc, row) => {
        const listPrice = row.producQuanity * row.packSize * row.price;
        return acc + (listPrice - Math.round(listPrice * (dealerDiscount / 100)));
      }, 0)
    : null;

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
          coupon_code: appliedCoupon?.code ?? null,
          coupon_pct:  appliedCoupon?.pct  ?? null,
          rows: draftRows,
        });
        setDraftName(nameToUse);
        toast.success("Draft updated ✓");
      } else {
        const created = await saveDraft({
          dealer_id: user.Dealer_Id, name: nameToUse, shipto, refno,
          coupon_code: appliedCoupon?.code ?? null,
          coupon_pct:  appliedCoupon?.pct  ?? null,
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

  // ── Submit Order ──────────────────────────────────────────────────────────
  const handleSubmitProductArray = async () => {
    if (arr1.every(r => !r.productname)) { toast("Please select at least one product"); return; }
    setLoading(true);
    const payload = arr1.filter(r => r.productname).map(r => ({
      productname:   r.productname,
      producQuanity: String(r.producQuanity),
      price:         String(r.price),
      remarks:       r.variantCode ? `Cat. No: ${r.variantCode}` : "",
    }));
    const fd = new FormData();
    fd.append("productorder",  JSON.stringify(payload));
    fd.append("Dealer_shipto", shipto);
    fd.append("id",            user.Dealer_Id);
    fd.append("discount",      String(activeDiscount));
    if (refno)         fd.append("refno",       refno);
    if (appliedCoupon) fd.append("coupon_code", appliedCoupon.code);
    try {
      const { data } = await axios.post(
        `https://mirisoft.co.in/sas/dealerapi/api/PlaceOrderarray?id=${user.Dealer_Id}&staffid=${user.assignedstaff}`,
        fd
      );
      toast.success(data.msg, { autoClose: 5000 });
      clearCart();
      seededRef.current = false;
      setArr([emptyRow()]);
      handleRemoveCoupon();
      setActiveDraftId(null);
      setDraftBanner(null);
      // Clear the DraftCart from MongoDB if this order originated from the cart page
      if (fromCart && user?.Dealer_Id) {
        fetch(`/api/draft-cart?dealer_id=${encodeURIComponent(user.Dealer_Id)}`, { method: "DELETE" }).catch(() => {});
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
    fd.append("staffid",      user.assignedstaff);
    fd.append("order_dealer", user.Dealer_Id);
    fd.append("exelefile",    file);
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
    placeholder:        (base: any) => ({ ...base, color: "#9ca3af", fontSize: 13 }),
    singleValue:        (base: any) => ({ ...base, color: "#111827", fontSize: 13 }),
    menu:               (base: any) => ({ ...base, borderRadius: 10, border: "1px solid #e5e7eb", boxShadow: "0 8px 30px rgba(0,0,0,0.1)" }),
    indicatorSeparator: ()          => ({ display: "none" }),
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
                if (e.key === "Enter"  && pendingDraftName.trim()) commitSaveDraft(pendingDraftName.trim());
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
      {(loading || draftSaving) && (
        <div className="fixed inset-0 z-[999] bg-black/35 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl px-10 py-7 flex flex-col items-center gap-3 shadow-2xl">
            <div className="w-9 h-9 border-[3px] border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
            <span className="text-sm font-medium text-gray-600">
              {draftSaving ? "Saving draft…" : "Processing…"}
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
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
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
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
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
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
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
              <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Discount Rate</label>
              <div className={`text-[13.5px] font-semibold rounded-xl px-3 py-2.5 border flex items-center justify-between ${
                appliedCoupon ? "text-violet-700 bg-violet-50 border-violet-200" : "text-emerald-600 bg-emerald-50 border-emerald-200"
              }`}>
                <span>
                  {appliedCoupon
                    ? <>{appliedCoupon.pct}% <span className="text-[11px] font-normal">(coupon)</span></>
                    : <>{user.discount}% dealer discount</>}
                </span>
                {appliedCoupon && <span className="text-[11px] text-gray-400 line-through ml-2">{user.discount}%</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Coupon */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-violet-500">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1"/>
            </svg>
            <span className="text-[13px] font-semibold text-gray-800">Special Price</span>
            {appliedCoupon && (
              <span className="ml-auto text-[11px] font-bold px-2.5 py-0.5 bg-violet-100 text-violet-700 rounded-full border border-violet-200">
                {appliedCoupon.code} · {appliedCoupon.pct}% off
              </span>
            )}
          </div>
          {!appliedCoupon ? (
            <div className="flex gap-2">
              <input type="text" placeholder="Enter price" value={couponInput}
                onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(""); setCouponSuccess(""); }}
                onKeyDown={e => { if (e.key === "Enter") handleApplyCoupon(); }}
                className={`flex-1 text-[13px] text-gray-900 border rounded-xl px-4 py-2.5 outline-none transition-all font-mono tracking-wider placeholder:text-gray-300 placeholder:font-normal ${
                  couponError ? "border-red-300 bg-red-50/30 focus:ring-2 focus:ring-red-100" : "border-gray-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                }`}
              />
              <button onClick={handleApplyCoupon} disabled={!couponInput.trim()}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-xl transition-colors">
                Apply
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5"/></svg>
                </div>
                <div>
                  <p className="text-[13px] font-bold text-violet-800 font-mono tracking-wider">{appliedCoupon.code}</p>
                  <p className="text-[11px] text-violet-600 mt-0.5">{appliedCoupon.pct}% off · saving extra {appliedCoupon.pct - dealerDiscount}% over dealer rate</p>
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
              {couponError}
            </p>
          )}
          {couponSuccess && !appliedCoupon && <p className="text-[12px] text-emerald-600 mt-2">{couponSuccess}</p>}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {(["manual", "excel"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-xl text-[13px] font-medium border transition-all duration-150 cursor-pointer ${
                tab === t ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700"
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
                {appliedCoupon && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-50 text-violet-700 border border-violet-200 rounded-full text-[11px] font-semibold">
                    {appliedCoupon.pct}% special price applied
                  </span>
                )}
                {cartItems.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[11px] font-semibold">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5"/></svg>
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
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 min-w-[260px]">Product</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">Cat. No / Variant</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-32">Quantity</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-36">Pack → Units</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">List Price</th>
                    <th className={`px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider w-28 ${appliedCoupon ? "text-violet-500" : "text-gray-400"}`}>
                      Discount ({activeDiscount}%)
                    </th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 w-28">Final Price</th>
                    <th className="pl-3 pr-6 py-3 w-14"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {arr1.map((row, idx) => {
                    const listPrice  = row.producQuanity * row.packSize * row.price;
                    const discAmt    = Math.round(listPrice * (activeDiscount / 100));
                    const rowTotal   = listPrice - discAmt;
                    const totalUnits = row.producQuanity * row.packSize;
                    const meta       = variantLookup[row.productname];

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
                                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
                                  </svg>
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-[12px] font-semibold text-gray-800 truncate leading-tight">
                                  {row.displayName || meta?.productName || row.productname}
                                </p>
                              </div>
                            </div>
                          )}
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
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[11px] font-semibold font-mono">
                                {row.producQuanity} × {row.packSize}
                              </span>
                              <span className="text-gray-300 text-xs">=</span>
                              <span className="inline-flex items-center px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded text-[11px] font-bold font-mono">
                                {totalUnits} units 
                              </span>
                            </div>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 bg-gray-50 border border-gray-200 text-gray-500 rounded text-[11px] font-mono">
                              {totalUnits} unit{totalUnits !== 1 ? "s" : ""}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-mono text-[13px] text-gray-600 font-semibold">
                            {listPrice > 0 ? fmt(listPrice) : "—"} 
                          </span>
                          {listPrice > 0 && (
                            <p className="text-[10px] text-gray-400 mt-0.5">{row.producQuanity} packs × {row.packSize} units × ₹{row.price}</p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`font-mono text-[12px] font-semibold ${appliedCoupon ? "text-violet-600" : "text-amber-500"}`}>
                            {discAmt > 0 ? `−${fmt(discAmt)}` : "—"}
                          </span>
                          {discAmt > 0 && <p className="text-[10px] text-gray-400 mt-0.5">{activeDiscount}% off</p>}
                        </td>
                        <td className="px-3 py-3">
                          {listPrice > 0 && discAmt > 0 && (
                            <span className="block font-mono text-[11px] text-gray-400 line-through">{fmt(listPrice)}</span>
                          )}
                          <span className={`font-mono text-[13px] font-semibold ${appliedCoupon ? "text-violet-700" : "text-emerald-600"}`}>
                            {rowTotal > 0 ? fmt(rowTotal) : "—"}
                          </span>
                        </td>
                        <td className="pl-3 pr-6 py-3">
                          <button onClick={() => removeRow(row.key)} title="Remove row"
                            className="w-[30px] h-[30px] flex items-center justify-center rounded-lg border border-red-100 text-red-400 hover:bg-red-50 hover:border-red-200 transition-colors cursor-pointer bg-transparent">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6l-1 14H6L5 6m5 0V4h4v2"/>
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-dashed border-gray-100">
                    <td colSpan={9} className="px-6 py-3">
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

            {/* Totals bar */}
            <div className={`flex items-center justify-between px-6 py-4 border-t border-gray-100 ${appliedCoupon ? "bg-violet-50/50" : "bg-gray-50"}`}>
              <div>
                <p className="text-[13px] text-gray-500">Order Total</p>
                <p className="text-[11px] text-gray-400 mt-0.5 font-mono">
                  {arr1.reduce((a, r) => a + r.producQuanity, 0)} packs ·{" "}
                  {arr1.filter(r => r.productname).length} product{arr1.filter(r => r.productname).length !== 1 ? "s" : ""}
                  {appliedCoupon && <span className="ml-2 text-violet-600 font-semibold">· {appliedCoupon.code} applied</span>}
                </p>
                {appliedCoupon && grandTotalWithoutCoupon !== null && (
                  <p className="text-[11px] text-violet-600 font-semibold mt-1">
                    You save {fmt(grandTotalWithoutCoupon - grandTotal)} extra with this coupon
                  </p>
                )}
              </div>
              <div className="text-right">
                {appliedCoupon && grandTotalWithoutCoupon !== null && (
                  <p className="text-[13px] font-mono text-gray-400 line-through mb-0.5">{fmt(grandTotalWithoutCoupon)}</p>
                )}
                <p className={`text-[22px] font-bold font-mono tracking-tight ${appliedCoupon ? "text-violet-700" : "text-gray-900"}`}>
                  {fmt(grandTotal)}
                </p>
              </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 flex-wrap">
              <button onClick={handleSubmitProductArray}
                className={`inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-[13.5px] font-semibold transition-all shadow-sm hover:shadow-md hover:-translate-y-px cursor-pointer border-none ${
                  appliedCoupon
                    ? "bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-700 hover:to-violet-600"
                    : "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600"
                }`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M20 6 9 17l-5-5"/>
                </svg>
                Place Order
              </button>

              <button onClick={handleSaveDraft} disabled={draftSaving}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-gray-600 rounded-xl text-[13.5px] font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                {activeDraftId ? "Update Draft" : "Save as Draft"}
              </button>

              <button onClick={addRow}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-gray-600 rounded-xl text-[13.5px] font-medium transition-all cursor-pointer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14"/>
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
              <label className={`block border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 ${
                file ? "border-emerald-300 bg-emerald-50" : "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30"
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
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
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