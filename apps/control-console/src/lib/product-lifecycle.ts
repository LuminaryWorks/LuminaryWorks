/** Partner codes from contracts/partners.manifest.json. Admin calls use the operator token. */

export const PARTNER_PRODUCT_CODES = [
  "dataluminary",
  "blockyedu",
  "doerflow",
  "vistacast",
  "vistaremote",
  "syncrobrain",
] as const;

export const LIFECYCLE_REASON_MAX = 512;

export type ProductLifecycleStatus = "active" | "suspended" | "retired";

export type ProductAdminView = {
  productCode: string;
  name: string;
  active: boolean;
  sellable: boolean;
  status: string;
};

const STATUSES: readonly ProductLifecycleStatus[] = [
  "active",
  "suspended",
  "retired",
];

export function isProductLifecycleStatus(
  value: string,
): value is ProductLifecycleStatus {
  return (STATUSES as readonly string[]).includes(value);
}

export function discoverProductCodes(extra: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of [...PARTNER_PRODUCT_CODES, ...extra]) {
    const trimmed = code.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function productCodesFromPlans(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  const codes: string[] = [];
  for (const row of body) {
    if (!row || typeof row !== "object" || !("productCode" in row)) continue;
    const code = (row as { productCode?: unknown }).productCode;
    if (typeof code === "string" && code.trim()) codes.push(code.trim());
  }
  return codes;
}

export function buyerErrorCode(
  status: string,
): "PRODUCT_SUSPENDED" | "PRODUCT_RETIRED" | null {
  if (status === "suspended") return "PRODUCT_SUSPENDED";
  if (status === "retired") return "PRODUCT_RETIRED";
  return null;
}

export function lifecycleTone(
  status: string,
): "success" | "warning" | "error" | "default" {
  if (status === "active") return "success";
  if (status === "suspended") return "warning";
  if (status === "retired") return "error";
  return "default";
}

export function lifecycleStatusKey(status: string): string {
  if (status === "active") return "partners.statusActive";
  if (status === "suspended") return "partners.statusSuspended";
  if (status === "retired") return "partners.statusRetired";
  return "partners.statusUnknown";
}

export function lifecycleEffectKey(status: string): string | null {
  if (status === "active") return "partners.effectActive";
  if (status === "suspended") return "partners.effectSuspended";
  if (status === "retired") return "partners.effectRetired";
  return null;
}

/** Blank or overlong reasons are rejected. Force-revoke requires this text. */
export function normalizeLifecycleReason(value: string): string | null {
  const reason = value.trim();
  if (!reason || reason.length > LIFECYCLE_REASON_MAX) return null;
  return reason;
}
