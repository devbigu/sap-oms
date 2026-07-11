export interface SearchQueryInfo {
  rawQuery: string;
  normalizedQuery: string;
  keywords: string[];
  keywordCount: number;
  hasOverflowKeywords: boolean;
  meaningfulCharacterCount: number;
}

export interface SearchableVariant {
  id?: string;
  sku?: string;
  catalogueNumber?: string;
  catalogueNo?: string;
  catalogue_no?: string;
  product_cat?: string;
  productName?: string;
  product_name?: string;
  name?: string;
  specs?: Record<string, unknown> | unknown[] | string;
  specifications?: Record<string, unknown> | unknown[] | string;
  specification?: Record<string, unknown> | unknown[] | string;
  specsText?: string;
  SpecsText?: string;
  description?: string;
  descriptionHtml?: string;
  image?: string | string[];
  imagePath?: string | string[];
  images?: string[];
}

export interface SearchableProduct {
  id?: string;
  sku?: string;
  catalogueNumber?: string;
  catalogueNo?: string;
  catalogue_no?: string;
  product_cat?: string;
  productName?: string;
  product_name?: string;
  name?: string;
  category?: string;
  categoryName?: string;
  category_name?: string;
  categories?: string[];
  features?: string[];
  description?: string;
  product_discription?: string;
  descriptionHtml?: string;
  specifications?: Record<string, unknown> | unknown[] | string;
  specification?: Record<string, unknown> | unknown[] | string;
  specs?: Record<string, unknown> | unknown[] | string;
  Specs?: Record<string, unknown> | unknown[] | string;
  specsText?: string;
  SpecsText?: string;
  image?: string | string[];
  imagePath?: string | string[];
  images?: string[];
  variants?: SearchableVariant[];
}

export interface NormalizedSearchVariant {
  id: string;
  catalogueNumber: string;
  normalizedCatalogueNumber: string;
  variantName: string;
  route: string;
  image: string;
  originalVariant: SearchableVariant | null;
  nameText: string;
  descriptionText: string;
  specificationsText: string;
  categoryText: string;
  categorySlugText: string;
}

export interface NormalizedSearchProduct {
  id: string;
  productName: string;
  catalogueNumber: string;
  normalizedCatalogueNumber: string;
  description: string;
  specificationsText: string;
  categoryName: string;
  categorySlug: string;
  categoryNames: string[];
  categorySlugs: string[];
  image: string;
  route: string;
  originalProduct: SearchableProduct;
  features: string[];
  productNameText: string;
  descriptionText: string;
  specificationsSearchText: string;
  categoryText: string;
  categorySlugText: string;
  variants: NormalizedSearchVariant[];
}

export interface ProductSearchMatch {
  id: string;
  score: number;
  matchType: string;
  allKeywordsMatch: boolean;
  matchedKeywordCount: number;
  index: number;
  productName: string;
  catalogueNumber: string;
  normalizedCatalogueNumber: string;
  description: string;
  specificationsText: string;
  categoryName: string;
  categorySlug: string;
  image: string;
  route: string;
  originalProduct: SearchableProduct;
  matchedVariant: SearchableVariant | null;
  previewText: string;
}

declare const productSearch: {
  MAX_KEYWORDS: number;
  DEFAULT_SUGGESTION_LIMIT: number;
  normalizeSearchQuery(value: string): string;
  getSearchQueryInfo(value: string): SearchQueryInfo;
  normalizeProductForSearch(product: SearchableProduct): NormalizedSearchProduct;
  scoreProductMatch(
    normalizedProduct: NormalizedSearchProduct,
    query: string | SearchQueryInfo,
    options?: { allowPartial?: boolean }
  ): {
    score: number;
    matchType: string;
    allKeywordsMatch: boolean;
    matchedKeywordCount: number;
    candidate: NormalizedSearchVariant;
    product: NormalizedSearchProduct;
  } | null;
  searchProducts(products: Array<SearchableProduct | NormalizedSearchProduct>, query: string): ProductSearchMatch[];
  getProductSuggestions(
    products: Array<SearchableProduct | NormalizedSearchProduct>,
    query: string,
    options?: { limit?: number }
  ): ProductSearchMatch[];
  buildSearchUrl(value: string): string;
  normalizeCatalogueNumber(value: string): string;
  flattenSpecificationValue(value: unknown): string;
};

export = productSearch;
