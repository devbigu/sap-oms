export const SIDEBAR_CATEGORIES: Record<string, string[]> = {
  "Adapters":           ["Laboratory Glassware > Adapters"],
  "Distillation":       ["Laboratory Glassware > Distillations"],
  "Flasks":             ["Laboratory Glassware > Flasks", "Laboratory Glassware > Flasks > Flask Conical", "Laboratory Glassware > Flasks > Round Bottom Flask", "Laboratory Glassware > Volumetric Flask"],
  "Bottles":            ["Laboratory Glassware > Bottles", "Laboratory Glassware > Reagent Bottles"],
  "Burettes":           ["Laboratory Glassware > Burettes"],
  "Pipettes":           ["Laboratory Glassware > Pipettes"],
  "Funnels":            ["Laboratory Glassware > Funnels"],
  "Cylinders":          ["Laboratory Glassware > Cylinders"],
  "Beakers":            ["Laboratory Glassware > Beakers"],
  "Tubes":              ["Laboratory Glassware > Tubes", "Laboratory Glassware > Tubes > Culture Media"],
  "Condensers":         ["Laboratory Glassware > Condensers"],
  "Columns":            ["Laboratory Glassware > Columns"],
  "Viscometers":        ["Laboratory Glassware > Viscometers"],
  "Crucibles":          ["Laboratory Glassware > Crucibles"],
  "Desiccators":        ["Laboratory Glassware > Dessicators"],
  "Joints & Stopcocks": ["Laboratory Glassware > Joints", "Laboratory Glassware > Stopcock", "Laboratory Glassware > Stopper"],
  "Dishes":             ["Laboratory Glassware > Dishes"],
  "Extraction":         ["Laboratory Glassware > Extraction Apparatus"],
  "Kjeldahl":           ["Laboratory Glassware > Kjeldahl Apparatus"],
  "Hydrometers":        ["Hydrometers", "Hydrometers > Petroleum Testing", "Hydrometers > Specific Gravity", "Hydrometers > Brix (°Bx)", "Hydrometers > Alcoholometer", "Hydrometers > Density Hydrometers", "Hydrometers > Lactometer", "Hydrometers > Baume (°Be)", "Hydrometers > API Scale Hydrometers", "Hydrometers > Twaddle", "Hydrometers > Soil Glass", "Hydrometers > Sikes(°SK)", "Hydrometers > Brass Baume", "Hydrometers > Wine Testing Kit", "Hydrometers > Brass Brix", "Hydrometers > Plato Scale", "Hydrometers > Hydrometer Cylinder"],
  "Thermometers":       ["Thermometers"],
  "Hygrometers":        ["Hygrometers"],
  "Rubberware":         ["Rubberware"],
  "Plasticware":        ["Plasticware"],
  "Metalware":          ["Metalware"],
  "Brushes":            ["Brushes"],
  "Lab Instruments":    ["Laboratory Instruments"],
  "Education":          ["Education Supplies", "Education Supplies > Spectrum Utilities"],
  "Filters":            ["Filters & Membrane"],
  "Liquid Handling":    ["Liquid Handling"],
};

export const CATEGORY_LABELS = Object.keys(SIDEBAR_CATEGORIES);

export const FEATURED_NAV_CATEGORIES = [
  "Filters",
  "Hydrometers",
  "Thermometers",
  "Plasticware",
  "Lab Instruments",
  "Flasks",
] as const;

export function getCategoryFilterHref(label: string): string {
  return `/Products?cat=${encodeURIComponent(label)}`;
}

export function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function labelFromSlug(slug: string): string | null {
  return CATEGORY_LABELS.find((l) => slugify(l) === slug) ?? null;
}

export function matchesCategory(productCategories: string[], label: string): boolean {
  const cats = SIDEBAR_CATEGORIES[label] ?? [];
  return productCategories.some(c => cats.includes(c));
}
