export type DashboardSearchRole = "admin" | "staff" | "dealer" | "accountant";
export type DashboardSearchResultType = "product" | "order" | "dealer" | "staff";

export interface DashboardQueryInfo {
  rawQuery: string;
  normalizedText: string;
  keywords: string[];
  normalizedCatalogue: string;
  meaningfulCharacterCount: number;
  canSearch: boolean;
  orderInfo: {
    rawQuery: string;
    normalizedText: string;
    normalizedCompact: string;
    exactOrderId: string;
    isOrderLike: boolean;
  };
}

export interface DashboardSearchResult {
  id: string;
  type: DashboardSearchResultType;
  title: string;
  subtitle?: string;
  metadata?: string;
  image?: string;
  href: string;
  score: number;
  matchType?: string;
  orderId?: string;
  dealerId?: string;
  staffId?: string;
  catalogueNumber?: string;
}

export interface DashboardSearchResponse {
  results: DashboardSearchResult[];
  groups: {
    products: DashboardSearchResult[];
    orders: DashboardSearchResult[];
    dealers: DashboardSearchResult[];
    staff: DashboardSearchResult[];
  };
}

declare const dashboardSearch: {
  PRODUCT_GROUP_LIMIT: number;
  ORDER_GROUP_LIMIT: number;
  DEALER_GROUP_LIMIT: number;
  STAFF_GROUP_LIMIT: number;
  getDashboardQueryInfo(value: string): DashboardQueryInfo;
  normalizeOrderQuery(value: string): DashboardQueryInfo["orderInfo"];
  buildOrderDisplayNumber(orderId: string, orderDate?: string): string;
  resolveDashboardSearchHref(result: Partial<DashboardSearchResult> & Record<string, unknown>, role: DashboardSearchRole): string;
  searchDashboardProducts(products: unknown[], query: string | DashboardQueryInfo, options?: { role?: DashboardSearchRole; limit?: number }): DashboardSearchResult[];
  searchDashboardOrders(
    orders: unknown[],
    query: string | DashboardQueryInfo,
    options?: { role?: DashboardSearchRole; itemSummariesByOrderId?: Record<string, { searchText?: string; matchedByItemText?: boolean; matchedLabel?: string }> }
  ): DashboardSearchResult[];
  searchDashboardDealers(dealers: unknown[], query: string | DashboardQueryInfo, options?: { role?: DashboardSearchRole }): DashboardSearchResult[];
  searchDashboardStaff(staffRows: unknown[], query: string | DashboardQueryInfo, options?: { role?: DashboardSearchRole }): DashboardSearchResult[];
  buildDashboardSearchResponse(input: {
    role: DashboardSearchRole;
    query: string | DashboardQueryInfo;
    products?: unknown[];
    orders?: unknown[];
    dealers?: unknown[];
    staff?: unknown[];
    itemSummariesByOrderId?: Record<string, { searchText?: string; matchedByItemText?: boolean; matchedLabel?: string }>;
  }): DashboardSearchResponse;
  chooseDashboardSearchNavigation(input: {
    query: string;
    highlightedResult?: DashboardSearchResult | null;
    results?: DashboardSearchResult[];
  }): string;
  getNoResultsMessage(role: DashboardSearchRole): string;
  sortAndLimitResults(results: DashboardSearchResult[], limit: number): DashboardSearchResult[];
  groupDashboardResults(results: DashboardSearchResult[]): DashboardSearchResponse["groups"];
};

export = dashboardSearch;
