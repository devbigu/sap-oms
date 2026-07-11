const MAX_KEYWORDS = 3;
const DEFAULT_SUGGESTION_LIMIT = 8;

function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return collapseWhitespace(String(value ?? "").replace(/<[^>]*>/g, " "));
}

function normalizeFreeText(value) {
  return collapseWhitespace(
    stripHtml(value)
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/&/g, " and ")
      .replace(/[_/\\|-]+/g, " ")
      .replace(/[^a-z0-9.+%'"()\s]+/g, " ")
  );
}

function normalizeCatalogueNumber(value) {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\s/_-]+/g, "");
}

function slugifyText(value) {
  return normalizeFreeText(value)
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitMeaningfulWords(value) {
  return collapseWhitespace(value).split(/\s+/).filter(Boolean);
}

function pickFirstString(...values) {
  for (const value of values) {
    const text = collapseWhitespace(value);
    if (text) return text;
  }
  return "";
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => collapseWhitespace(entry))
      .filter(Boolean);
  }

  const text = collapseWhitespace(value);
  return text ? [text] : [];
}

function flattenSpecificationValue(value) {
  if (value === null || value === undefined) return "";

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return collapseWhitespace(String(value));
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => flattenSpecificationValue(entry))
      .filter(Boolean)
      .join("; ");
  }

  if (typeof value === "object") {
    const lines = [];
    for (const [rawKey, rawValue] of Object.entries(value)) {
      const key = collapseWhitespace(rawKey);
      if (!key || rawValue === null || rawValue === undefined) continue;

      if (typeof rawValue === "object" && !Array.isArray(rawValue)) {
        continue;
      }

      const flattenedValue = flattenSpecificationValue(rawValue);
      if (!flattenedValue) continue;
      lines.push(`${key}: ${flattenedValue}`);
    }

    return lines.join("; ");
  }

  return "";
}

function collectCategoryNames(product) {
  const values = [
    pickFirstString(product?.categoryName, product?.category_name, product?.category),
    ...toStringArray(product?.categories),
  ];

  return Array.from(new Set(values.filter(Boolean)));
}

function collectCategorySlugs(categoryNames) {
  const slugs = [];

  for (const categoryName of categoryNames) {
    const parts = String(categoryName)
      .split(">")
      .map((part) => collapseWhitespace(part))
      .filter(Boolean);

    for (const part of parts) {
      const slug = slugifyText(part);
      if (slug) slugs.push(slug);
    }
  }

  return Array.from(new Set(slugs));
}

function pickCategoryName(categoryNames) {
  for (const categoryName of categoryNames) {
    const parts = String(categoryName)
      .split(">")
      .map((part) => collapseWhitespace(part))
      .filter(Boolean);

    if (parts.length > 0) return parts[parts.length - 1];
  }

  return "";
}

function collectProductSpecifications(product) {
  return flattenSpecificationValue(
    product?.specifications ??
      product?.specification ??
      product?.specs ??
      product?.Specs ??
      product?.specsText ??
      product?.SpecsText
  );
}

function pickProductCatalogueNumber(product) {
  return pickFirstString(
    product?.catalogueNumber,
    product?.catalogueNo,
    product?.catalogue_no,
    product?.product_cat,
    product?.sku,
    product?.id
  );
}

function pickVariantCatalogueNumber(variant) {
  return pickFirstString(
    variant?.catalogueNumber,
    variant?.catalogueNo,
    variant?.catalogue_no,
    variant?.product_cat,
    variant?.sku,
    variant?.id
  );
}

function pickProductName(product) {
  return pickFirstString(product?.productName, product?.product_name, product?.name);
}

function pickVariantName(productName, variant) {
  return pickFirstString(variant?.productName, variant?.product_name, variant?.name, productName);
}

function pickDescription(product) {
  return pickFirstString(
    stripHtml(product?.description),
    stripHtml(product?.product_discription),
    stripHtml(product?.descriptionHtml)
  );
}

function pickProductImage(product, matchedVariant) {
  const images = [
    ...toStringArray(matchedVariant?.image),
    ...toStringArray(matchedVariant?.imagePath),
    ...toStringArray(matchedVariant?.images),
    ...toStringArray(product?.image),
    ...toStringArray(product?.imagePath),
    ...toStringArray(product?.images),
  ];

  return images.find(Boolean) || "";
}

function buildRoute(catalogueNumber) {
  const safeCatalogueNumber = collapseWhitespace(catalogueNumber);
  if (!safeCatalogueNumber) return "/Products";
  return `/Products/${encodeURIComponent(safeCatalogueNumber)}`;
}

