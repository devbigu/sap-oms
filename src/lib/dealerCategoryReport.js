const { normalizeCatalogueNumber } = require("./productSearch.js");

const UNCATEGORIZED = "Uncategorized";

function safeText(value, max = 400) {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (typeof value === "number") return String(value).trim().slice(0, max);
  return String(value ?? "").trim().slice(0, max);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  const amount = typeof value === "number"
    ? value
    : Number(String(value).replace(/,/g, "").trim());

  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function firstNumeric(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const amount = toNumber(value);
    if (Number.isFinite(amount)) return amount;
  }
  return 0;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return "";
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function splitCsv(value) {
  return Array.from(new Set(
    safeText(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  ));
}

function parseDateMs(value) {
  const text = safeText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDate(value) {
  const parsed = parseDateMs(value);
  return parsed === null ? "" : new Date(parsed).toISOString();
}

function normalizeCategoryName(value) {
  const text = firstNonEmpty(value);
  if (!text) return "";
  const parts = text
    .split(">")
    .map((part) => safeText(part))
    .filter(Boolean);
  return parts[parts.length - 1] || text;
}

function statusText(order) {
  return [
    order?.order_status,
    order?.status,
    order?.mtstatus,
    order?.reason,
  ]
    .map((value) => safeText(value).toLowerCase())
    .join(" ");
}

function hasCancelledFlag(order) {
  if (safeText(order?.del_status) === "1") return true;
  return /(cancel|cancelled|canceled|reject|rejected|declin|deleted)/i.test(statusText(order));
}

function mtStatusValue(value) {
  if (!value && value !== 0) return "NoActionTaken";
  const key = safeText(value).toLowerCase().replace(/[\s_-]/g, "");
  if (key === "pending") return "Pending";
  if (key === "inprocess") return "InProcess";
  if (key === "completed") return "Completed";
  if (key === "successful" || key === "success") return "Completed";
  return "NoActionTaken";
}

function classifyOrder(order) {
  if (hasCancelledFlag(order)) return "Cancelled";
  if (safeText(order?.accept_order || "0") !== "1") return "Awaiting";

  const numericMtStatus = Number(order?.mtstatus ?? "");
  const text = statusText(order);
  const isSettled = mtStatusValue(order?.mtstatus) === "Completed"
    || (Number.isFinite(numericMtStatus) && numericMtStatus >= 2)
    || /(completed|successful|dispatch)/i.test(text);

  return isSettled ? "SentAndSettled" : "SupposedToGo";
}

function isEligibleOrder(order) {
  return classifyOrder(order) !== "Cancelled";
}

function matchesStatusFilter(order, filter = "all") {
  if (!isEligibleOrder(order)) return false;
  if (filter === "accepted") return safeText(order?.accept_order || "0") === "1";
  if (filter === "completed") return classifyOrder(order) === "SentAndSettled";
  return true;
}

function withinDateRange(value, fromDate, toDate) {
  const dateMs = parseDateMs(value);
  if (dateMs === null) return false;

  const fromMs = fromDate ? parseDateMs(fromDate) : null;
  const toMs = toDate ? parseDateMs(toDate) : null;

  if (fromMs !== null && dateMs < fromMs) return false;
  if (toMs !== null && dateMs > (toMs + (24 * 60 * 60 * 1000) - 1)) return false;
  return true;
}

function buildCatalogueLookup(products) {
  const byRawCatalogueNumber = new Map();
  const byNormalizedCatalogueNumber = new Map();

  function register(rawValue, entry) {
    const raw = safeText(rawValue);
    if (!raw) return;
    byRawCatalogueNumber.set(raw, entry);

    const normalized = normalizeCatalogueNumber(raw);
    if (normalized) byNormalizedCatalogueNumber.set(normalized, entry);
  }

  function categoryFromProduct(product) {
    return normalizeCategoryName(
      product?.category
      || product?.categoryName
      || product?.category_name
      || (Array.isArray(product?.categories) ? product.categories[0] : "")
    ) || UNCATEGORIZED;
  }

  function specificationFromProduct(product) {
    return firstNonEmpty(
      product?.specification,
      product?.specifications,
      product?.specs,
      product?.product_discription,
      product?.description
    );
  }

  for (const product of Array.isArray(products) ? products : []) {
    if (!product || typeof product !== "object") continue;

    const category = categoryFromProduct(product);
    const productName = firstNonEmpty(product.productName, product.product_name, product.name);
    const specification = specificationFromProduct(product);
    const productPackSize = firstNumeric(product.pack, product.packSize, product.pack_size);
    const baseEntry = {
      category,
      productName,
      specification,
      packSize: productPackSize > 0 ? productPackSize : 1,
    };

    register(
      firstNonEmpty(
        product.catalogueNumber,
        product.catalogueNo,
        product.catalogue_no,
        product.product_cat,
        product.sku,
        product.id
      ),
      baseEntry
    );

    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      if (!variant || typeof variant !== "object") continue;
      register(
        firstNonEmpty(
          variant.catalogueNumber,
          variant.catalogueNo,
          variant.catalogue_no,
          variant.product_cat,
          variant.sku,
          variant.id
        ),
        {
          category,
          productName: firstNonEmpty(variant.productName, variant.product_name, variant.name, productName),
          specification: firstNonEmpty(
            variant.specification,
            variant.specifications,
            variant.specs,
            variant.product_discription,
            specification
          ),
          packSize: firstNumeric(variant.pack, variant.packSize, variant.pack_size, productPackSize) || 1,
        }
      );
    }
  }

  return { byRawCatalogueNumber, byNormalizedCatalogueNumber };
}

function resolveCatalogueEntry(lookup, catalogueNumber) {
  const raw = safeText(catalogueNumber);
  if (!raw) return null;

  const direct = lookup?.byRawCatalogueNumber?.get(raw);
  if (direct) return direct;

  const normalized = normalizeCatalogueNumber(raw);
  return normalized ? lookup?.byNormalizedCatalogueNumber?.get(normalized) || null : null;
}

function resolveCatalogueNumber(item) {
  return firstNonEmpty(
    item?.orderdata_cat_no,
    item?.variantCode,
    item?.variant_code,
    item?.product_cat,
    item?.productId,
    item?.catNo,
    item?.cat_no,
    item?.catalogueNumber,
    item?.catalogue_number,
    item?.catalogue_no,
    item?.sku
  );
}

function resolveItemCategory(item, lookup, entry) {
  const direct = normalizeCategoryName(
    item?.category
    || item?.item_category
    || item?.product_category
    || item?.productCategory
  );

  if (direct) return direct;
  if (entry?.category) return entry.category;

  const catalogueNumber = resolveCatalogueNumber(item);
  const lookupEntry = entry || resolveCatalogueEntry(lookup, catalogueNumber);
  return lookupEntry?.category || UNCATEGORIZED;
}

function resolveProductName(item, entry) {
  return firstNonEmpty(
    item?.product_name,
    item?.productName,
    entry?.productName,
    resolveCatalogueNumber(item),
    "Unnamed product"
  );
}

function resolveSpecification(item, entry) {
  return firstNonEmpty(
    item?.product_discription,
    item?.productDescription,
    entry?.specification
  );
}

function resolvePackSize(item, entry) {
  const direct = firstNumeric(item?.packSize, item?.pack_size, item?.total_pack_size);
  if (direct > 0) return direct;
  if (entry?.packSize > 0) return entry.packSize;
  return 1;
}

function resolveQuantityPacks(item) {
  return firstNumeric(item?.orderdata_item_quantity, item?.quantityPacks, item?.quantity, item?.quantity_packs);
}

function resolvePieces(item, packSize) {
  const explicit = firstNumeric(item?.totalPieces, item?.total_pieces);
  if (explicit > 0) return explicit;

  const quantity = resolveQuantityPacks(item);
  return quantity > 0 ? quantity * Math.max(1, packSize) : 0;
}

function resolveAmounts(item, pieces) {
  const unitPrice = firstNumeric(item?.unitPrice, item?.unit_price, item?.orderdata_price);
  const storedGross = firstNumeric(
    item?.listPriceTotal,
    item?.list_price_total,
    item?.grossAmount,
    item?.gross_amount,
    item?.order_amount,
    item?.total
  );
  const storedDiscount = firstNumeric(
    item?.discountAmount,
    item?.discount_amount,
    item?.orderdata_discount,
    item?.order_discount_amount
  );
  const storedNet = firstNumeric(
    item?.finalPrice,
    item?.final_price,
    item?.orderdata_afterDisPrice,
    item?.orderdata_totalprice,
    item?.netAmount,
    item?.net_amount,
    item?.order_net_amount
  );

  const gross = storedGross > 0
    ? storedGross
    : unitPrice > 0 && pieces > 0
      ? unitPrice * pieces
      : Math.max(0, storedNet + storedDiscount);

  const netSales = storedNet > 0 ? storedNet : Math.max(0, gross - storedDiscount);
  const discount = storedDiscount > 0 ? storedDiscount : Math.max(0, gross - netSales);

  return {
    gross: roundMoney(gross),
    discount: roundMoney(discount),
    netSales: roundMoney(netSales),
  };
}

function uniqueOrderHeaders(orders) {
  const byOrder = new Map();

  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || typeof order !== "object") continue;
    const orderId = firstNonEmpty(order.order_id, order.orderId);
    if (!orderId) continue;

    const existing = byOrder.get(orderId);
    if (!existing) {
      byOrder.set(orderId, { ...order });
      continue;
    }

    for (const [field, value] of Object.entries(order)) {
      if (!safeText(existing[field]) && safeText(value)) existing[field] = value;
    }
  }

  return Array.from(byOrder.values());
}

