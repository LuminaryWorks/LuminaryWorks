/**
 * Site intent: which products to install and which *content* seeds to apply.
 *
 * Secrets never belong here. Passwords stay in ACCOUNTS.product.env and
 * each product's env. The install wizard writes those files; it must not
 * store credentials in this JSON.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SITE_PRODUCTS = [
  "control-plane",
  "vistacast",
  "syncrobrain",
  "doerflow",
  "vistaremote",
  "dataluminary",
  "blockyedu",
];

/** VistaRemote has no apex domain; public DNS is a vistacast.dev subdomain. */
export const VISTAREMOTE_PARENT_DOMAIN = "vistacast.dev";
export const VISTAREMOTE_DEFAULT_HOST = "vistaremote.vistacast.dev";

export function loadDefaultPublicHosts() {
  const path = join(dirname(fileURLToPath(import.meta.url)), "../../deploy/luminaryworks-install/hosts.defaults.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const hosts = {};
  for (const item of raw.products || []) {
    if (item?.id && item.host) hosts[item.id] = String(item.host).trim().toLowerCase();
  }
  return hosts;
}

export function hostLooksLikeDotDev(host) {
  return /(^|\.)dev$/i.test(String(host || "").trim());
}

export function hostLooksLikeIpv4(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(host || "").trim());
}

/** Explicit empty host in site.json means IP access. Missing key keeps the brand default. */
export function resolveProductHost(name, hostsIn, defaultHosts, publicHost) {
  const incoming = hostsIn && typeof hostsIn === "object" && !Array.isArray(hostsIn) ? hostsIn : {};
  if (Object.prototype.hasOwnProperty.call(incoming, name)) {
    const raw = String(incoming[name] ?? "").trim().toLowerCase();
    return raw || String(publicHost || "").trim();
  }
  return defaultHosts[name] || String(publicHost || "").trim();
}

export function vistaremoteHostOk(host) {
  const value = String(host || "").trim().toLowerCase();
  return value === VISTAREMOTE_PARENT_DOMAIN || value.endsWith(`.${VISTAREMOTE_PARENT_DOMAIN}`);
}

export const BLOCKYEDU_PACK_IDS = [
  "syncrobrain",
  "dataluminary",
  "vistacast",
  "doerflow",
  "vistaremote",
];

export const BLOCKYEDU_SEED_PROFILES = ["full-demo", "catalog-demo", "none"];

/** Private-install default: AI / LMS demo catalog plus every platform Markdown pack. */
export const DEFAULT_BLOCKYEDU_SEED = {
  profile: "full-demo",
  packs: [...BLOCKYEDU_PACK_IDS],
};

export function resolveBlockyeduSeed(seed) {
  const src = seed && typeof seed === "object" && !Array.isArray(seed) ? seed : {};
  const profile = String(src.profile || DEFAULT_BLOCKYEDU_SEED.profile).trim() || DEFAULT_BLOCKYEDU_SEED.profile;
  const packs = Array.isArray(src.packs) ? src.packs.map(String) : [...DEFAULT_BLOCKYEDU_SEED.packs];
  return { profile, packs };
}

const SECRET_KEY = /password|secret|token|private[_-]?key|credential|api[_-]?key/i;

export function issue(severity, code, target, message) {
  return { severity, code, target, message };
}

function asObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function collectSecretKeys(value, path, found) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectSecretKeys(item, `${path}[${i}]`, found));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key)) found.push(next);
    collectSecretKeys(child, next, found);
  }
}

