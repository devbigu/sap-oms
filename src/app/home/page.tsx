"use client";

import { GiHamburgerMenu } from "react-icons/gi";
import { useState, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import moment from "moment";
import { ImageSlider } from "@/components/ImageSlider";
import { bottleProducts, NAV_LINKS, CATEGORY_CARDS } from "@/Assets/dataset";
import Footer from "@/components/Footer";
import Link from "next/link";
import axios from "axios";
// import { getRecentlyViewed, pushRecentlyViewed, type RecentlyViewedItem } from "@/components/Header";

import { getRecentlyViewed, pushRecentlyViewed, type RecentlyViewedItem } from "@/components/Header";

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKEND = "https://mirisoft.co.in/sas/dealerapi/api";
const PLACEHOLDER_IMAGE =
  "https://omsonslabs.com/wp-content/uploads/Pycnometers-Class-A-Individual-Work-Certificate-product-image.webp";

const HOT_BADGES = ["🔥 Bestseller", "⚡ Fast moving", "🔥 Trending", "⚡ Popular", "🔥 Top rated", "⚡ Hot pick"];

// ─── Hot items localStorage helper ───────────────────────────────────────────

type StoredHotItem = { id: string; SKU: string; name: string; image: string; badge: string; active: boolean };

function getStoredHotItems(): StoredHotItem[] {
  try {
    const raw = localStorage.getItem("hotItems");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface JsonProduct {
  SKU: number | string;
  Name: string;
  Images: string[];
  Categories?: string[];
}

interface HotItemDisplay {
  SKU: string;
  Name: string;
  image: string;
  badge: string;
}

type Order = {
  order_id: string;
  order_date: string;
  order_amount: string;
  order_discount: string;
  Dealer_Name: string;
  orderdata_item_quantity: string;
  mtstatus: string;
  outstandingDate: string;
  reason?: string;
};

type ApiResponse = {
  msg: string;
  count: number;
  status: boolean;
  data: Order[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getDealerId = (): string => {
  try {
    return JSON.parse(localStorage.getItem("UserData") ?? "{}")?.Dealer_Id ?? "225";
  } catch {
    return "225";
  }
};

async function fetchOrders(id: string): Promise<ApiResponse> {
  const r = await fetch(`${BACKEND}/orderhispegination?page=1&search=&id=${id}`);
  if (!r.ok) throw new Error("Failed to fetch orders");
  return r.json();
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const statusConf: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  inprocess: { label: "In Process", dot: "bg-amber-400", text: "text-amber-800", bg: "bg-amber-50 border-amber-200" },
  processing: { label: "Processing", dot: "bg-blue-400", text: "text-blue-800", bg: "bg-blue-50 border-blue-200" },
  dispatched: { label: "Dispatched", dot: "bg-indigo-400", text: "text-indigo-800", bg: "bg-indigo-50 border-indigo-200" },
  successful: { label: "Successful", dot: "bg-emerald-400", text: "text-emerald-800", bg: "bg-emerald-50 border-emerald-200" },
  cancelled: { label: "Cancelled", dot: "bg-red-400", text: "text-red-800", bg: "bg-red-50 border-red-200" },
};

function MtStatusBadge({ status }: { status: string }) {
  const key = status?.toLowerCase().replace(/\s/g, "") ?? "";
  const s = statusConf[key] ?? { label: status || "—", dot: "bg-gray-300", text: "text-gray-700", bg: "bg-gray-50 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({
  title,
  subtitle,
  action,
  badge,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; href: string };
  badge?: string;
}) {
  return (
    <div className="flex items-end justify-between mb-6">
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">{title} </h2>
            {badge && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && (
        <Link
          href={action.href}
          className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2 transition-colors"
        >
          {action.label} →
        </Link>
      )}
    </div>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function OrderCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden animate-pulse">
      <div className="h-36 bg-gray-100" />
      <div className="p-3 flex flex-col gap-2">
        <div className="h-3 bg-gray-100 rounded w-3/4" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
        <div className="flex justify-between mt-1">
          <div className="h-4 bg-gray-100 rounded w-16" />
          <div className="h-4 bg-gray-100 rounded w-20" />
        </div>
        <div className="flex gap-2 mt-2">
          <div className="flex-1 h-7 bg-gray-100 rounded" />
          <div className="flex-1 h-7 bg-gray-100 rounded" />
        </div>
      </div>
    </div>
  );
}

function ProductCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden animate-pulse">
      <div className="aspect-square bg-gray-100" />
      <div className="p-2 flex flex-col gap-1.5">
        <div className="h-3 bg-gray-100 rounded w-3/4" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [hotItems, setHotItems] = useState<HotItemDisplay[]>([]);
  const [hotLoading, setHotLoading] = useState(true);
  const [dealerId, setDealerId] = useState("225");
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedItem[]>([]);
  const year = new Date().getFullYear();

  // Read dealer ID on mount
  useEffect(() => {
    setDealerId(getDealerId());
  }, []);

  // Read recently viewed (initial + on update events from Header)
  useEffect(() => {
    const refresh = () => setRecentlyViewed(getRecentlyViewed());
    refresh();
    window.addEventListener("recentlyViewedUpdated", refresh);
    return () => window.removeEventListener("recentlyViewedUpdated", refresh);
  }, []);

  // Fetch products for "Hot Right Now" section
  // Priority: admin-managed localStorage hot items (with real images from products.json)
  // Fallback: first 6 products that have images in products.json
  useEffect(() => {
    axios
      .get<JsonProduct[]>("/data/products.json")
      .then((res) => {
        const allProducts = res.data;
        // Build a SKU → image lookup from products.json
        const imageMap = new Map<string, string>();
        for (const p of allProducts) {
          if (p.Images?.length) {
            imageMap.set(String(p.SKU).trim(), p.Images[0]);
          }
        }

        const adminItems = getStoredHotItems().filter((i) => i.active);

        if (adminItems.length > 0) {
          setHotItems(
            adminItems.slice(0, 6).map((item) => ({
              SKU:   item.SKU,
              Name:  item.name,
              badge: item.badge,
              // Use real product image from products.json when available;
              // fall back to admin-stored image only if it isn't the placeholder
              image:
                imageMap.get(item.SKU.trim()) ??
                (item.image && item.image !== PLACEHOLDER_IMAGE ? item.image : ""),
            }))
          );
        } else {
          // No admin hot items configured → show first 6 products with images
          setHotItems(
            allProducts
              .filter((p) => p.Images?.length > 0)
              .slice(0, 6)
              .map((p, i) => ({
                SKU:   String(p.SKU),
                Name:  p.Name,
                image: p.Images[0],
                badge: HOT_BADGES[i % HOT_BADGES.length],
              }))
          );
        }
        setHotLoading(false);
      })
      .catch(() => setHotLoading(false));
  }, []);

  // Fetch real orders
  const { data: ordersData, isLoading: ordersLoading, isError: ordersError } = useQuery({
    queryKey: ["orders-home", dealerId],
    queryFn: () => fetchOrders(dealerId),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: !!dealerId,
  });

  const recentOrders = (ordersData?.data ?? []).slice(0, 4);

  // Navigate to product detail and also record a recently viewed entry
  const goToProduct = (sku: string, name: string, image?: string) => {
    pushRecentlyViewed({ SKU: sku, Name: name, image });
    router.push(`/Products/${sku}`);
  };

  return (
    <div className="w-full min-h-screen bg-gray-50 text-black">

      {/* ── Top Nav ── */}
      <nav className="bg-[#032e66] relative h-10 flex items-center text-white gap-4 text-sm w-full px-4">
        <div className="flex items-center gap-2">
          <GiHamburgerMenu className="h-5 w-5 cursor-pointer" onClick={() => setNavOpen(!navOpen)} />
          <div className="hidden md:flex gap-1">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href}
                className="rounded-md px-3 py-2 text-sm font-medium hover:bg-slate-800 transition-colors">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        {navOpen && (
          <div className="absolute top-10 left-0 py-4 px-2 z-50 w-48 bg-slate-900 text-white shadow-lg rounded-md flex flex-col gap-1 lg:hidden ml-2 mt-2">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href}
                className="px-4 py-2 text-sm hover:bg-slate-800 transition-colors rounded-md"
                onClick={() => setNavOpen(false)}>
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </nav>

      {/* ── Hero Slider ── */}
      <div className="relative w-full bg-gradient-to-b from-slate-800 to-gray-50">
        <ImageSlider />
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 1 — Shop by Category
      ══════════════════════════════════════════════════════════════════ */}
      <section id="categories" className="max-w-[1400px] mx-auto px-4 py-12">
        <SectionHeading
          title="Shop by Category"
          subtitle="Browse our full range of laboratory equipment"
          action={{ label: "All categories", href: "/Products" }}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {CATEGORY_CARDS.map((cat: any) => (
              <div key={cat.title}
                className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 flex flex-col hover:shadow-md transition-shadow">
                <h3 className="text-base font-bold text-slate-800 mb-3">{cat.title}</h3>
                <div className="grid grid-cols-2 gap-2 flex-1">
                  {cat.items.map((item: { label: string; imageUrl: string }) => (
                    <a key={item.label} href={cat.link} className="group">
                      <img src={item.imageUrl} alt={item.label} loading="lazy"
                        className="w-full aspect-square object-cover rounded group-hover:opacity-90 transition-opacity" />
                      <span className="text-[11px] mt-1 block text-slate-600 leading-tight line-clamp-2">
                        {item.label}
                      </span>
                    </a>
                  ))}
                </div>
                <Link href={"/Products"}
                  className="mt-4 text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline transition-colors">
                  See all →
                </Link>
              </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 2 — Recent Orders
      ══════════════════════════════════════════════════════════════════ */}
      <section id="order-history" className="max-w-[1400px] mx-auto px-4 py-12 border-t border-gray-200">
        <SectionHeading
          title="Recent Orders"
          subtitle={ordersData ? `${ordersData.count} total orders · showing last 4` : "Your latest purchases"}
          action={{ label: "View all orders", href: "/Orders" }}
        />

        {ordersError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white rounded-lg border border-gray-100">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
            </svg>
            <p className="text-sm text-gray-500">Could not load orders. Please try again later.</p>
          </div>
        )}

        {!ordersLoading && !ordersError && recentOrders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white rounded-lg border border-gray-100">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.2" strokeLinecap="round">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
            </svg>
            <p className="text-sm text-gray-500">No orders yet.</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ordersLoading && Array.from({ length: 4 }).map((_, i) => <OrderCardSkeleton key={i} />)}
          {!ordersLoading && !ordersError && recentOrders.map((order) => {
            const net = Number(order.order_amount) - Number(order.order_discount);
            const isDeleted = !!order.reason;
            return (
              <div key={order.order_id}
                className={`bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow ${isDeleted ? "opacity-60" : ""}`}>
                <div className="bg-gray-50 flex flex-col items-center justify-center p-4 h-36 gap-2">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                    <path d="M9 12h6M9 16h4"/>
                  </svg>
                  <span className="font-mono text-[11px] text-slate-400">OM/{year}/{order.order_id}</span>
                </div>
                <div className="p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-mono text-[13px] font-bold text-indigo-700">OM/{year}/{order.order_id}</p>
                    {isDeleted && (
                      <span className="px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-700 rounded text-[10px] font-bold">DELETED</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{moment(order.order_date).format("DD MMM YYYY · hh:mm A")}</p>
                  <div className="flex items-center justify-between mt-1">
                    <div>
                      <span className="text-sm font-bold text-slate-900">₹{net.toLocaleString("en-IN")}</span>
                      {Number(order.order_discount) > 0 && (
                        <span className="ml-1.5 text-xs line-through text-slate-400">
                          ₹{Number(order.order_amount).toLocaleString("en-IN")}
                        </span>
                      )}
                    </div>
                    <MtStatusBadge status={order.mtstatus} />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {order.orderdata_item_quantity} unit{Number(order.orderdata_item_quantity) !== 1 ? "s" : ""}
                    {order.Dealer_Name ? ` · ${order.Dealer_Name}` : ""}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => router.push(`/orders/${order.order_id}`)}
                      className="flex-1 text-center text-xs py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors">
                      View
                    </button>
                    <button onClick={() => router.push("/Orders")}
                      className="flex-1 text-center text-xs py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 transition-colors">
                      Reorder
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 3 — Related Products
      ══════════════════════════════════════════════════════════════════ */}
      <section id="related-products" className="max-w-[1400px] mx-auto px-4 py-12 border-t border-gray-200">
        <SectionHeading
          title="Related Products"
          subtitle="Recommended based on your purchases and browsing"
          action={{ label: "Browse all", href: "/Products" }}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {bottleProducts.map((bottle) => (
            <a key={bottle.name} href={bottle.link}
              className="group bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
              <div className="bg-gray-50 flex items-center justify-center p-3 aspect-square">
                <img src={bottle.image} alt={bottle.name}
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300" />
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-slate-700 line-clamp-2 leading-tight">{bottle.name}</p>
                <span className="mt-1.5 inline-block text-xs text-slate-500 group-hover:text-slate-900 transition-colors">View →</span>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 4 — Recently Viewed (from localStorage)
      ══════════════════════════════════════════════════════════════════ */}
      {recentlyViewed.length > 0 && (
        <section id="recently-viewed" className="max-w-[1400px] mx-auto px-4 py-12 border-t border-gray-200">
          <SectionHeading
            title="Recently Viewed"
            subtitle="Pick up where you left off"
            action={{ label: "Clear history", href: "#" }}
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {recentlyViewed.slice(0, 6).map((item) => (
              <button
                key={item.SKU}
                onClick={() => goToProduct(item.SKU, item.Name, item.image)}
                className="group bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow text-left w-full"
              >
                <div className="bg-gray-50 flex items-center justify-center p-3 aspect-square relative">
                  <img
                    src={item.image ?? PLACEHOLDER_IMAGE}
                    alt={item.Name}
                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                  />
                  {/* "Recently viewed" eye indicator */}
                  <span className="absolute top-1.5 left-1.5 bg-white border border-gray-200 rounded-full p-0.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </span>
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium text-slate-700 line-clamp-2 leading-tight">{item.Name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{item.SKU}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {moment(item.viewedAt).fromNow()}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 5 — Hot Right Now
      ══════════════════════════════════════════════════════════════════ */}
      <section id="hot-right-now" className="max-w-[1400px] mx-auto px-4 py-12 border-t border-gray-200">
        <SectionHeading
          title="Hot Right Now"
          subtitle="Top picks flying off the shelves"
          badge="🔥 Trending"
          action={{ label: "Shop all", href: "/Products" }}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {hotLoading
            ? Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)
            : hotItems.map((product) => (
            <button
              key={product.SKU}
              onClick={() => goToProduct(product.SKU, product.Name, product.image || undefined)}
              className="group bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5 text-left w-full"
            >
              <div className="relative bg-gray-50 flex items-center justify-center p-3 aspect-square">
                {product.image ? (
                  <img
                    src={product.image}
                    alt={product.Name}
                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <span className="text-4xl">📦</span>
                )}
                <span className="absolute top-2 left-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white shadow-sm">
                  {product.badge}
                </span>
              </div>
              <div className="p-2">
                <p className="text-xs font-medium text-slate-700 line-clamp-2 leading-tight">{product.Name}</p>
                <span className="mt-1.5 inline-block text-xs text-rose-500 font-semibold group-hover:text-rose-600 transition-colors">
                  Shop now →
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}