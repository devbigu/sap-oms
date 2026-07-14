declare const dealerCategoryReport: {
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