function normalizeVariantForSearch(product, variant, sharedFields) {
  const catalogueNumber = pickVariantCatalogueNumber(variant);
  const variantName = pickVariantName(sharedFields.productName, variant);
  const variantSpecsText = flattenSpecificationValue(variant?.specs) || flattenSpecificationValue(variant?.specifications) || flattenSpecificationValue(variant?.specification) || flattenSpecificationValue(variant?.specsText) || flattenSpecificationValue(variant?.SpecsText);
  const variantDescription = pickFirstString(stripHtml(variant?.description), stripHtml(variant?.descriptionHtml));

  return {
    id: pickFirstString(variant?.id, catalogueNumber, sharedFields.id),
    catalogueNumber,
    normalizedCatalogueNumber: normalizeCatalogueNumber(catalogueNumber),
    variantName,
    route: buildRoute(catalogueNumber || sharedFields.catalogueNumber),
    image: pickProductImage(sharedFields.originalProduct, variant),
    originalVariant: variant,
    nameText: normalizeFreeText(`${sharedFields.productName} ${variantName}`),
    descriptionText: normalizeFreeText(`${sharedFields.description} ${variantDescription}`),
    specificationsText: normalizeFreeText(
      [
        sharedFields.productSpecificationsText,
        variantSpecsText,
        ...sharedFields.features,
      ]
        .filter(Boolean)
        .join(" ")
    ),
    categoryText: sharedFields.categoryText,
    categorySlugText: sharedFields.categorySlugText,
  };
}

function normalizeProductForSearch(product) {
  const productName = pickProductName(product);
  const catalogueNumber = pickProductCatalogueNumber(product);
  const categoryNames = collectCategoryNames(product);
  const categorySlugs = collectCategorySlugs(categoryNames);
  const features = toStringArray(product?.features).map(stripHtml).filter(Boolean);
  const description = pickDescription(product);
  const productSpecificationsText = collectProductSpecifications(product);
  const id = pickFirstString(product?.id, catalogueNumber, productName);
  const categoryName = pickCategoryName(categoryNames);
  const baseCategoryText = normalizeFreeText(categoryNames.join(" "));
  const baseCategorySlugText = categorySlugs.join(" ");

  const sharedFields = {
    id,
    productName,
    catalogueNumber,
    description,
    productSpecificationsText,
    features,
    categoryText: baseCategoryText,
    categorySlugText: baseCategorySlugText,
    originalProduct: product,
  };

  const variants = Array.isArray(product?.variants)
    ? product.variants
        .filter((variant) => variant && typeof variant === "object")
        .map((variant) => normalizeVariantForSearch(product, variant, sharedFields))
    : [];

  const image = pickProductImage(product, variants[0]?.originalVariant);

  return {
    id,
    productName,
    catalogueNumber,
    normalizedCatalogueNumber: normalizeCatalogueNumber(catalogueNumber),
    description,
    specificationsText: productSpecificationsText,
    categoryName,
    categorySlug: categorySlugs[0] || slugifyText(categoryName),
    categoryNames,
    categorySlugs,
    image,
    route: buildRoute(catalogueNumber),
    originalProduct: product,
    features,
    productNameText: normalizeFreeText(productName),
    descriptionText: normalizeFreeText(description),
    specificationsSearchText: normalizeFreeText([productSpecificationsText, ...features].join(" ")),
    categoryText: baseCategoryText,
    categorySlugText: baseCategorySlugText,
    variants,
  };
}

function getSearchQueryInfo(value) {
  const meaningfulWords = splitMeaningfulWords(value);
  const limitedWords = meaningfulWords.slice(0, MAX_KEYWORDS);
  const normalizedQuery = limitedWords.join(" ");

  return {
    rawQuery: String(value ?? ""),
    normalizedQuery,
    keywords: limitedWords,
    keywordCount: meaningfulWords.length,
    hasOverflowKeywords: meaningfulWords.length > MAX_KEYWORDS,
    meaningfulCharacterCount: normalizedQuery.replace(/\s+/g, "").length,
  };
}

function normalizeSearchQuery(value) {
  return getSearchQueryInfo(value).normalizedQuery;
}

function buildSearchUrl(value) {
  const normalizedQuery = normalizeSearchQuery(value);
  if (!normalizedQuery) return "/search";
  return `/search?q=${encodeURIComponent(normalizedQuery)}`;
}

