const DEFAULT_PHP_BASE = "https://mirisoft.co.in/sas/dealerapi";

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

function stripApiSuffix(value: string) {
  return value.replace(/\/api$/i, "");
}

function ensureApiSuffix(value: string) {
  return /\/api$/i.test(value) ? value : `${value}/api`;
}

export function getPhpBaseUrl() {
  return trimTrailingSlashes(
    stripApiSuffix(
      trimTrailingSlashes(
        process.env.PHP_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        DEFAULT_PHP_BASE
      )
    )
  );
}

export function getPhpApiBaseUrl() {
  return ensureApiSuffix(getPhpBaseUrl());
}
