const UNCATEGORIZED = "Uncategorized";

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  const amount = typeof value === "number"
    ? value
    : Number(String(value).replace(/,/g, "").trim());

  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function pickMoney(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const amount = toNumber(value);
    if (Number.isFinite(amount)) return amount;
  }
  return 0;
}

function buildCatalogueLookup(products) {
  const productsBySku = {};
  const variantsBySku = {};

  for (const product of Array.isArray(products) ? products : []) {
    if (!product || typeof product !== "object") continue;

    if (product.sku !== undefined && product.sku !== null) {
      productsBySku[String(product.sku).trim()] = product;
    }

    if (product.id !== undefined && product.id !== null) {
      productsBySku[String(product.id).trim()] = product;
    }

    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      if (!variant || typeof variant !== "object") continue;

      if (variant.sku !== undefined && variant.sku !== null) {
        variantsBySku[String(variant.sku).trim()] = { product, variant };
      }

      if (variant.id !== undefined && variant.id !== null) {
        variantsBySku[String(variant.id).trim()] = { product, variant };
      }
    }
  }

  return { productsBySku, variantsBySku };
}

function findCatalogueEntry(lookup, sku) {
  const raw = String(sku ?? "").trim();
  if (!raw || !lookup) return null;

  const variantMatch = lookup.variantsBySku?.[raw];
  if (variantMatch) {
    return {
      product: variantMatch.product,
      variant: variantMatch.variant,
    };
  }

  const product = lookup.productsBySku?.[raw];
  return product ? { product } : null;
}

function getCatalogueSection(product) {
  const fromCategory = product?.category?.trim();
  if (fromCategory) return fromCategory;

  const fromPath = product?.categories?.[0]?.split(">")?.pop()?.trim();
  if (fromPath) return fromPath;

  return UNCATEGORIZED;
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
    item?.sku,
  );
}

function isCancelledOrRejected(order) {
  if (String(order?.del_status ?? "").trim() === "1") return true;

  const haystack = [order?.order_status, order?.reason, order?.mtstatus]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");

  return /(cancel|cancelled|canceled|reject|rejected|declin)/i.test(haystack);
}

function resolveItemCategory(item, lookup) {
  const direct = firstNonEmpty(
    item?.category,
    item?.item_category,
    item?.product_category,
    item?.productCategory,
  );

  if (direct) return direct;

  const catNo = resolveCatalogueNumber(item);
  if (!catNo) return UNCATEGORIZED;

  const entry = findCatalogueEntry(lookup, catNo);
  if (!entry?.product) return UNCATEGORIZED;

  return getCatalogueSection(entry.product) || UNCATEGORIZED;
}

function resolvePackSize(item, lookup) {
  const direct = pickMoney(item?.packSize, item?.pack_size, item?.total_pack_size);
  if (direct > 0) return direct;

  const catNo = resolveCatalogueNumber(item);
  if (!catNo) return 1;

  const entry = findCatalogueEntry(lookup, catNo);
  return Number(entry?.variant?.pack ?? 1) || 1;
}

function resolvePieces(item, packSize) {
  const explicit = pickMoney(item?.totalPieces, item?.total_pieces);
  if (explicit > 0) return explicit;

  const qty = pickMoney(item?.orderdata_item_quantity, item?.quantityPacks, item?.quantity);
  return qty > 0 ? qty * Math.max(1, packSize) : 0;
}

function resolveAmounts(item, pieces) {
  const unitPrice = pickMoney(item?.unitPrice, item?.unit_price, item?.orderdata_price);
  const storedGross = pickMoney(
    item?.listPriceTotal,
    item?.list_price_total,
    item?.grossAmount,
    item?.gross_amount,
    item?.order_amount,
    item?.total,
  );
  const storedDiscount = pickMoney(
    item?.discountAmount,
    item?.discount_amount,
    item?.orderdata_discount,
    item?.order_discount_amount,
  );
  const storedNet = pickMoney(
    item?.finalPrice,
    item?.final_price,
    item?.orderdata_afterDisPrice,
    item?.orderdata_totalprice,
    item?.netAmount,
    item?.net_amount,
    item?.order_net_amount,
  );

  const gross = storedGross > 0
    ? storedGross
    : unitPrice > 0 && pieces > 0
      ? unitPrice * pieces
      : Math.max(0, storedNet + storedDiscount);

  const netSales = storedNet > 0 ? storedNet : Math.max(0, gross - storedDiscount);
  const discount = storedDiscount > 0 ? storedDiscount : Math.max(0, gross - netSales);

  return {
    gross: Math.round((gross + Number.EPSILON) * 100) / 100,
    discount: Math.round((discount + Number.EPSILON) * 100) / 100,
    netSales: Math.round((netSales + Number.EPSILON) * 100) / 100,
  };
}

function summarize(rows) {
  return rows.reduce((acc, row) => ({
    quantity: acc.quantity + row.quantity,
    pieces: acc.pieces + row.pieces,
    gross: acc.gross + row.gross,
    discount: acc.discount + row.discount,
    netSales: acc.netSales + row.netSales,
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
    if (!item || isCancelledOrRejected(item)) continue;

    const category = resolveItemCategory(item, lookup);
    const packSize = resolvePackSize(item, lookup);
    const quantity = pickMoney(item?.orderdata_item_quantity, item?.quantityPacks, item?.quantity);
    const pieces = resolvePieces(item, packSize);
    const amounts = resolveAmounts(item, pieces);

    const current = rowsByCategory.get(category);
    if (current) {
      current.quantity += quantity;
      current.pieces += pieces;
      current.gross += amounts.gross;
      current.discount += amounts.discount;
      current.netSales += amounts.netSales;
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

  const rows = Array.from(rowsByCategory.values()).sort((a, b) => a.category.localeCompare(b.category));
  return {
    rows,
    grandTotal: summarize(rows),
  };
}

module.exports = {
  aggregateDealerCategorySales,
};
