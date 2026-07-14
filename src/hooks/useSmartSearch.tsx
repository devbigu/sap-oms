"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

const GEMINI_API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const BASE_URL = "https://mirisoft.co.in/sas/dealerapi/api";

type Role = "admin" | "dealer" | "staff" | "accountant";

export interface SearchResult {
  id: string | number;
  label: string;
  sublabel?: string;
  route: string;
  category: string;
  badge?: string;
}

interface UserContext {
  role: Role;
  id?: string | number;
}

// Role-based API endpoint config
const roleApiConfig: Record<Role, { endpoint: string; paramKey: string; idRequired: boolean }[]> = {
  admin: [
    { endpoint: "/dealerpegination", paramKey: "search", idRequired: false },
    { endpoint: "/staffpegination", paramKey: "search", idRequired: false },
    { endpoint: "/pegination", paramKey: "search", idRequired: false },
  ],
  dealer: [
    { endpoint: "/Orderstspegination", paramKey: "search", idRequired: true },
    { endpoint: "/orderdatalist", paramKey: "search", idRequired: true },
  ],
  staff: [
    { endpoint: "/orderhispegination", paramKey: "search", idRequired: true },
    { endpoint: "/pegination", paramKey: "search", idRequired: false },
  ],
  accountant: [
    { endpoint: "/orderpegination", paramKey: "search", idRequired: false },
  ],
};

// Role-based route mapping — Gemini uses these to navigate
const roleRouteMap: Record<Role, Record<string, string>> = {
  admin: {
    dealer: "/dashboard/admin/dealer/DealerList",
    dealers: "/dashboard/admin/dealer/DealerList",
    "add dealer": "/dashboard/admin/dealer/AddDealerForm",
    "dealer detail": "/dashboard/admin/dealer/[id]",
    staff: "/dashboard/admin/staff/stafflist",
    "add staff": "/dashboard/admin/staff/addstaff",
    "staff detail": "/dashboard/admin/staff/[id]",
    orders: "/Pages/Ordermanagement",
    "outstanding orders": "/Pages/Ordermanagement/outstandingorders",
    products: "/Pages/products",
    "add product": "/Pages/products/addproducts",
    cart: "/Pages/Cart",
    invoices: "/orders",
    slider: "/dashboard/admin/slider",
    dashboard: "/dashboard/admin",
  },
  dealer: {
    orders: "/dashboard/dealer",
    "add order": "/dashboard/dealer/AddOrderForm",
    "my orders": "/dashboard/dealer",
    products: "/Products",
    cart: "/Pages/Cart",
    invoices: "/orders",
    dashboard: "/dashboard/dealer",
  },
  staff: {
    orders: "/dashboard/staff",
    "order status": "/dashboard/staff/orderstatus",
    "pdf post": "/dashboard/staff/staffpdfpost",
    products: "/Pages/products",
    "staff management": "/Pages/staffmanagement",
    "staff list": "/Pages/staffmanagement/stafflist",
    "add staff": "/Pages/staffmanagement/addstaff",
    invoices: "/orders",
    dashboard: "/dashboard/staff",
  },
  accountant: {
    orders: "/dashboard/accountant",
    dashboard: "/dashboard/accountant",
  },
};

