import { NextRequest, NextResponse } from "next/server";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";

export const runtime = "nodejs";

type HotItem = {
  id: string;
  SKU: string;
  name: string;
  image: string;
  badge: string;
  active: boolean;
};

type HotItemsDoc = {
  _id: string;
  items: HotItem[];
  createdAt?: string;
  updatedAt?: string;
};

const DOC_ID = "homepage-hot-items";
const MONGO_OPERATION_TIMEOUT_MS = 5000;

const DEFAULT_ITEMS: HotItem[] = [
  { id: "1", SKU: "163", name: "Adapters Reduction", image: "", badge: "Bestseller", active: true },
  { id: "2", SKU: "164", name: "Adapters Cone and Cone", image: "", badge: "Fast moving", active: true },
  { id: "3", SKU: "165", name: "Adapters Socket and Socket", image: "", badge: "Trending", active: true },
  { id: "4", SKU: "144", name: "Flask Erlenmeyer Amber", image: "", badge: "Popular", active: true },
  { id: "5", SKU: "145", name: "Flask Erlenmeyer Narrow", image: "", badge: "Top rated", active: true },
  { id: "6", SKU: "147", name: "Flask Iodine", image: "", badge: "Hot pick", active: false },
];

function safeText(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeItem(raw: unknown, index: number): HotItem | null {
  const candidate = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const SKU = safeText(candidate.SKU ?? candidate.sku, 120);
  const name = safeText(candidate.name ?? candidate.Name, 300);
  if (!SKU || !name) return null;

  return {
    id: safeText(candidate.id, 80) || `${Date.now()}-${index}`,
    SKU,
    name,
    image: safeText(candidate.image, 1000),
    badge: safeText(candidate.badge, 80) || "Hot pick",
    active: candidate.active !== false,
  };
}

function toDoc(items: HotItem[], updatedAt?: string, isDefault = false) {
  return { items, updatedAt: updatedAt ?? null, isDefault };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = MONGO_OPERATION_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Mongo operation timed out")), timeoutMs);
    }),
  ]);
}

export async function GET() {
  try {
    const db = await withTimeout(getDb());
    const doc = await withTimeout(db.collection<HotItemsDoc>("homepage_content").findOne({ _id: DOC_ID }));
    const isDefault = !doc;
    const items = Array.isArray(doc?.items) ? doc.items.map(normalizeItem).filter(Boolean) : DEFAULT_ITEMS;
    return NextResponse.json({ success: true, data: toDoc(items as HotItem[], doc?.updatedAt, isDefault) });
  } catch (error) {
    console.error("hot-items GET failed", error);
    return NextResponse.json({
      success: true,
      fallback: true,
      data: toDoc(DEFAULT_ITEMS, undefined, true),
    });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const bodyCandidate = (body && typeof body === "object" ? body : {}) as { items?: unknown };
    const items = (Array.isArray(bodyCandidate.items) ? bodyCandidate.items : [])
      .slice(0, 50)
      .map(normalizeItem)
      .filter(Boolean) as HotItem[];

    const now = new Date().toISOString();
    const db = await withTimeout(getDb());
    await db.collection<HotItemsDoc>("homepage_content").updateOne(
      { _id: DOC_ID },
      {
        $set: {
          items,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true, data: toDoc(items, now) });
  } catch (error) {
    console.error("hot-items PUT failed", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    const message = status === 503
      ? "Hot items database is currently unavailable"
      : "Unable to save hot items";
    return NextResponse.json({ success: false, message }, { status });
  }
}
