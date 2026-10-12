export type CatalogOfferingSnapshot = {
  sku: string;
  productCode: string;
  planCode: string;
  interval: string;
  currency: string;
  amountMinor: number;
  market: string;
  active: boolean;
};

export type CatalogScope = { kind: "all" } | { kind: "products"; productCodes: string[] };

export function catalogScopeFromScopes(input: { kind: string; scopes: string[] }): CatalogScope {
  if (input.kind === "service" || input.kind === "admin") return { kind: "all" };
  if (input.scopes.includes("entitlement:admin")) return { kind: "all" };
  const productCodes = input.scopes
    .filter((scope) => scope.startsWith("entitlement:catalog:"))
    .map((scope) => scope.slice("entitlement:catalog:".length))
    .filter((code) => /^[a-z0-9_-]+$/.test(code));
  return { kind: "products", productCodes };
}

export function offeringVisible(scope: CatalogScope, productCode: string): boolean {
  if (scope.kind === "all") return true;
  return scope.productCodes.includes(productCode);
}

function canonical(row: CatalogOfferingSnapshot): string {
  return [
    row.sku,
    row.productCode,
    row.planCode,
    row.interval,
    row.currency,
    String(row.amountMinor),
    row.market,
    row.active ? "1" : "0",
  ].join("|");
}

export function changedProductCodes(
  draft: CatalogOfferingSnapshot[],
  published: CatalogOfferingSnapshot[],
): string[] {
  const publishedBySku = new Map(published.map((row) => [row.sku, canonical(row)]));
  const draftSkus = new Set(draft.map((row) => row.sku));
  const changed = new Set<string>();
  for (const row of draft) {
    if (publishedBySku.get(row.sku) !== canonical(row)) changed.add(row.productCode);
  }
  for (const row of published) {
    if (!draftSkus.has(row.sku)) changed.add(row.productCode);
  }
  return [...changed];
}

export function publishScopeViolation(
  draft: CatalogOfferingSnapshot[],
  published: CatalogOfferingSnapshot[],
  scope: CatalogScope,
): "outside_product" | "cross_product_bundle" | null {
  if (scope.kind === "all") return null;
  const changed = changedProductCodes(draft, published);
  if (changed.some((code) => !scope.productCodes.includes(code))) return "outside_product";
  if (changed.length > 1) return "cross_product_bundle";
  return null;
}