async function fetchWithSearch(
  endpoint: string,
  search: string,
  userId?: string | number
): Promise<any[]> {
  try {
    const params = new URLSearchParams({ page: "1", search });
    if (userId) params.set("id", String(userId));
    const res = await fetch(`${BASE_URL}${endpoint}?${params.toString()}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    // Handle various response shapes
    return (
      data?.data ||
      data?.dealers ||
      data?.staff ||
      data?.orders ||
      data?.products ||
      (Array.isArray(data) ? data : [])
    );
  } catch {
    return [];
  }
}

function mapResultsToSearchItems(
  raw: any[],
  category: string,
  role: Role
): SearchResult[] {
  return raw.slice(0, 5).map((item) => {
    let label = "";
    let sublabel = "";
    let route = "/";
      const id = item.id || item.Dealer_Id || item.staff_id || item.order_id || item.Order_Id || "";

    if (category === "dealers") {
      label = item.Dealer_Name || item.name || "Dealer";
      sublabel = item.Dealer_City || item.email || "";
      route = role === "admin" ? `/dashboard/admin/dealer/${id}` : "/dashboard/dealer";
    } else if (category === "staff") {
      label = item.staff_name || item.name || "Staff";
      sublabel = item.staff_designation || item.staff_location || "";
      route = role === "admin" ? `/dashboard/admin/staff/${id}` : "/dashboard/staff";
    } else if (category === "orders") {
      label = `Order #${item.Order_Id || item.order_id || id}`;
      sublabel = item.Order_Status || item.status || item.Dealer_Name || "";
      route = `/orders/${id}`;
    } else if (category === "products") {
      label = item.Product_Name || item.name || "Product";
      sublabel = item.SKU || item.sku || item.category || "";
      route = item.SKU ? `/Products/${item.SKU}` : "/Pages/products";
    } else {
      label = item.name || item.title || String(id);
      route = "/";
    }

    return {
      id,
      label,
      sublabel,
      route,
      category,
      badge: category,
    };
  });
}

async function callGemini(
  query: string,
  role: Role,
  apiResults: SearchResult[]
): Promise<{ intent: string; route?: string; confidence: number }> {
  const routeMap = roleRouteMap[role];
  const prompt = `
You are a navigation assistant for a dealer management system. 
Role: ${role}
User query: "${query}"

Available routes for this role:
${Object.entries(routeMap)
  .map(([k, v]) => `- "${k}" → ${v}`)
  .join("\n")}

Live search results found:
${apiResults.slice(0, 3).map((r) => `- [${r.category}] ${r.label} → ${r.route}`).join("\n") || "none"}

Task: Determine the user's navigation intent. Reply ONLY as JSON:
{
  "intent": "<short description>",
  "route": "<best matching route or null>",
  "confidence": <0.0-1.0>
}

Rules:
- If live results exist and match the query, prefer their specific routes
- If query is a page name like "dealers", "staff", "orders" etc., use the route map
- If no match found, set route to null and confidence below 0.5
`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
        }),
      }
    );
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { intent: query, route: undefined, confidence: 0 };
  }
}

export function useSmartSearch(userCtx: UserContext) {
  const router = useRouter();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [geminiSuggestion, setGeminiSuggestion] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setResults([]);
        setGeminiSuggestion(null);
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          const { role, id } = userCtx;
          const endpoints = roleApiConfig[role] || [];

          // Fetch all relevant endpoints in parallel
          const fetched = await Promise.all(
            endpoints.map(async (cfg) => {
              const userId = cfg.idRequired ? id : undefined;
              const raw = await fetchWithSearch(cfg.endpoint, query, userId);
              // Detect category from endpoint name
              let category = "results";
              if (cfg.endpoint.includes("dealer")) category = "dealers";
              else if (cfg.endpoint.includes("staff")) category = "staff";
              else if (cfg.endpoint.includes("Order") || cfg.endpoint.includes("order"))
                category = "orders";
              else if (cfg.endpoint.includes("pegination")) category = "products";
              return mapResultsToSearchItems(raw, category, role);
            })
          );

          const allResults = fetched.flat().slice(0, 12);
          setResults(allResults);

          // Ask Gemini for intent + best route
          const gemini = await callGemini(query, role, allResults);
          if (gemini.route) {
            setGeminiSuggestion(gemini.route);
          } else {
            setGeminiSuggestion(null);
          }
        } finally {
          setLoading(false);
        }
      }, 350);
    },
    [userCtx]
  );

  const navigate = useCallback(
    (route: string) => {
      setResults([]);
      setGeminiSuggestion(null);
      router.push(route);
    },
    [router]
  );

  const navigateToGeminiSuggestion = useCallback(() => {
    if (geminiSuggestion) navigate(geminiSuggestion);
  }, [geminiSuggestion, navigate]);

  return {
    results,
    loading,
    geminiSuggestion,
    search,
    navigate,
    navigateToGeminiSuggestion,
  };
}
