export type CatalogueVariant = {
  id: string;
  sku: string;
  slug?: string;
  name: string;
  specs?: Record<string, string>;
  specsText?: string;
  pack?: number;
  price?: number;
  priceLabel?: string;
  inStock?: boolean;
  images?: string[];
};

export type CatalogueProduct = {
  id: string;
  sku: string;
  slug?: string;
  name: string;
  category?: string;
  categories?: string[];
  page?: number;
  features?: string[];
  descriptionHtml?: string;
  images?: string[];
  variants?: CatalogueVariant[];
};

export type CatalogueSectionGroup<T extends CatalogueProduct = CatalogueProduct> = {
  section: string;
  products: T[];
};

export type CatalogueIndex<T extends CatalogueProduct = CatalogueProduct> = {
  sections: CatalogueSectionGroup<T>[];
  products: T[];
  productsBySku: Record<string, T>;
  variantsBySku: Record<string, {
    product: T;
    variant: CatalogueVariant;
  }>;
};

const SECTION_FALLBACK = "Uncategorized";

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripHtml(value: string | undefined | null): string {
  if (!value) return "";
  return collapseWhitespace(value.replace(/<[^>]*>/g, " "));
}

export function normalizeText(value: string | undefined | null): string {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

export function getCatalogueSection(product: CatalogueProduct): string {
  const fromCategory = product.category?.trim();
  if (fromCategory) return fromCategory;

  const fromPath = product.categories?.[0]?.split(">")?.pop()?.trim();
  if (fromPath) return fromPath;

  return SECTION_FALLBACK;
}

function firstMeaningfulWords(value: string, limit = 18): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, limit)
    .join(" ");
}

export function getCatalogueProductDescriptor(product: CatalogueProduct): string {
  const pieces: string[] = [];
  const description = stripHtml(product.descriptionHtml);
  const cleanedDescription = description.replace(/^\s*\d+\s*[-–—]?\s*/g, "").trim();

  if (cleanedDescription && normalizeText(cleanedDescription) !== normalizeText(product.name)) {
    pieces.push(firstMeaningfulWords(cleanedDescription));
  }

  const featureHints = (product.features ?? [])
    .map((feature) => collapseWhitespace(feature))
    .filter((feature) => /class|certificate|nabl|iso|astm|usp|amber|clear|colour|color|wide mouth|tpx|pp/i.test(feature));

  if (!pieces.length && featureHints.length) {
    pieces.push(firstMeaningfulWords(featureHints.slice(0, 2).join(" · ")));
  }

  const descriptor = pieces.join(" ");
  return descriptor && normalizeText(descriptor) !== normalizeText(product.name)
    ? descriptor
    : "";
}

export function getCatalogueProductLabel(product: CatalogueProduct): string {
  const descriptor = getCatalogueProductDescriptor(product);
  return descriptor ? `${product.name} - ${descriptor}` : product.name;
}

export function getVariantSpecSummary(variant: CatalogueVariant): string {
  const specEntries = Object.entries(variant.specs ?? {})
    .filter(([, value]) => String(value ?? "").trim().length > 0);

  if (specEntries.length > 0) {
    const preferredKeys = [
      "Capacity",
      "Capacity (mL)",
      "Capacity (ml)",
      "Size",
      "Effective Length",
      "Length",
      "Volume",
    ];

    for (const key of preferredKeys) {
      const match = specEntries.find(([specKey]) => normalizeText(specKey).includes(normalizeText(key)));
      if (match) {
        return `${match[0]} ${match[1]}`.trim();
      }
    }

    return specEntries
      .slice(0, 2)
      .map(([key, value]) => `${key} ${value}`.trim())
      .join(" · ");
  }

  if (variant.specsText) {
    const parts = variant.specsText
      .split(";")
      .map((part) => collapseWhitespace(part))
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.slice(0, 2).join(" · ");
    }
  }

  return "Specification not listed";
}

export function getVariantLabel(product: CatalogueProduct, variant: CatalogueVariant): string {
  const summary = getVariantSpecSummary(variant);
  const packLabel = `Pack of ${variant.pack ?? 1}`;
  return `${variant.sku} - ${summary} - ${packLabel}`;
}

export function buildCatalogueSearchText(product: CatalogueProduct): string {
  const parts: string[] = [
    product.name ?? "",
    product.sku ?? "",
    product.category ?? "",
    ...(product.categories ?? []),
    ...(product.features ?? []),
    stripHtml(product.descriptionHtml),
  ];

  for (const variant of product.variants ?? []) {
    parts.push(
      variant.sku ?? "",
      variant.id ?? "",
      variant.name ?? "",
      variant.specsText ?? "",
      ...(variant.specs ? Object.entries(variant.specs).map(([key, value]) => `${key} ${value}`) : []),
    );
  }

  return normalizeText(parts.join(" "));
}

export function matchesCatalogueQuery(product: CatalogueProduct, query: string): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  return buildCatalogueSearchText(product).includes(q);
}

export function buildCatalogueIndex<T extends CatalogueProduct>(products: T[]): CatalogueIndex<T> {
  const sections = new Map<string, CatalogueSectionGroup<T>>();
  const productsBySku: Record<string, T> = {};
  const variantsBySku: CatalogueIndex<T>["variantsBySku"] = {};
  const flatProducts: T[] = [];

  for (const product of products) {
    const section = getCatalogueSection(product);
    const existingSection = sections.get(section);
    if (existingSection) {
      existingSection.products.push(product);
    } else {
      sections.set(section, { section, products: [product] });
    }

    flatProducts.push(product);
    productsBySku[String(product.sku)] = product;
    productsBySku[String(product.id)] = product;

    for (const variant of product.variants ?? []) {
      variantsBySku[String(variant.sku)] = { product, variant };
      variantsBySku[String(variant.id)] = { product, variant };
    }
  }

  return {
    sections: Array.from(sections.values()),
    products: flatProducts,
    productsBySku,
    variantsBySku,
  };
}

export function groupProductsBySection<T extends CatalogueProduct>(products: T[]): CatalogueSectionGroup<T>[] {
  return buildCatalogueIndex(products).sections;
}

export function findCatalogueEntry<T extends CatalogueProduct>(
  index: CatalogueIndex<T>,
  sku: string,
): { product: T; variant?: CatalogueVariant } | null {
  const raw = String(sku ?? "").trim();
  if (!raw) return null;

  const variantMatch = index.variantsBySku[raw];
  if (variantMatch) {
    return {
      product: variantMatch.product,
      variant: variantMatch.variant,
    };
  }

  const product = index.productsBySku[raw];
  return product ? { product } : null;
}
