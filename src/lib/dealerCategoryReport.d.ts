declare const dealerCategoryReport: {
  buildDealerPurchaseLines: (input: {
    dealer?: unknown;
    dealerId?: string;
    orders: unknown[];
    orderItemsByOrderId: Record<string, unknown[]>;
    catalogueProducts?: unknown[];
    fromDate?: string;
    toDate?: string;
    statusFilter?: string;
  }) => {
    filteredOrders: unknown[];
    lines: unknown[];
  };
  buildDealerCategoryReport: (input: {
    dealer?: unknown;
    dealerId?: string;
    orders: unknown[];
    orderItemsByOrderId: Record<string, unknown[]>;
    catalogueProducts?: unknown[];
    fromDate?: string;
    toDate?: string;
    statusFilter?: string;
    failedOrderIds?: string[];
  }) => {
    dealer: unknown;
    summary: Record<string, unknown>;
    products: unknown[];
    categories: unknown[];
    warnings: unknown[];
    meta: Record<string, unknown>;
  };
  aggregateDealerCategorySales: (
    items: unknown[],
    catalogueProducts?: unknown[]
  ) => {
    rows: Array<{
      category: string;
      quantity: number;
      pieces: number;
      gross: number;
      discount: number;
      netSales: number;
    }>;
    grandTotal: {
      quantity: number;
      pieces: number;
      gross: number;
      discount: number;
      netSales: number;
    };
  };
};

export default dealerCategoryReport;
