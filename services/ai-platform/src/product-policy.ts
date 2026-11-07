import type { ProductAiPolicy } from "@luminaryworks/ai-client";

export function readProductPolicies(
  raw: string | undefined = process.env.AI_PRODUCT_POLICIES_JSON,
): { ok: true; policies: ProductAiPolicy[] } | { ok: false; message: string } {
  if (!raw?.trim()) return { ok: true, policies: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, message: "AI_PRODUCT_POLICIES_JSON must be an array" };
    }
    return { ok: true, policies: parsed as ProductAiPolicy[] };
  } catch {
    return { ok: false, message: "AI_PRODUCT_POLICIES_JSON is not valid JSON" };
  }
}

export function policyForProduct(
  policies: ProductAiPolicy[],
  productCode: string,
): ProductAiPolicy | undefined {
  return policies.find((policy) => policy.productCode === productCode);
}