function buildFallbackProductKey(category, productName, specification) {
  const pieces = [
    normalizeCatalogueNumber(category),
    normalizeCatalogueNumber(productName),
    normalizeCatalogueNumber(specification),
  ].filter(Boolean);

  return `fallback:${pieces.join("::") || "unknown"}`;
}

function buildLineFallbackKey(orderId, productKey, occurrence) {
  return [safeText(orderId), productKey, String(Math.max(1, occurrence || 1))].join("::");
}

function sortProducts(products) {
  return [...products].sort((left, right) => {
    if (right.purchasedQuantity !== left.purchasedQuantity) {
      return right.purchasedQuantity - left.purchasedQuantity;
    }
    return left.productName.localeCompare(right.productName, undefined, { sensitivity: "base" });
  });
}

function sortOrderContributions(orders) {
  return [...orders].sort((left, right) => {
    const leftDate = parseDateMs(left.orderDate) || 0;
    const rightDate = parseDateMs(right.orderDate) || 0;
    if (rightDate !== leftDate) return rightDate - leftDate;
    return right.purchasedQuantity - left.purchasedQuantity;
  });
}

function buildDealerPurchaseLines(input) {
  const lookup = buildCatalogueLookup(input?.catalogueProducts || []);
  const statusFilter = safeText(input?.statusFilter || "all").toLowerCase() || "all";
  const filteredOrders = uniqueOrderHeaders(input?.orders || []).filter((order) => {
    if (!matchesStatusFilter(order, statusFilter)) return false;
    return withinDateRange(order.order_date || order.orderDate, input?.fromDate, input?.toDate);
  });

  const lines = [];

  for (const order of filteredOrders) {
    const orderId = firstNonEmpty(order.order_id, order.orderId);
    if (!orderId) continue;

    const items = Array.isArray(input?.orderItemsByOrderId?.[orderId])
      ? input.orderItemsByOrderId[orderId]
      : [];

    const seenLineKeys = new Set();
    const occurrenceByProductKey = new Map();
    const orderDate = firstNonEmpty(order.order_date, order.orderDate);
    const orderDateMs = parseDateMs(orderDate);
    const dealerId = firstNonEmpty(order.order_dealer, order.orderdata_dealerid, order.Dealer_Id);
    const dealerName = firstNonEmpty(order.Dealer_Name, input?.dealer?.Dealer_Name, dealerId);

    for (const item of items) {
      const catalogueNumber = resolveCatalogueNumber(item);
      const lookupEntry = resolveCatalogueEntry(lookup, catalogueNumber);
      const category = resolveItemCategory(item, lookup, lookupEntry);
      const productName = resolveProductName(item, lookupEntry);
      const specification = resolveSpecification(item, lookupEntry);
      const normalizedCatalogueNumber = normalizeCatalogueNumber(catalogueNumber);
      const productKey = normalizedCatalogueNumber
        ? `sku:${normalizedCatalogueNumber}`
        : buildFallbackProductKey(category, productName, specification);
      const occurrence = (occurrenceByProductKey.get(productKey) || 0) + 1;
      occurrenceByProductKey.set(productKey, occurrence);

      const lineKey = firstNonEmpty(item?.orderdata_id, item?.orderItemId)
        ? `${orderId}::item:${firstNonEmpty(item?.orderdata_id, item?.orderItemId)}`
        : buildLineFallbackKey(orderId, productKey, occurrence);

      if (seenLineKeys.has(lineKey)) continue;
      seenLineKeys.add(lineKey);

      const quantity = resolveQuantityPacks(item);
      const packSize = resolvePackSize(item, lookupEntry);
      const pieces = resolvePieces(item, packSize);
      const amounts = resolveAmounts(item, pieces);

      if (quantity <= 0 && pieces <= 0 && amounts.gross <= 0 && !catalogueNumber && !productName) {
        continue;
      }

      lines.push({
        lineKey,
        orderId,
        orderDate,
        orderDateMs,
        dealerId,
        dealerName,
        orderStatus: firstNonEmpty(order.order_status, order.status),
        mtstatus: firstNonEmpty(order.mtstatus),
        acceptOrder: firstNonEmpty(order.accept_order),
        orderState: classifyOrder(order),
        category,
        productKey,
        catalogueNumber,
        normalizedCatalogueNumber,
        productName,
        specification,
        quantity,
        packSize,
        purchasedQuantity: pieces,
        productUnit: "pieces",
        gross: amounts.gross,
        discount: amounts.discount,
        netSales: amounts.netSales,
      });
    }
  }

  return {
    filteredOrders,
    lines,
  };
}

