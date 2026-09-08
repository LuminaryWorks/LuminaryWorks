import { PRODUCT_CODES } from "./constants";

export const DEFAULT_LEGAL_POLICY_VERSION = "lw-legal-v2026-09-07";

export const LEGAL_DOCUMENT_KEYS = ["terms", "privacy", "trial-deletion"] as const;
export type LegalDocumentKey = (typeof LEGAL_DOCUMENT_KEYS)[number];

export const LEGAL_POLICY_KINDS = LEGAL_DOCUMENT_KEYS;
export type LegalPolicyKind = LegalDocumentKey;

export interface LegalDocumentManifest {
  key: LegalDocumentKey;
  version: string;
  urls: { en: string; zh: string };
}

export interface TrialPurgeTarget {
  url: string;
  secret: string;
}

export type TrialPurgeTargetMap = Record<string, TrialPurgeTarget>;

const PRODUCT_CODE_SET = new Set<string>(PRODUCT_CODES);

export function isLegalDocumentKey(value: string): value is LegalDocumentKey {
  return (LEGAL_DOCUMENT_KEYS as readonly string[]).includes(value);
}

export function normalizeLegalBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function legalDocumentsForVersion(
  policyVersion: string,
  publicBaseUrl: string,
): LegalDocumentManifest[] {
  const base = normalizeLegalBaseUrl(publicBaseUrl);
  return [
    {
      key: "terms",
      version: policyVersion,
      urls: { en: `${base}/en/terms.md`, zh: `${base}/zh/terms.md` },
    },
    {
      key: "privacy",
      version: policyVersion,
      urls: { en: `${base}/en/privacy.md`, zh: `${base}/zh/privacy.md` },
    },
    {
      key: "trial-deletion",
      version: policyVersion,
      urls: {
        en: `${base}/en/trial-data-deletion.md`,
        zh: `${base}/zh/trial-data-deletion.md`,
      },
    },
  ];
}

export function isAllowedPurgeUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" || url.protocol === "http:";
}

/**
 * Strict JSON object: productCode → { url, secret }. Empty/unset → {}.
 * Rejects unknown value keys, empty secrets, and non-http(s) URLs.
 */
export function parseTrialPurgeTargets(raw: string | undefined): TrialPurgeTargetMap {
  if (raw == null || raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ENTITLEMENT_TRIAL_PURGE_TARGETS must be valid JSON");
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ENTITLEMENT_TRIAL_PURGE_TARGETS must be a JSON object keyed by productCode");
  }
  const out: TrialPurgeTargetMap = {};
  for (const [code, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!PRODUCT_CODE_SET.has(code) && !/^[a-z][a-z0-9_-]{1,62}$/.test(code)) {
      throw new Error(`Invalid productCode in ENTITLEMENT_TRIAL_PURGE_TARGETS: ${code}`);
    }
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `ENTITLEMENT_TRIAL_PURGE_TARGETS.${code} must be an object with url and secret`,
      );
    }
    const target = value as Record<string, unknown>;
    const extra = Object.keys(target).filter((key) => key !== "url" && key !== "secret");
    if (extra.length > 0) {
      throw new Error(
        `ENTITLEMENT_TRIAL_PURGE_TARGETS.${code} has unexpected keys: ${extra.join(", ")}`,
      );
    }
    if (typeof target.url !== "string" || typeof target.secret !== "string") {
      throw new Error(`ENTITLEMENT_TRIAL_PURGE_TARGETS.${code} requires string url and secret`);
    }
    if (!target.secret.trim()) {
      throw new Error(`ENTITLEMENT_TRIAL_PURGE_TARGETS.${code} secret must be non-empty`);
    }
    if (!isAllowedPurgeUrl(target.url)) {
      throw new Error(`ENTITLEMENT_TRIAL_PURGE_TARGETS.${code} url must be https or internal http`);
    }
    out[code] = { url: target.url, secret: target.secret };
  }
  return out;
}
