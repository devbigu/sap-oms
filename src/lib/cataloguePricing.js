function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Catalogue variant prices are stored as rupees per pack. Order rows store
 * rupees per individual unit because quantity * packSize is sent to PHP.
 */
function variantPackPriceToUnitRupees(packPriceInput, packSizeInput) {
  const packPrice = positiveNumber(packPriceInput);
  const packSize = Math.max(1, positiveNumber(packSizeInput) || 1);
  if (!packPrice) return 0;
  return Math.round((packPrice / packSize + Number.EPSILON) * 100) / 100;
}

module.exports = { variantPackPriceToUnitRupees };