function buildDealerCategoryReport(input) {
  const { filteredOrders, lines } = buildDealerPurchaseLines(input);
  const categories = new Map();
  const totalPurchasedQuantity = lines.reduce((sum, line) => sum + line.purchasedQuantity, 0);
  const totalSalesValue = roundMoney(lines.reduce((sum, line) => sum + line.netSales, 0));
  const variantKeys = new Set();
  let latestPurchaseDateMs = null;

  for (const line of lines) {
    variantKeys.add(line.productKey);
    if (line.orderDateMs !== null && (latestPurchaseDateMs === null || line.orderDateMs > latestPurchaseDateMs)) {
      latestPurchaseDateMs = line.orderDateMs;
    }

    let categoryEntry = categories.get(line.category);
    if (!categoryEntry) {
      categoryEntry = {
        category: line.category || UNCATEGORIZED,
        purchasedQuantity: 0,
        totalValue: 0,
        latestPurchaseDateMs: null,
        orderIds: new Set(),
        productKeys: new Set(),
        products: new Map(),
      };
      categories.set(line.category, categoryEntry);
    }

    categoryEntry.purchasedQuantity += line.purchasedQuantity;
    categoryEntry.totalValue = roundMoney(categoryEntry.totalValue + line.netSales);
    categoryEntry.orderIds.add(line.orderId);
    categoryEntry.productKeys.add(line.productKey);
    if (line.orderDateMs !== null && (categoryEntry.latestPurchaseDateMs === null || line.orderDateMs > categoryEntry.latestPurchaseDateMs)) {
      categoryEntry.latestPurchaseDateMs = line.orderDateMs;
    }

    let productEntry = categoryEntry.products.get(line.productKey);
    if (!productEntry) {
      productEntry = {
        productKey: line.productKey,
        productName: line.productName,
        catalogueNumber: line.catalogueNumber,
        specification: line.specification,
        purchasedQuantity: 0,
        totalValue: 0,
        latestPurchaseDateMs: null,
        orderIds: new Set(),
        orders: new Map(),
      };
      categoryEntry.products.set(line.productKey, productEntry);
    }

    productEntry.purchasedQuantity += line.purchasedQuantity;
    productEntry.totalValue = roundMoney(productEntry.totalValue + line.netSales);
    productEntry.orderIds.add(line.orderId);
    if (line.orderDateMs !== null && (productEntry.latestPurchaseDateMs === null || line.orderDateMs > productEntry.latestPurchaseDateMs)) {
      productEntry.latestPurchaseDateMs = line.orderDateMs;
    }

    const orderKey = line.orderId;
    const productOrderEntry = productEntry.orders.get(orderKey) || {
      orderId: line.orderId,
      orderDate: line.orderDate,
      dealerId: line.dealerId,
      dealerName: line.dealerName,
      purchasedQuantity: 0,
      totalValue: 0,
      statusLabel: line.orderState === "SentAndSettled"
        ? "Completed"
        : line.orderState === "SupposedToGo"
          ? "Accepted"
          : "Awaiting",
    };

    productOrderEntry.purchasedQuantity += line.purchasedQuantity;
    productOrderEntry.totalValue = roundMoney(productOrderEntry.totalValue + line.netSales);
    productEntry.orders.set(orderKey, productOrderEntry);
  }

  const categoryRows = Array.from(categories.values()).map((categoryEntry) => {
    const products = sortProducts(
      Array.from(categoryEntry.products.values()).map((productEntry) => ({
        productKey: productEntry.productKey,
        productName: productEntry.productName,
        catalogueNumber: productEntry.catalogueNumber,
        specification: productEntry.specification,
        purchasedQuantity: productEntry.purchasedQuantity,
        orderCount: productEntry.orderIds.size,
        totalValue: productEntry.totalValue,
        latestPurchaseDate: productEntry.latestPurchaseDateMs === null
          ? ""
          : new Date(productEntry.latestPurchaseDateMs).toISOString(),
        orders: sortOrderContributions(Array.from(productEntry.orders.values())),
      }))
    );

    return {
      category: categoryEntry.category,
      purchasedQuantity: categoryEntry.purchasedQuantity,
      orderCount: categoryEntry.orderIds.size,
      variantCount: categoryEntry.productKeys.size,
      shareOfPurchases: totalPurchasedQuantity > 0
        ? roundMoney((categoryEntry.purchasedQuantity / totalPurchasedQuantity) * 100)
        : 0,
      latestPurchaseDate: categoryEntry.latestPurchaseDateMs === null
        ? ""
        : new Date(categoryEntry.latestPurchaseDateMs).toISOString(),
      totalValue: categoryEntry.totalValue,
      products,
    };
  }).sort((left, right) => {
    if (right.purchasedQuantity !== left.purchasedQuantity) {
      return right.purchasedQuantity - left.purchasedQuantity;
    }
    return left.category.localeCompare(right.category, undefined, { sensitivity: "base" });
  });

  const warnings = (input?.failedOrderIds || []).length > 0
    ? [{
        code: "partial_order_detail_failure",
        message: "Some order details could not be loaded. Totals may be incomplete.",
        orderIds: [...input.failedOrderIds],
      }]
    : [];

  return {
    dealer: input?.dealer
      ? {
          Dealer_Id: firstNonEmpty(input.dealer.Dealer_Id),
          Dealer_Name: firstNonEmpty(input.dealer.Dealer_Name),
          Dealer_City: firstNonEmpty(input.dealer.Dealer_City),
          Dealer_Dealercode: firstNonEmpty(input.dealer.Dealer_Dealercode),
          Dealer_Number: firstNonEmpty(input.dealer.Dealer_Number),
          assignedstaff: firstNonEmpty(input.dealer.assignedstaff),
          staffname: firstNonEmpty(input.dealer.staffname),
        }
      : null,
    summary: {
      totalOrders: filteredOrders.length,
      totalPurchasedQuantity,
      totalCategories: categoryRows.length,
      totalVariants: variantKeys.size,
      totalSalesValue,
      latestPurchaseDate: latestPurchaseDateMs === null ? "" : new Date(latestPurchaseDateMs).toISOString(),
      dateRange: {
        from: firstNonEmpty(input?.fromDate),
        to: firstNonEmpty(input?.toDate),
      },
      statusFilter: safeText(input?.statusFilter || "all").toLowerCase() || "all",
    },
    categories: categoryRows,
    warnings,
    meta: {
      lineCount: lines.length,
      failedOrderCount: (input?.failedOrderIds || []).length,
      failedOrderIds: [...(input?.failedOrderIds || [])],
    },
  };
}

