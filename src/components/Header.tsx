"use client"

import { useEffect, useState } from "react";
import { GoLocation } from "react-icons/go";
import { IoCartOutline } from "react-icons/io5";
import AccountList from "@/components/AccountList";
import Cart from "@/components/Cart";
import HeaderSearchControl from "@/components/search/HeaderSearchControl";
import Link from "next/link";
import { useCartStore } from "@/Store/store";
import { usePathname, useRouter } from "next/navigation";
import { SIDEBAR_CATEGORIES } from "@/lib/categories";
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

export function UserName() {
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem("UserData");
        if (!raw) return;

        const data = JSON.parse(raw);
        setValue(data?.Dealer_Name ?? data?.city ?? data?.District ?? data?.district ?? null);
      } catch {
        // Ignore invalid storage data.
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return <span className="font-bold uppercase">{value}</span>;
}

function useLocationFromStorage() {
  const [city, setCity] = useState<string | null>(null);
  const [pincode, setPincode] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem("UserData");
        if (!raw) return;

        const data = JSON.parse(raw);
        setCity(data?.Dealer_Address ?? data?.city ?? data?.District ?? data?.district ?? null);
        setPincode(data?.Pincode ?? data?.pincode ?? data?.Pin ?? data?.pin ?? null);
      } catch {
        // Ignore invalid storage data.
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return { city, pincode };
}

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const cart = useCartStore((state) => state.cart);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const { city, pincode } = useLocationFromStorage();

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

  const logoImage =
    "https://omsonslabs.com/wp-content/uploads/elementor/thumbs/Logo-White-rjr8rdx3pqxz9p6ypfegb07hgtpvj3g22mnujlpa0w.png";

  const locationTop = city || pincode ? "Delivering to" : "Delivering to you";
  const locationBottom = city ? city : pincode ? pincode : "Update location";

  return (
    <div>
      <div className="w-full h-16 bg-linear-to-r from-[#1F4B8D] to-slate-950 text-white flex items-center px-2 py-2 gap-2">
        <div className="flex items-center border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer">
          <Link href="/home">
            <img src={logoImage} alt="Omsons Logo" className="h-12" />
          </Link>
        </div>

        <div className="flex items-start gap-1 border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer min-w-[120px]">
          <GoLocation className="text-xl mt-3 text-white" />
          <div className="flex flex-col">
            <span className="text-xs text-gray-300">{locationTop}</span>
            <span className="text-sm font-bold truncate max-w-[110px]" title={[city, pincode].filter(Boolean).join(", ")}>
              {locationBottom}
            </span>
            {city && pincode && (
              <span className="text-[10px] text-gray-400 font-normal leading-tight">{pincode}</span>
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

        <div className="flex items-center gap-1 border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer">
          <span className="text-sm font-bold">EN</span>
        </div>

        <div className="flex flex-col border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer relative group">
          <div className="flex flex-col">
            <span className="text-xs text-gray-300 flex">
              Hello, <UserName />
            </span>
            <span className="text-sm font-bold">Account &amp; Lists</span>
          </div>
          <div className="absolute right-0 top-full mt-1 w-106 hidden group-hover:block z-60 bg-white shadow-lg border border-gray-200 rounded p-3 transition-all">
            <AccountList />
          </div>
        </div>

        <div className="flex flex-col border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer">
          <span className="text-xs text-gray-300">Returns</span>
          <Link href="/orders" className="text-sm font-bold">
            &amp; Orders
          </Link>
        </div>

        <div className="flex items-center gap-1 border border-transparent hover:border-white rounded px-2 py-1 cursor-pointer relative group">
          <Link href="/Pages/Cart" className="relative" suppressHydrationWarning>
            <IoCartOutline className="text-3xl text-white" />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#54499d] text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {itemCount}
              </span>
            )}
          </Link>
          <div className="absolute right-0 top-full mt-1 w-[440px] hidden group-hover:block z-[60] bg-white shadow-2xl border border-gray-200 rounded-xl text-black overflow-hidden">
            <Cart />
          </div>
        </div>
      </div>
    </div>
  );
}
