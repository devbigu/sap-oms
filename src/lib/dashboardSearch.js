const productSearch = require("./productSearch.js");

const {
  buildSearchUrl,
  getProductSuggestions,
  normalizeCatalogueNumber,
  normalizeProductForSearch,
} = productSearch;

const PRODUCT_GROUP_LIMIT = 8;
const ORDER_GROUP_LIMIT = 8;
const DEALER_GROUP_LIMIT = 5;
const STAFF_GROUP_LIMIT = 5;
const MAX_RESULTS = 30;

const PRODUCT_SCORE_BY_MATCH_TYPE = {
  "catalogue-exact": 2800,
  "catalogue-normalized-exact": 2750,
  "catalogue-prefix": 2650,
  "name-exact": 2300,
  "name-prefix": 2200,
  "name-keywords": 2050,
  "distributed-keywords": 2000,
  specifications: 1950,
  description: 1850,
  category: 1750,
  "catalogue-partial": 1650,
  "name-partial": 1550,
  "specifications-partial": 1450,
  "description-partial": 1350,
  "category-partial": 1250,
  partial: 1200,
};

function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return collapseWhitespace(String(value ?? "").replace(/<[^>]*>/g, " "));
}

function normalizeLooseText(value) {
  return collapseWhitespace(
    stripHtml(value)
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/&/g, " and ")
      .replace(/[_|]+/g, " ")
      .replace(/[^a-z0-9/+\-.()\s]+/g, " ")
  );
}

function splitKeywords(value) {
  return normalizeLooseText(value).split(/\s+/).filter(Boolean);
}

function pickFirstString() {
  for (const value of arguments) {
    const text = collapseWhitespace(value);
    if (text) return text;
  }
  return "";
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeOrderId(value) {
  const text = collapseWhitespace(value).replace(/[^\d]/g, "");
  return text ? String(Number(text)) : "";
}

function normalizeOrderQuery(value) {
  const rawQuery = collapseWhitespace(value);
  const lowered = rawQuery.toLowerCase();
  const compact = lowered.replace(/[\s]+/g, "");
  const formattedMatch = lowered.match(/^om[\s/-]*(\d{4})[\s/-]*(\d+)$/i);
  const exactOrderId = formattedMatch
    ? normalizeOrderId(formattedMatch[2])
    : /^\d+$/.test(rawQuery)
      ? normalizeOrderId(rawQuery)
      : "";

  return {
    rawQuery,
    normalizedText: normalizeLooseText(rawQuery),
    normalizedCompact: lowered.replace(/[^a-z0-9]/g, ""),
    exactOrderId,
    isOrderLike: Boolean(exactOrderId),
  };
}

function getDashboardQueryInfo(value) {
  const rawQuery = collapseWhitespace(value);
  const normalizedText = normalizeLooseText(rawQuery);
  const keywords = splitKeywords(rawQuery).slice(0, 5);
  const orderInfo = normalizeOrderQuery(rawQuery);
  const normalizedCatalogue = normalizeCatalogueNumber(rawQuery);
  const compactLength = rawQuery.replace(/\s+/g, "").length;
  const isShortIdentifierQuery =
    compactLength > 0 &&
    compactLength <= 4 &&
    /[0-9]/.test(rawQuery) &&
    /[a-z0-9/-]/i.test(rawQuery);

  return {
    rawQuery,
    normalizedText,
    keywords,
    orderInfo,
    normalizedCatalogue,
    meaningfulCharacterCount: normalizedText.replace(/\s+/g, "").length,
    canSearch:
      normalizedText.length > 0 &&
      (
        normalizedText.replace(/\s+/g, "").length >= 2 ||
        orderInfo.isOrderLike ||
        isShortIdentifierQuery
      ),
  };
}

function buildOrderDisplayNumber(orderId, orderDate) {
  const normalizedId = pickFirstString(orderId);
  if (!normalizedId) return "";

  const yearMatch = String(orderDate ?? "").match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());
  return `OM/${year}/${normalizedId}`;
}

function compareResults(left, right) {
  if (right.score !== left.score) return right.score - left.score;

  const leftTitle = String(left.title ?? "");
  const rightTitle = String(right.title ?? "");
  const titleCompare = leftTitle.localeCompare(rightTitle, undefined, { sensitivity: "base" });
  if (titleCompare !== 0) return titleCompare;

  return String(left.id ?? "").localeCompare(String(right.id ?? ""), undefined, { sensitivity: "base" });
}

