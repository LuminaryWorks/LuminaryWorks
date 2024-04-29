import { registerAs } from "@nestjs/config";
import { parsePublicKeyRing, type PublicKeyRing } from "../license/ed25519";

export interface EntitlementConfig {
  port: number;
  databaseUrl: string;
  authMode: "oidc" | "legacy" | "service";
  issuer?: string;
  audience?: string;
  jwksUri?: string;
  legacyJwtSecret?: string;
  serviceApiKey?: string;
  adminScopes: string[];
  cacheTtlSeconds: number;
  offlineGraceSeconds: number;
  nodeEnv: string;
  /** Opt-in TypeORM synchronize. Prefer migrations; never enable in production. */
  synchronize: boolean;
  migrationsRun: boolean;
  /** Pepper for hashing partner client secrets at rest. */
  partnerSecretPepper: string;
  /** JWT signing secret for partner M2M access tokens. */
  partnerTokenSecret: string;
  partnerTokenTtlSeconds: number;
  /** Inbound partner callback timestamp skew window (seconds). */
  partnerReplayWindowSeconds: number;
  /** Ed25519 public-key ring keyed by kid (public keys only). */
  licensePublicKeys: PublicKeyRing;
  /** Optional issuer private key path/PEM for admin issue API — never commit. */
  licensePrivateKey?: string;
  licenseDefaultKid?: string;
  outboxPollIntervalMs: number;
  outboxBatchSize: number;
  outboxMaxAttempts: number;
  /** Lease duration for claimed outbox rows (multi-instance SKIP LOCKED). */
  outboxLeaseSeconds: number;
  /** Stable worker identity stored on locked_by. */
  outboxWorkerId: string;
  /** Email via @luminaryworks/notification (optional). */
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
  mailFrom?: string;
  notificationEmailEnabled: boolean;
}

export default registerAs("entitlement", (): EntitlementConfig => {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const migrationsRun = process.env.ENTITLEMENT_MIGRATIONS_RUN === "true";
  const synchronizeExplicit = process.env.ENTITLEMENT_SYNCHRONIZE;
  const synchronize =
    synchronizeExplicit === "true"
      ? true
      : synchronizeExplicit === "false"
        ? false
        : nodeEnv === "development" && !migrationsRun;

  const legacyJwtSecret =
    process.env.ENTITLEMENT_LEGACY_JWT_SECRET ?? "dev-entitlement-secret-change-me";

  return {
    port: Number(process.env.ENTITLEMENT_PORT ?? 3040),
    databaseUrl:
      process.env.ENTITLEMENT_DATABASE_URL ??
      "postgres://entitlement:entitlement_dev@localhost:5434/entitlement",
    authMode: (process.env.ENTITLEMENT_AUTH_MODE as EntitlementConfig["authMode"]) ?? "legacy",
    issuer: process.env.ENTITLEMENT_OIDC_ISSUER ?? process.env.IDP_ISSUER,
    audience: process.env.ENTITLEMENT_OIDC_AUDIENCE ?? "https://entitlement.luminaryworks.dev",
    jwksUri: process.env.ENTITLEMENT_JWKS_URI,
    legacyJwtSecret,
    serviceApiKey: process.env.ENTITLEMENT_SERVICE_API_KEY,
    adminScopes: (process.env.ENTITLEMENT_ADMIN_SCOPES ?? "entitlement:admin")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cacheTtlSeconds: Number(process.env.ENTITLEMENT_CACHE_TTL_SECONDS ?? 60),
    offlineGraceSeconds: Number(process.env.ENTITLEMENT_OFFLINE_GRACE_SECONDS ?? 0),
    nodeEnv,
    synchronize,
    migrationsRun,
    partnerSecretPepper: process.env.ENTITLEMENT_PARTNER_SECRET_PEPPER ?? legacyJwtSecret,
    partnerTokenSecret: process.env.ENTITLEMENT_PARTNER_TOKEN_SECRET ?? legacyJwtSecret,
    partnerTokenTtlSeconds: Number(process.env.ENTITLEMENT_PARTNER_TOKEN_TTL_SECONDS ?? 3600),
    partnerReplayWindowSeconds: Number(
      process.env.ENTITLEMENT_PARTNER_REPLAY_WINDOW_SECONDS ?? 300,
    ),
    licensePublicKeys: parsePublicKeyRing(process.env.ENTITLEMENT_LICENSE_PUBLIC_KEYS),
    licensePrivateKey: process.env.ENTITLEMENT_LICENSE_PRIVATE_KEY,
    licenseDefaultKid: process.env.ENTITLEMENT_LICENSE_DEFAULT_KID,
    outboxPollIntervalMs: Number(process.env.ENTITLEMENT_OUTBOX_POLL_MS ?? 5000),
    outboxBatchSize: Number(process.env.ENTITLEMENT_OUTBOX_BATCH_SIZE ?? 20),
    outboxMaxAttempts: Number(process.env.ENTITLEMENT_OUTBOX_MAX_ATTEMPTS ?? 8),
    outboxLeaseSeconds: Number(process.env.ENTITLEMENT_OUTBOX_LEASE_SECONDS ?? 60),
    outboxWorkerId:
      process.env.ENTITLEMENT_OUTBOX_WORKER_ID?.trim() ||
      `${process.env.HOSTNAME || process.env.COMPUTERNAME || "worker"}:${process.pid}`,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    smtpSecure: process.env.SMTP_SECURE === "true",
    smtpRequireTls: process.env.SMTP_REQUIRE_TLS !== "false",
    mailFrom: process.env.MAIL_FROM_OFFICIAL ?? process.env.MAIL_FROM,
    notificationEmailEnabled: process.env.ENTITLEMENT_NOTIFY_EMAIL !== "false",
  };
});
