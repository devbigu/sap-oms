export const SIDEBAR_CATEGORIES: Record<string, string[]> = {
  Accessories: ["Accessories"],
  Adapters: ["Adaptors", "Adapters", "Laboratory Glassware > Adapters"],
  Distillation: ["Distillations", "Laboratory Glassware > Distillations"],
  Flasks: [
    "Flasks",
    "Laboratory Glassware > Flasks",
    "Laboratory Glassware > Flasks > Flask Conical",
    "Laboratory Glassware > Flasks > Round Bottom Flask",
  ],
  "Volumetric Flasks": ["Flasks, Volumetric", "Laboratory Glassware > Volumetric Flask"],
  Bottles: ["Bottles", "Laboratory Glassware > Bottles", "Laboratory Glassware > Reagent Bottles"],
  Burettes: ["Burettes", "Laboratory Glassware > Burettes"],
  Pipettes: ["Pipettes", "Laboratory Glassware > Pipettes"],
  Funnels: ["Funnels", "Laboratory Glassware > Funnels"],
  Cylinders: ["Cylinders", "Laboratory Glassware > Cylinders"],
  Beakers: ["Beakers", "Laboratory Glassware > Beakers"],
  Tubes: ["Tubes", "Laboratory Glassware > Tubes", "Laboratory Glassware > Tubes > Culture Media"],
  Condensers: ["Condensers", "Laboratory Glassware > Condensers"],
  Columns: ["Columns", "Laboratory Glassware > Columns"],
  Viscometers: ["Viscometers", "Laboratory Glassware > Viscometers"],
  Crucibles: ["Crucibles", "Laboratory Glassware > Crucibles"],
  Desiccators: ["Desiccator / Dishes", "Laboratory Glassware > Dessicators", "Laboratory Glassware > Desiccators"],
  "Joints & Stopcocks": ["Laboratory Glassware > Joints", "Laboratory Glassware > Stopcock", "Laboratory Glassware > Stopper"],
  Dishes: ["Desiccator / Dishes", "Laboratory Glassware > Dishes"],
  Extraction: ["Laboratory Glassware > Extraction Apparatus"],
  Kjeldahl: ["Laboratory Glassware > Kjeldahl Apparatus"],
  Hydrometers: [
    "Hydrometers",
    "Hydrometers > Petroleum Testing",
    "Hydrometers > Specific Gravity",
    "Hydrometers > Brix",
    "Hydrometers > Alcoholometer",
    "Hydrometers > Density Hydrometers",
    "Hydrometers > Lactometer",
    "Hydrometers > Baume",
    "Hydrometers > API Scale Hydrometers",
    "Hydrometers > Twaddle",
    "Hydrometers > Soil Glass",
    "Hydrometers > Sikes",
    "Hydrometers > Brass Baume",
    "Hydrometers > Wine Testing Kit",
    "Hydrometers > Brass Brix",
    "Hydrometers > Plato Scale",
    "Hydrometers > Hydrometer Cylinder",
  ],
  "Petroleum Measurement": ["Petroleum Measurement", "Hydrometers > Petroleum Testing"],
  Thermometers: ["Thermometers"],
  Hygrometers: ["Hygrometers"],
  Rubberware: ["Rubberware"],
  Plasticware: ["Plasticware"],
  Metalware: ["Metalware"],
  Porcelain: ["Porcelain"],
  "Sintered Glassware": ["Sintered Glassware"],
  Brushes: ["Brushes"],
  "Lab Instruments": ["Lab Instruments", "Laboratory Instruments"],
  Education: ["Education Supplies", "Education Supplies > Spectrum Utilities"],
  Filters: ["Filters & Membrane"],
  "Liquid Handling": ["Liquid Handling"],
};

export function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeCategory(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9>]+/g, " ")
    .replace(/\s*>\s*/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryTokens(value: string): string[] {
  const normalized = normalizeCategory(value);
  if (!normalized) return [];

  return [
    normalized,
    ...normalized
      .split(">")
      .map((part) => part.trim())
      .filter(Boolean),
  ];
}

export function compactCategoryList(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function labelFromSlug(slug: string): string | null {
  return Object.keys(SIDEBAR_CATEGORIES).find((label) => slugify(label) === slug) ?? null;
}

export function matchesCategory(productCategories: string[], label: string): boolean {
  const aliases = [label, ...(SIDEBAR_CATEGORIES[label] ?? [])];
  const aliasTokens = new Set(aliases.flatMap(categoryTokens));
  const productTokens = productCategories.flatMap(categoryTokens);

  return productTokens.some((category) => aliasTokens.has(category));
}
