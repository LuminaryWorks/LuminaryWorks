import { isProviderId, type ProviderId } from "./payment-providers";

export function catalogScopeKey(tenantId: string | null | undefined): string {
  const id = tenantId?.trim();
  return id ? `tenant:${id}` : "platform";
}

export function normalizeCatalogOrder(providerIds: readonly string[]): ProviderId[] {
  const seen = new Set<string>();
  const out: ProviderId[] = [];
  for (const id of providerIds) {
    if (!isProviderId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function priorityForCatalogIndex(index: number): number {
  return (index + 1) * 10;
}