export function parseSiteIntent(raw) {
  const root = asObject(raw, "site");
  const issues = [];
  const secretKeys = [];
  collectSecretKeys(root, "", secretKeys);
  for (const key of secretKeys) {
    issues.push(
      issue(
        "error",
        "secret_in_site_intent",
        key,
        "Site intent must not contain secrets. Put passwords in ACCOUNTS.product.env or the product env.",
      ),
    );
  }

  const profile = String(root.profile || "standalone").trim();
  const allowedProfiles = ["standalone", "control-plane", "agent-commerce", "smart-site", "air-gapped"];
  if (!allowedProfiles.includes(profile)) {
    issues.push(issue("error", "unknown_profile", "profile", `Unknown profile "${profile}"`));
  }

  const platform = String(root.platform || "linux/amd64").trim();
  if (!/^linux\/(amd64|arm64)$/.test(platform)) {
    issues.push(issue("error", "bad_platform", "platform", "platform must be linux/amd64 or linux/arm64"));
  }

  const protocol = String(root.protocol || "https").trim();
  if (protocol !== "http" && protocol !== "https") {
    issues.push(issue("error", "bad_protocol", "protocol", "protocol must be http or https"));
  }

  const publicHost = String(root.publicHost || "").trim();
  if (!publicHost) {
    issues.push(issue("error", "missing_public_host", "publicHost", "publicHost is required (server IP or DNS)"));
  }

  const defaultHosts = loadDefaultPublicHosts();
  const hostsIn = root.hosts && typeof root.hosts === "object" && !Array.isArray(root.hosts) ? root.hosts : {};
  const hosts = {};
  for (const name of SITE_PRODUCTS) {
    hosts[name] = resolveProductHost(name, hostsIn, defaultHosts, publicHost);
  }
  for (const name of Object.keys(hostsIn)) {
    if (!SITE_PRODUCTS.includes(name)) {
      issues.push(issue("warning", "unknown_host", `hosts.${name}`, `Unknown host key "${name}"`));
    }
  }
  if (hosts.vistaremote && !vistaremoteHostOk(hosts.vistaremote)) {
    issues.push(
      issue(
        "warning",
        "vistaremote_host_not_under_vistacast",
        "hosts.vistaremote",
        `VistaRemote has no apex domain. Use a ${VISTAREMOTE_PARENT_DOMAIN} subdomain (default ${VISTAREMOTE_DEFAULT_HOST}).`,
      ),
    );
  }
  const ipAccess = [];
  for (const name of SITE_PRODUCTS) {
    const value = hosts[name];
    const explicit = Object.prototype.hasOwnProperty.call(hostsIn, name);
    const cleared = explicit && !String(hostsIn[name] ?? "").trim();
    if (hostLooksLikeIpv4(value) || cleared) {
      ipAccess.push(name);
    }
  }
  if (ipAccess.length) {
    issues.push(
      issue(
        "warning",
        "ip_access",
        "hosts",
        "Cleared or IP product hosts mean IP:port access. Browsers have no HTTPS on a raw IP, WebCrypto login can fail, and .dev names will not work this way. Fill the brand domains for customer deploy.",
      ),
    );
  }
  if (protocol === "http") {
    for (const name of SITE_PRODUCTS) {
      if (hostLooksLikeDotDev(hosts[name])) {
        issues.push(
          issue(
            "warning",
            "dot_dev_requires_https",
            `hosts.${name}`,
            ".dev names are HSTS-preloaded; browsers will not stay on http. Keep the brand domains and https, or clear the domain fields for emergency IP:port.",
          ),
        );
        break;
      }
    }
  }

  const productsIn = asObject(root.products || {}, "products");
  const products = {};
  for (const name of SITE_PRODUCTS) {
    const entry = productsIn[name] || { enabled: name === "control-plane" && profile === "control-plane" };
    const enabled = Boolean(entry.enabled);
    products[name] = { enabled, seed: entry.seed && typeof entry.seed === "object" ? entry.seed : {} };
  }
  for (const name of Object.keys(productsIn)) {
    if (!SITE_PRODUCTS.includes(name)) {
      issues.push(issue("error", "unknown_product", name, `Unknown product "${name}"`));
    }
  }

  const identity = asObject(root.identity || {}, "identity");
  const accountsProfile = String(identity.accountsProfile || "product").trim();
  if (accountsProfile !== "product" && accountsProfile !== "dev") {
    issues.push(
      issue("error", "bad_accounts_profile", "identity.accountsProfile", "accountsProfile must be product or dev"),
    );
  }
  if (accountsProfile === "dev" && protocol === "https") {
    issues.push(
      issue(
        "warning",
        "dev_accounts_on_https",
        "identity.accountsProfile",
        "dev account profile includes guest users and lab passwords; production should use product",
      ),
    );
  }

  const blocky = products.blockyedu;
  if (blocky.enabled) {
    const resolved = resolveBlockyeduSeed(blocky.seed);
    if (!BLOCKYEDU_SEED_PROFILES.includes(resolved.profile)) {
      issues.push(
        issue("error", "bad_edu_seed_profile", "products.blockyedu.seed.profile", "Use full-demo, catalog-demo, or none"),
      );
    }
    for (const pack of resolved.packs) {
      if (!BLOCKYEDU_PACK_IDS.includes(pack)) {
        issues.push(issue("error", "unknown_edu_pack", "products.blockyedu.seed.packs", `Unknown pack "${pack}"`));
      }
    }
    blocky.seed = resolved;
  }

  return {
    profile,
    platform,
    protocol,
    publicHost,
    hosts,
    products,
    identity: { accountsProfile },
    issues,
    ok: issues.every((item) => item.severity !== "error"),
  };
}

export function enabledPackTargets(intent) {
  const out = [];
  if (intent.products["control-plane"]?.enabled) out.push("control-plane");
  for (const name of SITE_PRODUCTS) {
    if (name === "control-plane") continue;
    if (intent.products[name]?.enabled) out.push(name);
  }
  return out;
}

/** Env keys a product compose already understands. Never includes passwords. */
export function seedEnvPatches(intent) {
  const patches = {};
  const blocky = intent.products.blockyedu;
  if (blocky?.enabled) {
    const resolved = resolveBlockyeduSeed(blocky.seed);
    patches.blockyedu = {
      EDU_SEED_PROFILE: resolved.profile,
      EDU_SEED_PACKS: resolved.packs.join(","),
      ALLOW_LOCAL_LOGIN: "false",
    };
  }
  return patches;
}

export function formatSiteReport(intent) {
  const lines = [
    `[site] profile=${intent.profile} platform=${intent.platform} ${intent.protocol}://${intent.publicHost}`,
    `[site] identity accountsProfile=${intent.identity.accountsProfile} (passwords: identity/ACCOUNTS.${intent.identity.accountsProfile}.env)`,
    `[site] pack targets: ${enabledPackTargets(intent).join(", ") || "(none)"}`,
    `[site] VistaRemote host=${intent.hosts?.vistaremote || VISTAREMOTE_DEFAULT_HOST} (subdomain of ${VISTAREMOTE_PARENT_DOMAIN}, not an apex domain)`,
  ];
  const patches = seedEnvPatches(intent);
  for (const [product, env] of Object.entries(patches)) {
    const rendered = Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    lines.push(`[site] ${product} seed env: ${rendered}`);
  }
  if (!intent.products.blockyedu?.enabled) {
    lines.push("[site] BlockyEdu courses: product disabled — set products.blockyedu.enabled and seed.packs");
  }
  for (const item of intent.issues) {
    lines.push(`[site] ${item.severity} ${item.code} ${item.target}: ${item.message}`);
  }
  return `${lines.join("\n")}\n`;
}
