/**
 * Helpers for SSH / CI remote Compose deploy. No secrets are committed.
 *
 * Used by scripts/remote-deploy.mjs (laptop + GitHub Actions).
 */
import { randomBytes } from "node:crypto";
import { parseDotEnv } from "../init-scenario-env.mjs";
import { preflightObjectStorageEnv } from "./object-storage.mjs";

export const TARGETS = ["control-plane", "agent-commerce", "smart-site"];

export const CONTROL_PLANE_SECRET_KEYS = [
  "IDENTITY_DB_PASSWORD",
  "ENTITLEMENT_DB_PASSWORD",
  "ENTITLEMENT_SERVICE_API_KEY",
  "ENTITLEMENT_PARTNER_SECRET_PEPPER",
  "ENTITLEMENT_PARTNER_TOKEN_SECRET",
  // Compose interpolates profile-gated services too; empty ${VAR:?} fails parse.
  "AI_VAULT_MASTER_KEY",
];

const DEFAULT_PORTS = {
  identity: 3001,
  identityAdmin: 3002,
  authGateway: 3010,
  entitlement: 3040,
  controlConsole: 3050,
};

export function hexSecret(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

export function publicBaseUrl(host, protocol = "http") {
  const trimmed = String(host || "").replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `${protocol}://${trimmed}`;
}

/**
 * Fill a control-plane.env from the example. Never overwrites non-empty secrets
 * already present in `existingText`.
 */
export function renderControlPlaneEnv(exampleText, options = {}) {
  const existing = parseDotEnv(options.existingText || "");
  const base = publicBaseUrl(options.publicHost || "localhost", options.protocol || "http");
  const bindAddr = options.bindAddr || "0.0.0.0";
  const adminBindAddr = options.adminBindAddr || "127.0.0.1";
  const identityPort = options.identityPort || DEFAULT_PORTS.identity;
  const identityAdminPort = options.identityAdminPort || DEFAULT_PORTS.identityAdmin;
  const authGatewayPort = options.authGatewayPort || DEFAULT_PORTS.authGateway;
  const entitlementPort = options.entitlementPort || DEFAULT_PORTS.entitlement;
  const consolePort = options.controlConsolePort || DEFAULT_PORTS.controlConsole;
  const identityEndpoint = `${base}:${identityPort}`;
  const generate = options.generateSecret || hexSecret;

  const forced = {
    CONTROL_PLANE_BIND_ADDR: bindAddr,
    CONTROL_PLANE_ADMIN_BIND_ADDR: adminBindAddr,
    IDENTITY_ENDPOINT: identityEndpoint,
    IDENTITY_ADMIN_ENDPOINT: `http://127.0.0.1:${identityAdminPort}`,
    AUTH_GATEWAY_PUBLIC_URL: `${base}:${authGatewayPort}`,
    ENTITLEMENT_OIDC_ISSUER: `${identityEndpoint}/oidc`,
    ENTITLEMENT_GIT_SHA: options.gitSha || existing.ENTITLEMENT_GIT_SHA || "unknown",
    CONTROL_CONSOLE_PUBLIC_URL: `${base}:${consolePort}`,
    CONTROL_CONSOLE_IDP_ISSUER: `${identityEndpoint}/oidc`,
    CONTROL_CONSOLE_ENTITLEMENT_BASE_URL: `${base}:${entitlementPort}`,
    CONTROL_CONSOLE_AUTH_EXPERIENCE_URL: `${base}:${consolePort}`,
    ENTITLEMENT_CORS_ORIGINS: `${base}:${consolePort},http://127.0.0.1:${consolePort}`,
  };
  if (options.npmRegistry) forced.NPM_REGISTRY = options.npmRegistry;

  const secrets = { ...(options.secrets || {}) };
  for (const key of CONTROL_PLANE_SECRET_KEYS) {
    if (existing[key]) secrets[key] = existing[key];
    else if (!secrets[key]) secrets[key] = generate();
  }

  const lines = String(exampleText).split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx < 1) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    if (Object.hasOwn(forced, key)) {
      out.push(`${key}=${forced[key]}`);
      continue;
    }
    if (Object.hasOwn(secrets, key)) {
      out.push(`${key}=${secrets[key]}`);
      continue;
    }
    out.push(line);
  }
  return `${out.join("\n").replace(/\n*$/, "")}\n`;
}

export function objectStorageProfileRequested(env) {
  const enabled = String(env?.OBJECT_STORAGE_ENABLED || "").trim().toLowerCase();
  return enabled === "1" || enabled === "true" || enabled === "yes";
}

export function assertObjectStorageRemotePreflight(env) {
  if (!objectStorageProfileRequested(env)) return { ok: true, issues: [] };
  const result = preflightObjectStorageEnv(env);
  if (!result.ok) {
    const detail = result.issues.map((item) => `${item.target}: ${item.message}`).join("; ");
    throw new Error(
      `OBJECT_STORAGE_ENABLED is set but object-storage preflight failed (license, pinned AIStor image, root, and per-product secrets are required; AIStor is not in offline packs): ${detail}`,
    );
  }
  return result;
}

export function probeUrls(publicHost, options = {}) {
  const base = publicBaseUrl(publicHost, options.protocol || "http");
  const identityPort = options.identityPort || DEFAULT_PORTS.identity;
  const authGatewayPort = options.authGatewayPort || DEFAULT_PORTS.authGateway;
  const entitlementPort = options.entitlementPort || DEFAULT_PORTS.entitlement;
  const consolePort = options.controlConsolePort || DEFAULT_PORTS.controlConsole;
  return [
    {
      name: "identity-oidc-discovery",
      url: `${base}:${identityPort}/oidc/.well-known/openid-configuration`,
    },
    { name: "auth-gateway-health", url: `${base}:${authGatewayPort}/health` },
    { name: "auth-gateway-ready", url: `${base}:${authGatewayPort}/ready` },
    { name: "auth-gateway-version", url: `${base}:${authGatewayPort}/version` },
    { name: "entitlement-health", url: `${base}:${entitlementPort}/health` },
    { name: "entitlement-ready", url: `${base}:${entitlementPort}/ready` },
    { name: "entitlement-version", url: `${base}:${entitlementPort}/version` },
    { name: "control-console-health", url: `${base}:${consolePort}/health` },
    { name: "control-console-ready", url: `${base}:${consolePort}/ready` },
  ];
}

export const RSYNC_EXCLUDES = [
  "node_modules",
  ".git",
  ".DS_Store",
  "*.log",
  ".env",
  ".env.*",
  "deploy/env/*.env",
  "coverage",
  "dist",
  ".idea",
  "identity/ACCOUNTS.dev.env",
  "*.license",
];

export function sshArgs({ key, user, host, extra = [] }) {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "IdentitiesOnly=yes",
  ];
  if (key) args.push("-i", key);
  args.push(...extra, `${user}@${host}`);
  return args;
}
