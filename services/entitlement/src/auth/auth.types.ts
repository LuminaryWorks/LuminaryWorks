export interface AuthPrincipal {
  /** Logto sub, partner client_id, or service identity */
  subjectId: string;
  kind: "user" | "service" | "admin" | "partner";
  scopes: string[];
  organizationId?: string | null;
  /** When service/admin acts on behalf of a user (X-Act-As-Subject). */
  actAsSubjectId?: string | null;
  /** Set for partner M2M tokens. */
  partnerId?: string | null;
  partnerCode?: string | null;
  rawToken?: string;
}

export const REQUEST_PRINCIPAL_KEY = "principal";
export const REQUEST_ID_KEY = "requestId";
export const REQUEST_RAW_BODY_KEY = "rawBody";