function summarizeLegacyRows(rows) {
  return rows.reduce((acc, row) => ({
    quantity: acc.quantity + row.quantity,
    pieces: acc.pieces + row.pieces,
    gross: roundMoney(acc.gross + row.gross),
    discount: roundMoney(acc.discount + row.discount),
    netSales: roundMoney(acc.netSales + row.netSales),
  }), {
    quantity: 0,
    pieces: 0,
    gross: 0,
    discount: 0,
    netSales: 0,
  });
}

function aggregateDealerCategorySales(items, catalogueProducts = []) {
  const lookup = buildCatalogueLookup(catalogueProducts);
  const rowsByCategory = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || hasCancelledFlag(item)) continue;

    const entry = resolveCatalogueEntry(lookup, resolveCatalogueNumber(item));
    const category = resolveItemCategory(item, lookup, entry);
    const packSize = resolvePackSize(item, entry);
    const quantity = resolveQuantityPacks(item);
    const pieces = resolvePieces(item, packSize);
    const amounts = resolveAmounts(item, pieces);

    const current = rowsByCategory.get(category);
    if (current) {
      current.quantity += quantity;
      current.pieces += pieces;
      current.gross = roundMoney(current.gross + amounts.gross);
      current.discount = roundMoney(current.discount + amounts.discount);
      current.netSales = roundMoney(current.netSales + amounts.netSales);
    } else {
      rowsByCategory.set(category, {
        category,
        quantity,
        pieces,
        gross: amounts.gross,
        discount: amounts.discount,
        netSales: amounts.netSales,
      });
    }
  }

  const rows = Array.from(rowsByCategory.values()).sort((left, right) => left.category.localeCompare(right.category));
  return {
    rows,
    grandTotal: summarizeLegacyRows(rows),
  };
}

module.exports = {
  UNCATEGORIZED,
  classifyOrder,
  isEligibleOrder,
  matchesStatusFilter,
  buildCatalogueLookup,
  buildDealerPurchaseLines,
  buildDealerCategoryReport,
  aggregateDealerCategorySales,
  splitCsv,
  toIsoDate,
};
