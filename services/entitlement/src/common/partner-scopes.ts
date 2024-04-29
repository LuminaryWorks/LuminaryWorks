export const PARTNER_SCOPES = [
  "partner:redeem",
  "partner:revoke",
  "partner:reconcile",
  "partner:webhook",
] as const;

export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export const DEFAULT_PARTNER_SCOPES: PartnerScope[] = [
  "partner:redeem",
  "partner:revoke",
  "partner:reconcile",
];
