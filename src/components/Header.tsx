"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { GoLocation } from "react-icons/go";
import { IoCartOutline } from "react-icons/io5";

import { useCartStore } from "@/Store/store";
import AccountList from "@/components/AccountList";
import Cart from "@/components/Cart";
import HeaderSearchControl from "@/components/search/HeaderSearchControl";
import { useAuthSession } from "@/hooks/useAuthSession";
import { SIDEBAR_CATEGORIES } from "@/lib/categories";
import { getLogoRouteForRole, getOrdersRouteForRole } from "@/lib/auth/navigation";
import productSearch from "@/lib/productSearch.js";

const { buildSearchUrl } = productSearch;

export type RecentlyViewedItem = {
  SKU: string;
  Name: string;
  image?: string;
  viewedAt: number;
};

const RV_KEY = "recentlyViewed";
const RV_MAX = 12;
const CAT_KEY = "selectedCategoryFilter";

export function getRecentlyViewed(): RecentlyViewedItem[] {
  try {
    return JSON.parse(localStorage.getItem(RV_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function pushRecentlyViewed(item: Omit<RecentlyViewedItem, "viewedAt">) {
  try {
    const existing = getRecentlyViewed().filter((product) => product.SKU !== item.SKU);
    const updated: RecentlyViewedItem[] = [{ ...item, viewedAt: Date.now() }, ...existing].slice(0, RV_MAX);
    localStorage.setItem(RV_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event("recentlyViewedUpdated"));
  } catch {
    // Ignore localStorage failures.
  }
}

export function storeCategoryFilter(value: string) {
  try {
    if (value === "all") {
      localStorage.removeItem(CAT_KEY);
      return;
    }

    localStorage.setItem(CAT_KEY, value);
  } catch {
    // Ignore localStorage failures.
  }
}

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { session } = useAuthSession();
  const cart = useCartStore((state) => state.cart);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const [selectedCategory, setSelectedCategory] = useState("all");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const storedCategory = localStorage.getItem(CAT_KEY);
        if (storedCategory && storedCategory !== "all" && SIDEBAR_CATEGORIES[storedCategory]) {
          setSelectedCategory(storedCategory);
        }
      } catch {
        // Ignore invalid storage data.
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const role = session?.role ?? null;
  const logoHref = getLogoRouteForRole(role);
  const ordersHref = getOrdersRouteForRole(role);
  const isDealer = role === "dealer";
  const userName =
    session?.dealerName ??
    session?.staffName ??
    session?.name ??
    (role === "accountant" ? "Accountant" : "User");

  const locationTop = isDealer ? "Delivering to" : "Signed in as";
  const locationBottom = isDealer
    ? session?.dealerAddress || session?.dealerCity || session?.dealerPincode || "Update location"
    : role === "admin"
      ? "Administrator"
      : role === "staff"
        ? session?.staffDesignation || "Staff"
        : role === "accountant"
          ? "Finance portal"
          : "Workspace";

  const locationMeta = isDealer
    ? [session?.dealerCity, session?.dealerPincode].filter(Boolean).join(", ")
    : session?.email ?? "";

  const logoImage =
    "https://omsonslabs.com/wp-content/uploads/elementor/thumbs/Logo-White-rjr8rdx3pqxz9p6ypfegb07hgtpvj3g22mnujlpa0w.png";

  return (
    <div>
      <div className="flex h-16 w-full items-center gap-2 bg-linear-to-r from-[#1F4B8D] to-slate-950 px-2 py-2 text-white">
        <div className="flex cursor-pointer items-center rounded border border-transparent px-2 py-1 hover:border-white">
          <Link href={logoHref}>
            <img src={logoImage} alt="Omsons Logo" className="h-12" />
          </Link>
        </div>

        <div className="flex min-w-[120px] items-start gap-1 rounded border border-transparent px-2 py-1 hover:border-white">
          <GoLocation className="mt-3 text-xl text-white" />
          <div className="flex flex-col">
            <span className="text-xs text-gray-300">{locationTop}</span>
            <span className="max-w-[140px] truncate text-sm font-bold" title={locationMeta || locationBottom}>
              {locationBottom}
            </span>
            {locationMeta && (
              <span className="text-[10px] leading-tight text-gray-400">{locationMeta}</span>
            )}
          </div>
        </div>

        <HeaderSearchControl
          key={pathname}
          selectedCategory={selectedCategory}
          onCategoryChange={(value) => {
            setSelectedCategory(value);
            storeCategoryFilter(value);
          }}
          onSubmitSearch={(query) => {
            if (!query) return;
            router.push(buildSearchUrl(query));
          }}
          onSelectSuggestion={(suggestion) => {
            pushRecentlyViewed({
              SKU: suggestion.catalogueNumber,
              Name: suggestion.productName,
              image: suggestion.image || suggestion.originalProduct.images?.[0],
            });
            router.push(suggestion.route);
          }}
        />

        <div className="flex cursor-pointer items-center gap-1 rounded border border-transparent px-2 py-1 hover:border-white">
          <span className="text-sm font-bold">EN</span>
        </div>

        <div className="group relative flex cursor-pointer flex-col rounded border border-transparent px-2 py-1 hover:border-white">
          <div className="flex flex-col">
            <span className="flex text-xs text-gray-300">
              Hello, <span className="font-bold uppercase">{userName}</span>
            </span>
            <span className="text-sm font-bold">Account &amp; Lists</span>
          </div>
          <div className="absolute right-0 top-full z-60 mt-1 hidden w-106 rounded border border-gray-200 bg-white p-3 shadow-lg transition-all group-hover:block">
            <AccountList />
          </div>
        </div>

        <div className="flex cursor-pointer flex-col rounded border border-transparent px-2 py-1 hover:border-white">
          <span className="text-xs text-gray-300">Returns</span>
          <Link href={ordersHref} className="text-sm font-bold">
            &amp; Orders
          </Link>
        </div>

        {isDealer && (
          <div className="group relative flex cursor-pointer items-center gap-1 rounded border border-transparent px-2 py-1 hover:border-white">
            <Link href="/Pages/Cart" className="relative" suppressHydrationWarning>
              <IoCartOutline className="text-3xl text-white" />
              {itemCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#54499d] text-xs font-bold text-white">
                  {itemCount}
                </span>
              )}
            </Link>
            <div className="absolute right-0 top-full z-[60] mt-1 hidden w-[440px] overflow-hidden rounded-xl border border-gray-200 bg-white text-black shadow-2xl group-hover:block">
              <Cart />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
