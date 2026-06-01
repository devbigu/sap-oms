import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

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

function normalizeItem(raw: any, index: number): HotItem | null {
  const SKU = safeText(raw?.SKU ?? raw?.sku, 120);
  const name = safeText(raw?.name ?? raw?.Name, 300);
  if (!SKU || !name) return null;

  return {
    id: safeText(raw?.id, 80) || `${Date.now()}-${index}`,
    SKU,
    name,
    image: safeText(raw?.image, 1000),
    badge: safeText(raw?.badge, 80) || "Hot pick",
    active: raw?.active !== false,
  };
}

function toDoc(items: HotItem[], updatedAt?: string, isDefault = false) {
  return { items, updatedAt: updatedAt ?? null, isDefault };
}

export async function GET() {
  try {
    const db = await getDb();
    const doc = await db.collection<HotItemsDoc>("homepage_content").findOne({ _id: DOC_ID });
    const isDefault = !doc;
    const items = Array.isArray(doc?.items) ? doc.items.map(normalizeItem).filter(Boolean) : DEFAULT_ITEMS;
    return NextResponse.json({ success: true, data: toDoc(items as HotItem[], doc?.updatedAt, isDefault) });
  } catch (e: any) {
    console.error("[GET /api/hot-items]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const items = (Array.isArray(body.items) ? body.items : [])
      .slice(0, 50)
      .map(normalizeItem)
      .filter(Boolean) as HotItem[];

    const now = new Date().toISOString();
    const db = await getDb();
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
  } catch (e: any) {
    console.error("[PUT /api/hot-items]", e);
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
