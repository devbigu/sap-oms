function safeText(value, max = 240) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : String(value ?? "").trim().slice(0, max);
}

function normalizeDealerRecord(row) {
  return {
    Dealer_Id: safeText(row?.Dealer_Id, 120),
    Dealer_Name: safeText(row?.Dealer_Name, 200),
    Dealer_City: safeText(row?.Dealer_City, 120),
    Dealer_Number: safeText(row?.Dealer_Number, 80),
    Dealer_Dealercode: safeText(row?.Dealer_Dealercode, 120),
    assignedstaff: safeText(row?.assignedstaff, 240),
    staffname: safeText(row?.staffname, 240),
  };
}

function dealerMatchesSearch(dealer, search) {
  const needle = safeText(search).toLowerCase();
  if (!needle) return true;

  const haystack = [
    dealer?.Dealer_Name,
    dealer?.Dealer_Dealercode,
    dealer?.Dealer_City,
    dealer?.Dealer_Id,
    dealer?.Dealer_Number,
  ]
    .map((value) => safeText(value))
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function paginateRows(rows, page = 1, pageSize = 10) {
  const resolvedPageSize = Math.max(1, Math.floor(Number(pageSize) || 10));
  const total = Array.isArray(rows) ? rows.length : 0;
  const lastPage = Math.max(1, Math.ceil(total / resolvedPageSize));
  const currentPage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), lastPage);
  const start = (currentPage - 1) * resolvedPageSize;

  return {
    page: currentPage,
    pageSize: resolvedPageSize,
    total,
    lastPage,
    data: (Array.isArray(rows) ? rows : []).slice(start, start + resolvedPageSize),
  };
}

function buildDealerSelectionPage(input) {
  const normalized = (Array.isArray(input?.dealers) ? input.dealers : []).map(normalizeDealerRecord);
  const filtered = normalized.filter((dealer) => dealerMatchesSearch(dealer, input?.search));
  return paginateRows(filtered, input?.page, input?.pageSize);
}

function canStaffAccessDealer(assignedDealers, dealerId) {
  const targetDealerId = safeText(dealerId, 120);
  if (!targetDealerId) return false;

  return (Array.isArray(assignedDealers) ? assignedDealers : [])
    .map(normalizeDealerRecord)
    .some((dealer) => dealer.Dealer_Id === targetDealerId);
}

module.exports = {
  normalizeDealerRecord,
  dealerMatchesSearch,
  paginateRows,
  buildDealerSelectionPage,
  canStaffAccessDealer,
};