function candidateMatchesKeyword(keyword, candidate) {
  const keywordText = normalizeFreeText(keyword);
  const keywordCatalogue = normalizeCatalogueNumber(keyword);
  if (!keywordText && !keywordCatalogue) return null;

  const originalCatalogue = collapseWhitespace(candidate.catalogueNumber).toLowerCase();

  if (keywordCatalogue && candidate.normalizedCatalogueNumber && candidate.normalizedCatalogueNumber.includes(keywordCatalogue)) {
    return { field: "catalogue" };
  }

  if (keywordText && originalCatalogue.includes(keywordText)) {
    return { field: "catalogue" };
  }

  if (keywordText && candidate.nameText.includes(keywordText)) {
    return { field: "name" };
  }

  if (keywordText && candidate.specificationsText.includes(keywordText)) {
    return { field: "specifications" };
  }

  if (keywordText && candidate.descriptionText.includes(keywordText)) {
    return { field: "description" };
  }

  if (
    (keywordText && candidate.categoryText.includes(keywordText)) ||
    (keywordText && candidate.categorySlugText.includes(slugifyText(keywordText)))
  ) {
    return { field: "category" };
  }

  return null;
}

function buildCandidate(product, variant) {
  if (!variant) {
    return {
      id: product.id,
      catalogueNumber: product.catalogueNumber,
      normalizedCatalogueNumber: product.normalizedCatalogueNumber,
      route: product.route,
      image: product.image,
      originalVariant: null,
      nameText: product.productNameText,
      descriptionText: product.descriptionText,
      specificationsText: product.specificationsSearchText,
      categoryText: product.categoryText,
      categorySlugText: product.categorySlugText,
    };
  }

  return variant;
}

function scoreCandidate(product, candidate, queryInfo, allowPartial) {
  const rawQuery = collapseWhitespace(queryInfo.normalizedQuery).toLowerCase();
  const normalizedQuery = normalizeFreeText(queryInfo.normalizedQuery);
  const queryCatalogue = normalizeCatalogueNumber(queryInfo.normalizedQuery);
  const originalCatalogue = collapseWhitespace(candidate.catalogueNumber).toLowerCase();

  const keywordMatches = queryInfo.keywords
    .map((keyword) => candidateMatchesKeyword(keyword, candidate))
    .filter(Boolean);

  const matchedKeywordCount = keywordMatches.length;
  const allKeywordsMatch = matchedKeywordCount === queryInfo.keywords.length;

  if (!allKeywordsMatch && !allowPartial) return null;
  if (matchedKeywordCount === 0) return null;

  const fields = new Set(keywordMatches.map((match) => match.field));
  let score = 0;
  let matchType = "partial";

  if (rawQuery && originalCatalogue === rawQuery) {
    score = 1300;
    matchType = "catalogue-exact";
  } else if (queryCatalogue && candidate.normalizedCatalogueNumber === queryCatalogue) {
    score = 1250;
    matchType = "catalogue-normalized-exact";
  } else if (
    (rawQuery && originalCatalogue.startsWith(rawQuery)) ||
    (queryCatalogue && candidate.normalizedCatalogueNumber.startsWith(queryCatalogue))
  ) {
    score = 1180;
    matchType = "catalogue-prefix";
  } else if (normalizedQuery && candidate.nameText === normalizedQuery) {
    score = 1100;
    matchType = "name-exact";
  } else if (normalizedQuery && candidate.nameText.startsWith(normalizedQuery)) {
    score = 1040;
    matchType = "name-prefix";
  } else if (allKeywordsMatch) {
    if (fields.size === 1 && fields.has("name")) {
      score = 980;
      matchType = "name-keywords";
    } else if (fields.has("name") && (fields.has("specifications") || fields.has("catalogue"))) {
      score = 930;
      matchType = "distributed-keywords";
    } else if (fields.has("specifications")) {
      score = 900;
      matchType = "specifications";
    } else if (fields.has("description")) {
      score = 860;
      matchType = "description";
    } else if (fields.has("category")) {
      score = 820;
      matchType = "category";
    } else {
      score = 840;
      matchType = "keywords";
    }
  } else {
    const matchRatio = matchedKeywordCount / queryInfo.keywords.length;

    if (fields.has("catalogue")) {
      score = 720 + Math.round(matchRatio * 40);
      matchType = "catalogue-partial";
    } else if (fields.has("name")) {
      score = 660 + Math.round(matchRatio * 40);
      matchType = "name-partial";
    } else if (fields.has("specifications")) {
      score = 560 + Math.round(matchRatio * 30);
      matchType = "specifications-partial";
    } else if (fields.has("description")) {
      score = 460 + Math.round(matchRatio * 20);
      matchType = "description-partial";
    } else if (fields.has("category")) {
      score = 420 + Math.round(matchRatio * 15);
      matchType = "category-partial";
    }
  }

  if (normalizedQuery && candidate.nameText.includes(normalizedQuery)) {
    score += 12;
  }

  if (normalizedQuery && candidate.specificationsText.includes(normalizedQuery)) {
    score += 8;
  }

  if (normalizedQuery && candidate.descriptionText.includes(normalizedQuery)) {
    score += 4;
  }

  score += matchedKeywordCount * 5;

  return {
    score,
    matchType,
    allKeywordsMatch,
    matchedKeywordCount,
    candidate,
    product,
  };
}