function dedupeResults(results) {
  const seen = new Set();

  return results.filter((result) => {
    const key = `${result.type}:${result.id}:${result.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortAndLimitResults(results, limit) {
  return dedupeResults(results)
    .sort(compareResults)
    .slice(0, limit);
}

function resolveDashboardSearchHref(result, role) {
  if (!result || !result.type) return "";

  if (result.type === "product") {
    const catalogueNumber = pickFirstString(
      result.catalogueNumber,
      result.sku,
      result.id,
    );
    if (result.href) return String(result.href);
    if (!catalogueNumber) return "";
    return `/Products/${encodeURIComponent(catalogueNumber)}`;
  }

  if (result.type === "order") {
    const orderId = pickFirstString(result.orderId, result.id);
    return orderId ? `/orders/${encodeURIComponent(orderId)}` : "";
  }

  if (result.type === "dealer") {
    if (role !== "admin") return "";
    const dealerId = pickFirstString(result.dealerId, result.id);
    return dealerId ? `/dashboard/admin/dealer/${encodeURIComponent(dealerId)}` : "";
  }

  if (result.type === "staff") {
    if (role !== "admin") return "";
    const staffId = pickFirstString(result.staffId, result.id);
    return staffId ? `/dashboard/admin/staff/${encodeURIComponent(staffId)}` : "";
  }

  return "";
}

function toProductResult(match, role) {
  const score = PRODUCT_SCORE_BY_MATCH_TYPE[match.matchType] ?? 1200;
  const metadataBits = [];

  if (match.previewText) metadataBits.push(match.previewText);
  if (match.categoryName) metadataBits.push(match.categoryName);

  return {
    id: String(match.catalogueNumber || match.id),
    type: "product",
    title: match.productName,
    subtitle: match.catalogueNumber,
    metadata: metadataBits.filter(Boolean).join(" · "),
    image: match.image || "",
    href: resolveDashboardSearchHref({
      type: "product",
      href: match.route,
      catalogueNumber: match.catalogueNumber,
      id: match.id,
    }, role),
    score,
    matchType: match.matchType,
    catalogueNumber: match.catalogueNumber,
  };
}

function searchDashboardProducts(products, query, options = {}) {
  const queryInfo = typeof query === "string" ? getDashboardQueryInfo(query) : query;
  if (!queryInfo.canSearch) return [];

  const preparedProducts = (Array.isArray(products) ? products : []).map((product) =>
    product && product.originalProduct ? product : normalizeProductForSearch(product)
  );

  const matches = getProductSuggestions(preparedProducts, queryInfo.rawQuery, {
    limit: Number(options.limit) > 0 ? Number(options.limit) : PRODUCT_GROUP_LIMIT,
  });

  return sortAndLimitResults(
    matches
      .map((match) => toProductResult(match, options.role || "admin"))
      .filter((result) => Boolean(result.href)),
    Number(options.limit) > 0 ? Number(options.limit) : PRODUCT_GROUP_LIMIT,
  );
}

function buildOrderSearchText(order, itemSummary) {
  const orderId = pickFirstString(order.order_id, order.orderId, order.id);
  const formattedOrderNumber = buildOrderDisplayNumber(orderId, order.order_date || order.orderDate);
  const statusText = pickFirstString(order.order_status, order.status, order.mtstatus);
  const dealerName = pickFirstString(order.Dealer_Name, order.dealer_name, order.dealerName);
  const dateText = pickFirstString(order.order_date, order.orderDate);
  const itemText = pickFirstString(itemSummary?.searchText);

  return normalizeLooseText([
    orderId,
    formattedOrderNumber,
    statusText,
    dealerName,
    dateText,
    itemText,
  ].filter(Boolean).join(" "));
}

function scoreOrderResult(order, query, itemSummary) {
  const queryInfo = typeof query === "string" ? getDashboardQueryInfo(query) : query;
  if (!queryInfo.canSearch) return null;

  const orderId = pickFirstString(order.order_id, order.orderId, order.id);
  const formattedOrderNumber = buildOrderDisplayNumber(orderId, order.order_date || order.orderDate);
  const normalizedOrderId = normalizeOrderId(orderId);
  const dealerName = normalizeLooseText(
    pickFirstString(order.Dealer_Name, order.dealer_name, order.dealerName)
  );
  const statusText = normalizeLooseText(
    pickFirstString(order.order_status, order.status, order.mtstatus)
  );
  const dateText = normalizeLooseText(pickFirstString(order.order_date, order.orderDate));
  const combinedText = buildOrderSearchText(order, itemSummary);

  let score = 0;
  let matchType = "";

  if (queryInfo.orderInfo.exactOrderId && normalizedOrderId === queryInfo.orderInfo.exactOrderId) {
    score = 3000;
    matchType = "order-exact";
  } else if (
    queryInfo.orderInfo.normalizedCompact &&
    normalizeLooseText(formattedOrderNumber).replace(/[^a-z0-9]/g, "") === queryInfo.orderInfo.normalizedCompact
  ) {
    score = 2980;
    matchType = "order-format-exact";
  } else if (
    queryInfo.orderInfo.exactOrderId &&
    normalizedOrderId.startsWith(queryInfo.orderInfo.exactOrderId)
  ) {
    score = 2700;
    matchType = "order-prefix";
  } else if (
    queryInfo.normalizedText &&
    dealerName === queryInfo.normalizedText
  ) {
    score = 2100;
    matchType = "dealer-exact";
  } else if (
    queryInfo.normalizedText &&
    itemSummary?.matchedByItemText
  ) {
    score = 2050;
    matchType = "order-item-match";
  } else if (
    queryInfo.normalizedText &&
    dealerName.startsWith(queryInfo.normalizedText)
  ) {
    score = 1880;
    matchType = "dealer-prefix";
  } else if (
    queryInfo.normalizedText &&
    statusText.includes(queryInfo.normalizedText)
  ) {
    score = 1720;
    matchType = "status-match";
  } else if (
    queryInfo.normalizedText &&
    dateText.includes(queryInfo.normalizedText)
  ) {
    score = 1620;
    matchType = "date-match";
  } else if (
    queryInfo.keywords.length > 0 &&
    queryInfo.keywords.every((keyword) => combinedText.includes(normalizeLooseText(keyword)))
  ) {
    score = 1800;
    matchType = itemSummary?.matchedByItemText ? "order-item-match" : "order-keywords";
  } else if (
    queryInfo.normalizedText &&
    combinedText.includes(queryInfo.normalizedText)
  ) {
    score = itemSummary?.matchedByItemText ? 1700 : 1500;
    matchType = itemSummary?.matchedByItemText ? "order-item-match" : "order-partial";
  }

  if (score <= 0) return null;

  return {
    score,
    matchType,
  };
}

function buildOrderMetadata(order, itemSummary) {
  const bits = [];
  const amount = pickFirstString(
    order.netPayableAmount,
    order.net_payable_amount,
    order.order_net_amount,
    order.order_amount,
  );
  const formattedAmount = formatCurrency(amount);
  if (formattedAmount) bits.push(formattedAmount);

  const dateText = pickFirstString(order.order_date, order.orderDate);
  if (dateText) bits.push(dateText);

  const statusText = pickFirstString(order.order_status, order.status, order.mtstatus);
  if (statusText) bits.push(statusText);

  if (itemSummary?.matchedLabel) bits.push(`Contains: ${itemSummary.matchedLabel}`);
  return bits.join(" · ");
}

function toOrderResult(order, role, score, matchType, itemSummary) {
  const orderId = pickFirstString(order.order_id, order.orderId, order.id);
  const dealerName = pickFirstString(order.Dealer_Name, order.dealer_name, order.dealerName);
  const title = buildOrderDisplayNumber(orderId, order.order_date || order.orderDate) || orderId;
  const href = resolveDashboardSearchHref({
    type: "order",
    orderId,
  }, role);

  return {
    id: orderId,
    type: "order",
    title,
    subtitle: dealerName,
    metadata: buildOrderMetadata(order, itemSummary),
    href,
    score,
    matchType,
    orderId,
  };
}

function searchDashboardOrders(orders, query, options = {}) {
  const queryInfo = typeof query === "string" ? getDashboardQueryInfo(query) : query;
  if (!queryInfo.canSearch) return [];

  const role = options.role || "admin";
  const itemSummariesByOrderId = options.itemSummariesByOrderId || {};
  const results = [];

  for (const order of orders) {
    const orderId = pickFirstString(order.order_id, order.orderId, order.id);
    if (!orderId) continue;

    const itemSummary = itemSummariesByOrderId[orderId];
    const score = scoreOrderResult(order, queryInfo, itemSummary);
    if (!score) continue;

    const result = toOrderResult(order, role, score.score, score.matchType, itemSummary);
    if (result.href) results.push(result);
  }

  return sortAndLimitResults(results, ORDER_GROUP_LIMIT);
}

function buildDealerSearchText(dealer) {
  return normalizeLooseText([
    dealer.Dealer_Id,
    dealer.Dealer_Name,
    dealer.Dealer_City,
    dealer.Dealer_Number,
    dealer.Dealer_Email,
    dealer.Dealer_Dealercode,
    dealer.gst,
    dealer.staffname,
  ].filter(Boolean).join(" "));
}

function scoreDealerResult(dealer, query) {
  const queryInfo = typeof query === "string" ? getDashboardQueryInfo(query) : query;
  if (!queryInfo.canSearch) return null;

  const dealerId = pickFirstString(dealer.Dealer_Id);
  const dealerCode = normalizeLooseText(pickFirstString(dealer.Dealer_Dealercode));
  const dealerName = normalizeLooseText(pickFirstString(dealer.Dealer_Name));
  const city = normalizeLooseText(pickFirstString(dealer.Dealer_City));
  const phoneEmail = normalizeLooseText(
    [pickFirstString(dealer.Dealer_Number), pickFirstString(dealer.Dealer_Email)].filter(Boolean).join(" ")
  );
  const combinedText = buildDealerSearchText(dealer);

  if (queryInfo.normalizedText && dealerCode === queryInfo.normalizedText) {
    return { score: 2600, matchType: "dealer-code-exact" };
  }
  if (queryInfo.rawQuery && dealerId === queryInfo.rawQuery) {
    return { score: 2550, matchType: "dealer-id-exact" };
  }
  if (queryInfo.normalizedText && dealerName === queryInfo.normalizedText) {
    return { score: 2200, matchType: "dealer-name-exact" };
  }
  if (queryInfo.normalizedText && dealerName.startsWith(queryInfo.normalizedText)) {
    return { score: 2050, matchType: "dealer-name-prefix" };
  }
  if (queryInfo.normalizedText && phoneEmail.startsWith(queryInfo.normalizedText)) {
    return { score: 1900, matchType: "dealer-contact-prefix" };
  }
  if (queryInfo.normalizedText && (combinedText.includes(queryInfo.normalizedText) || city.includes(queryInfo.normalizedText))) {
    return { score: 1700, matchType: "dealer-partial" };
  }
  return null;
}

function searchDashboardDealers(dealers, query, options = {}) {
  const role = options.role || "admin";
  if (role !== "admin") return [];

  const results = [];

  for (const dealer of Array.isArray(dealers) ? dealers : []) {
    const score = scoreDealerResult(dealer, query);
    if (!score) continue;

    const dealerId = pickFirstString(dealer.Dealer_Id);
    const href = resolveDashboardSearchHref({ type: "dealer", dealerId }, role);
    if (!href) continue;

    results.push({
      id: dealerId,
      type: "dealer",
      title: pickFirstString(dealer.Dealer_Name, dealerId),
      subtitle: pickFirstString(dealer.Dealer_Dealercode, dealer.Dealer_City),
      metadata: [
        pickFirstString(dealer.Dealer_City),
        pickFirstString(dealer.staffname),
      ].filter(Boolean).join(" · "),
      href,
      score: score.score,
      matchType: score.matchType,
      dealerId,
    });
  }

  return sortAndLimitResults(results, DEALER_GROUP_LIMIT);
}

function buildStaffSearchText(staff) {
  return normalizeLooseText([
    staff.staff_id,
    staff.staff_name,
    staff.staff_email,
    staff.staff_location,
    staff.staff_designation,
    staff.staff_roletype,
    staff.staff_phone,
    staff.staff_mobile,
  ].filter(Boolean).join(" "));
}

function scoreStaffResult(staff, query) {
  const queryInfo = typeof query === "string" ? getDashboardQueryInfo(query) : query;
  if (!queryInfo.canSearch) return null;

  const staffId = pickFirstString(staff.staff_id);
  const staffName = normalizeLooseText(pickFirstString(staff.staff_name));
  const emailPhone = normalizeLooseText(
    [pickFirstString(staff.staff_email), pickFirstString(staff.staff_phone), pickFirstString(staff.staff_mobile)]
      .filter(Boolean)
      .join(" ")
  );
  const combinedText = buildStaffSearchText(staff);

  if (queryInfo.rawQuery && staffId === queryInfo.rawQuery) {
    return { score: 2500, matchType: "staff-id-exact" };
  }
  if (queryInfo.normalizedText && staffName === queryInfo.normalizedText) {
    return { score: 2200, matchType: "staff-name-exact" };
  }
  if (queryInfo.normalizedText && staffName.startsWith(queryInfo.normalizedText)) {
    return { score: 2050, matchType: "staff-name-prefix" };
  }
  if (queryInfo.normalizedText && emailPhone.startsWith(queryInfo.normalizedText)) {
    return { score: 1900, matchType: "staff-contact-prefix" };
  }
  if (queryInfo.normalizedText && combinedText.includes(queryInfo.normalizedText)) {
    return { score: 1700, matchType: "staff-partial" };
  }
  return null;
}

function getStaffRoleLabel(value) {
  const raw = String(value ?? "").trim();
  if (raw === "0") return "Admin";
  if (raw === "1") return "Executive";
  if (raw === "2") return "Field Executive";
  return raw || "Staff";
}

function searchDashboardStaff(staffRows, query, options = {}) {
  const role = options.role || "admin";
  if (role !== "admin") return [];

  const results = [];

  for (const staff of Array.isArray(staffRows) ? staffRows : []) {
    const score = scoreStaffResult(staff, query);
    if (!score) continue;

    const staffId = pickFirstString(staff.staff_id);
    const href = resolveDashboardSearchHref({ type: "staff", staffId }, role);
    if (!href) continue;

    results.push({
      id: staffId,
      type: "staff",
      title: pickFirstString(staff.staff_name, staffId),
      subtitle: staffId,
      metadata: [
        getStaffRoleLabel(staff.staff_roletype),
        pickFirstString(staff.staff_email, staff.staff_phone, staff.staff_mobile),
      ].filter(Boolean).join(" · "),
      href,
      score: score.score,
      matchType: score.matchType,
      staffId,
    });
  }

  return sortAndLimitResults(results, STAFF_GROUP_LIMIT);
}

function groupDashboardResults(results) {
  return {
    products: results.filter((result) => result.type === "product"),
    orders: results.filter((result) => result.type === "order"),
    dealers: results.filter((result) => result.type === "dealer"),
    staff: results.filter((result) => result.type === "staff"),
  };
}

function buildDashboardSearchResponse(input) {
  const role = input.role || "admin";
  const queryInfo = typeof input.query === "string" ? getDashboardQueryInfo(input.query) : input.query;
  const products = searchDashboardProducts(input.products || [], queryInfo, { role, limit: PRODUCT_GROUP_LIMIT });
  const orders = searchDashboardOrders(input.orders || [], queryInfo, {
    role,
    itemSummariesByOrderId: input.itemSummariesByOrderId || {},
  });
  const dealers = searchDashboardDealers(input.dealers || [], queryInfo, { role });
  const staff = searchDashboardStaff(input.staff || [], queryInfo, { role });
  const results = sortAndLimitResults(
    [...products, ...orders, ...dealers, ...staff].filter((result) => Boolean(result.href)),
    MAX_RESULTS,
  );

  return {
    results,
    groups: groupDashboardResults(results),
  };
}

function chooseDashboardSearchNavigation(input) {
  const highlighted = input.highlightedResult;
  if (highlighted?.href) return highlighted.href;

  const results = Array.isArray(input.results) ? input.results : [];
  const exactOrders = results.filter((result) =>
    result.type === "order" &&
    (result.matchType === "order-exact" || result.matchType === "order-format-exact")
  );
  if (exactOrders.length === 1) return exactOrders[0].href;

  const exactProducts = results.filter((result) =>
    result.type === "product" &&
    (result.matchType === "catalogue-exact" || result.matchType === "catalogue-normalized-exact")
  );
  if (exactProducts.length === 1) return exactProducts[0].href;

  return buildSearchUrl(input.query || "");
}

function getNoResultsMessage(role) {
  if (role === "staff") return "No matching products or assigned orders found.";
  if (role === "dealer") return "No matching products or your orders found.";
  return "No matching products, orders, dealers, or staff found.";
}

module.exports = {
  PRODUCT_GROUP_LIMIT,
  ORDER_GROUP_LIMIT,
  DEALER_GROUP_LIMIT,
  STAFF_GROUP_LIMIT,
  getDashboardQueryInfo,
  normalizeOrderQuery,
  buildOrderDisplayNumber,
  resolveDashboardSearchHref,
  searchDashboardProducts,
  searchDashboardOrders,
  searchDashboardDealers,
  searchDashboardStaff,
  buildDashboardSearchResponse,
  chooseDashboardSearchNavigation,
  getNoResultsMessage,
  sortAndLimitResults,
  groupDashboardResults,
};
