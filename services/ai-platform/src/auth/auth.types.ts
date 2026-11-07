export const AI_PRINCIPAL = "aiPrincipal";

export type AiSurface = "product" | "public";

export interface AiPrincipal {
  subjectId: string;
  kind: "service" | "user";
  /** Product calls use service credentials. `public` is reserved for /v1/public API keys. */
  surface: AiSurface;
  organizationId: string | null;
  /** Product codes this service credential may assert. Absent on user JWTs. */
  productCodes?: readonly string[];
  /** Internal ledger endpoints (grant / revoke / rate card). Service credentials only. */
  internal?: boolean;
}

export type HeaderMap = Record<string, string | string[] | undefined>;

export type AuthedRequest = {
  url?: string;
  raw?: { url?: string };
  headers: HeaderMap;
  [AI_PRINCIPAL]?: AiPrincipal;
};