function scoreProductMatch(normalizedProduct, query, options) {
  const queryInfo = typeof query === "string" ? getSearchQueryInfo(query) : query;
  if (!queryInfo?.normalizedQuery || queryInfo.keywords.length === 0) return null;

  const allowPartial = Boolean(options?.allowPartial);
  const candidates = [
    buildCandidate(normalizedProduct, null),
    ...normalizedProduct.variants.map((variant) => buildCandidate(normalizedProduct, variant)),
  ];

  let bestMatch = null;

  for (const candidate of candidates) {
    const currentMatch = scoreCandidate(normalizedProduct, candidate, queryInfo, allowPartial);
    if (!currentMatch) continue;

    if (!bestMatch || currentMatch.score > bestMatch.score) {
      bestMatch = currentMatch;
    }
  }

  if (!bestMatch) return null;

  return bestMatch;
}

function buildResult(match, index) {
  const candidate = match.candidate;
  const product = match.product;
  const previewText = pickFirstString(
    collapseWhitespace(candidate.specificationsText),
    collapseWhitespace(product.description),
    collapseWhitespace(product.categoryName)
  );

  return {
    id: product.id,
    score: match.score,
    matchType: match.matchType,
    allKeywordsMatch: match.allKeywordsMatch,
    matchedKeywordCount: match.matchedKeywordCount,
    index,
    productName: product.productName,
    catalogueNumber: candidate.catalogueNumber || product.catalogueNumber,
    normalizedCatalogueNumber: candidate.normalizedCatalogueNumber || product.normalizedCatalogueNumber,
    description: product.description,
    specificationsText: collapseWhitespace(candidate.specificationsText) || collapseWhitespace(product.specificationsText),
    categoryName: product.categoryName,
    categorySlug: product.categorySlug,
    image: candidate.image || product.image,
    route: candidate.route || product.route,
    originalProduct: product.originalProduct,
    matchedVariant: candidate.originalVariant || null,
    previewText,
  };
}

function compareResults(a, b) {
  if (b.score !== a.score) return b.score - a.score;

  const productNameCompare = String(a.productName).localeCompare(String(b.productName), undefined, {
    sensitivity: "base",
  });
  if (productNameCompare !== 0) return productNameCompare;

  const catalogueCompare = String(a.catalogueNumber).localeCompare(String(b.catalogueNumber), undefined, {
    sensitivity: "base",
  });
  if (catalogueCompare !== 0) return catalogueCompare;

  return a.index - b.index;
}

function dedupeResults(results) {
  const seen = new Set();

  return results.filter((result) => {
    const key = `${result.route}::${result.catalogueNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function prepareProducts(products) {
  return (Array.isArray(products) ? products : []).map((product) => {
    if (product && product.originalProduct) return product;
    return normalizeProductForSearch(product);
  });
}

function searchProducts(products, query) {
  const queryInfo = getSearchQueryInfo(query);
  if (!queryInfo.normalizedQuery) return [];

  const matches = prepareProducts(products)
    .map((product, index) => {
      const match = scoreProductMatch(product, queryInfo, { allowPartial: false });
      return match ? buildResult(match, index) : null;
    })
    .filter(Boolean);

  return dedupeResults(matches.sort(compareResults));
}

function getProductSuggestions(products, query, options) {
  const queryInfo = getSearchQueryInfo(query);
  if (!queryInfo.normalizedQuery) return [];

  const limit = Number(options?.limit) > 0 ? Number(options.limit) : DEFAULT_SUGGESTION_LIMIT;

  const matches = prepareProducts(products)
    .map((product, index) => {
      const match = scoreProductMatch(product, queryInfo, { allowPartial: true });
      return match ? buildResult(match, index) : null;
    })
    .filter(Boolean);

  return dedupeResults(matches.sort(compareResults)).slice(0, limit);
}

module.exports = {
  MAX_KEYWORDS,
  DEFAULT_SUGGESTION_LIMIT,
  normalizeSearchQuery,
  getSearchQueryInfo,
  normalizeProductForSearch,
  scoreProductMatch,
  searchProducts,
  getProductSuggestions,
  buildSearchUrl,
  normalizeCatalogueNumber,
  flattenSpecificationValue,
};
