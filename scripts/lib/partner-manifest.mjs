/**
 * Load, validate, and plan a partner manifest. Dry-run only except
 * applyWriteApps, which appends a public OIDC template and never a secret.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_RESOURCE,
  ENTITLEMENT_RESOURCE,
  PUBLIC_CLIENT_ID_PLACEHOLDER,
  scopesForProduct,
} from "./partner-scopes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "../..");

export const KNOWN_PRODUCT_CODES = [
  "dataluminary",
  "blockyedu",
  "vistaremote",
  "doerflow",
  "vistacast",
  "syncrobrain",
];

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const SECRET_KEY = /(secret|password|passwd|api[-_]?key|private[-_]?key|access[-_]?token|refresh[-_]?token)/i;
const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

export function defaultPaths(root = repoRoot) {
  return {
    manifest: join(root, "contracts/partners.manifest.json"),
    schema: join(root, "contracts/partners.manifest.schema.json"),
    apps: join(root, "identity/apps.json"),
    websiteCopy: join(here, "partner-website-copy.json"),
  };
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadWebsiteCopy(path = defaultPaths().websiteCopy) {
  return readJson(path);
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) throw new Error(`Only local $ref is supported (${ref})`);
  let node = root;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node == null || typeof node !== "object" || !(key in node)) {
      throw new Error(`Unresolvable $ref ${ref}`);
    }
    node = node[key];
  }
  return node;
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesFormat(value, format) {
  if (typeof value !== "string") return true;
  if (format === "uri" || format === "uri-reference") {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }
  if (format === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  return true;
}

export function validateAgainstSchema(data, schema, root = schema, path = "$", errors = []) {
  if (!schema || typeof schema !== "object") return errors;
  if (schema.$ref) {
    validateAgainstSchema(data, resolveRef(schema.$ref, root), root, path, errors);
    return errors;
  }
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) validateAgainstSchema(data, sub, root, path, errors);
  }
  if (schema.const !== undefined && data !== schema.const) {
    errors.push(`${path} must be ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(data)) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = jsonType(data);
    if (!allowed.includes(actual)) {
      errors.push(`${path} must be ${allowed.join("|")} (got ${actual})`);
      return errors;
    }
  }
  if (typeof schema.pattern === "string" && typeof data === "string" && !new RegExp(schema.pattern).test(data)) {
    errors.push(`${path} must match ${schema.pattern}`);
  }
  if (typeof schema.minLength === "number" && typeof data === "string" && data.length < schema.minLength) {
    errors.push(`${path} is shorter than ${schema.minLength}`);
  }
  if (typeof schema.minItems === "number" && Array.isArray(data) && data.length < schema.minItems) {
    errors.push(`${path} must have at least ${schema.minItems} items`);
  }
  if (schema.format && !matchesFormat(data, schema.format)) {
    errors.push(`${path} must be a ${schema.format}`);
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const props = schema.properties || {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (data[key] === undefined) errors.push(`${path}.${key} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(data)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (data[key] !== undefined) validateAgainstSchema(data[key], sub, root, `${path}.${key}`, errors);
    }
  }
  if (Array.isArray(data) && schema.items) {
    data.forEach((item, index) => {
      validateAgainstSchema(item, schema.items, root, `${path}[${index}]`, errors);
    });
  }
  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.some((sub) => {
      const local = [];
      validateAgainstSchema(data, sub, root, path, local);
      return local.length === 0;
    });
    if (!matched) errors.push(`${path} must match one allowed shape`);
  }
  if (schema.if) {
    const ifErrors = [];
    validateAgainstSchema(data, schema.if, root, path, ifErrors);
    if (ifErrors.length === 0 && schema.then) validateAgainstSchema(data, schema.then, root, path, errors);
    else if (ifErrors.length > 0 && schema.else) validateAgainstSchema(data, schema.else, root, path, errors);
  }
  return errors;
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function sameSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

function canonicalScope(item) {
  if (typeof item === "string") return item;
  if (item && typeof item.name === "string") return `${item.name}|${item.description || ""}`;
  return "";
}

function sameScopes(left, right) {
  return sameSet((left || []).map(canonicalScope), (right || []).map(canonicalScope));
}

function walkSecrets(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSecrets(item, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      errors.push(`${path}.${key} is a secret field and cannot be stored in the partner manifest`);
    }
    walkSecrets(child, `${path}.${key}`, errors);
  }
}

function extraRules(manifest, errors) {
  walkSecrets(manifest, "$", errors);
  if (!manifest || !Array.isArray(manifest.partners)) return;
  const codes = new Set();
  const appNames = new Set();
  const productOwners = new Map();
  for (const partner of manifest.partners) {
    if (!partner || typeof partner !== "object") continue;
    if (typeof partner.code === "string") {
      if (codes.has(partner.code)) errors.push(`duplicate partner code ${partner.code}`);
      codes.add(partner.code);
    }
    if (Array.isArray(partner.domains)) {
      const hosts = new Set();
      for (const host of partner.domains) {
        if (typeof host !== "string" || !HOST.test(host)) {
          errors.push(`${partner.code || "partner"} domain is not a hostname: ${host}`);
        }
        if (hosts.has(host)) errors.push(`${partner.code} repeats domain ${host}`);
        hosts.add(host);
      }
    }
    if (typeof partner.legalTermsUrl === "string" && !httpsUrl(partner.legalTermsUrl)) {
      errors.push(`${partner.code} legalTermsUrl must be https`);
    }
    if (typeof partner.legalPrivacyUrl === "string" && !httpsUrl(partner.legalPrivacyUrl)) {
      errors.push(`${partner.code} legalPrivacyUrl must be https`);
    }
    if (typeof partner.supportEmail === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partner.supportEmail)) {
      errors.push(`${partner.code} supportEmail is not an email`);
    }
    if (typeof partner.statusPageUrl === "string" && !httpsUrl(partner.statusPageUrl)) {
      errors.push(`${partner.code} statusPageUrl must be https`);
    }
    const products = Array.isArray(partner.entitlementProductCodes) ? partner.entitlementProductCodes : [];
    if (partner.code && !products.includes(partner.code)) {
      errors.push(`${partner.code} must be listed in entitlementProductCodes`);
    }
    for (const productCode of products) {
      if (productOwners.has(productCode)) {
        errors.push(`product code ${productCode} is claimed by ${productOwners.get(productCode)} and ${partner.code}`);
      } else {
        productOwners.set(productCode, partner.code);
      }
    }
    const hintCodes = partner.aiServiceCredentialHint?.productCodes;
    if (Array.isArray(hintCodes) && !sameSet(hintCodes, products)) {
      errors.push(`${partner.code} aiServiceCredentialHint.productCodes must match entitlementProductCodes`);
    }
    for (const app of partner.oidcApps || []) {
      if (!app || typeof app !== "object") continue;
      if (appNames.has(app.name)) errors.push(`oidc app ${app.name} is listed more than once`);
      appNames.add(app.name);
      if (typeof app.clientId === "string") {
        const placeholder = app.clientId === PUBLIC_CLIENT_ID_PLACEHOLDER;
        if (!placeholder && !PUBLIC_ID.test(app.clientId)) {
          errors.push(`${app.name} clientId must be null, ${PUBLIC_CLIENT_ID_PLACEHOLDER}, or a public id`);
        }
        if (/secret/i.test(app.clientId)) errors.push(`${app.name} clientId must not contain a secret`);
      }
    }
  }
}

export function prepareManifest(doc, schema) {
  const manifest = structuredClone(doc);
  if (Array.isArray(manifest?.partners)) {
    for (const partner of manifest.partners) {
      if (partner && partner.status === undefined) partner.status = "active";
    }
  }
  const errors = validateAgainstSchema(manifest, schema);
  extraRules(manifest, errors);
  return { ok: errors.length === 0, errors, manifest };
}

function bucketFor(type) {
  if (type === "SPA") return "spaApplications";
  if (type === "API") return "apiResources";
  if (type === "MachineToMachine") return "m2mApplications";
  return null;
}

export function proposalFor(app) {
  if (app.type === "SPA") {
    const entry = {
      name: app.name,
      type: "SPA",
      redirectUris: [...(app.redirectUris || [])],
    };
    if (Array.isArray(app.postLogoutRedirectUris)) {
      entry.postLogoutRedirectUris = [...app.postLogoutRedirectUris];
    }
    return { bucket: "spaApplications", entry };
  }
  if (app.type === "API") {
    const entry = { name: app.name, indicator: app.resourceIndicator };
    if (Array.isArray(app.scopes)) entry.scopes = [...app.scopes];
    return { bucket: "apiResources", entry };
  }
  const entry = {
    name: app.name,
    type: "MachineToMachine",
    resourceIndicator: app.resourceIndicator,
  };
  if (Array.isArray(app.scopes)) entry.scopes = [...app.scopes];
  if (app.description) entry.description = app.description;
  return { bucket: "m2mApplications", entry };
}

export function diffPartnerApps(partner, appsDoc) {
  const apps = [];
  for (const app of partner.oidcApps || []) {
    const bucket = bucketFor(app.type);
    const list = bucket ? appsDoc?.[bucket] : null;
    const found = Array.isArray(list) ? list.find((item) => item?.name === app.name) : undefined;
    const issues = [];
    if (!found) {
      issues.push(`missing from identity/apps.json ${bucket || app.type}: ${app.name}`);
      apps.push({ ...app, state: "missing", issues, bucket });
      continue;
    }
    if (Array.isArray(app.redirectUris) && !sameSet(app.redirectUris, found.redirectUris || [])) {
      issues.push(`redirectUris drift for ${app.name}`);
    }
    if (
      Array.isArray(app.postLogoutRedirectUris) &&
      !sameSet(app.postLogoutRedirectUris, found.postLogoutRedirectUris || [])
    ) {
      issues.push(`postLogoutRedirectUris drift for ${app.name}`);
    }
    if (app.resourceIndicator) {
      const actual = app.type === "API" ? found.indicator : found.resourceIndicator;
      if (actual !== app.resourceIndicator) issues.push(`resource indicator drift for ${app.name}`);
    }
    if (Array.isArray(app.scopes) && !sameScopes(app.scopes, found.scopes || [])) {
      issues.push(`scopes drift for ${app.name}`);
    }
    apps.push({ ...app, state: issues.length ? "drift" : "present", issues, bucket });
  }
  return { ok: apps.every((app) => app.state === "present"), apps };
}

export function catalogSeed(partner) {
  const endpoint = "POST /v1/admin/catalog/revisions";
  if (!partner.sellable || partner.status !== "active") {
    return {
      endpoint,
      readyToPost: false,
      blockedReason: partner.sellable
        ? `Partner status is ${partner.status}. Do not publish priced offerings.`
        : "Product is not sellable. Do not POST priced offerings.",
      body: {
        notes: `partner onboard ${partner.code}: not posted`,
        copyFromPublished: true,
        offerings: [],
      },
    };
  }
  const offerings = [];
  for (const productCode of partner.entitlementProductCodes) {
    for (const planCode of ["pro", "ultra"]) {
      for (const interval of ["month", "year"]) {
        for (const market of [
          { currency: "CNY", market: "CN" },
          { currency: "USD", market: "GLOBAL" },
        ]) {
          offerings.push({
            sku: `${productCode}.${planCode}.${interval}.${market.currency}`,
            productCode,
            planCode,
            interval,
            currency: market.currency,
            market: market.market,
            active: false,
          });
        }
      }
    }
  }
  return {
    endpoint,
    readyToPost: false,
    blockedReason:
      "amountMinor is omitted. OfferingDraftDto requires an integer greater than 0. This command does not invent prices.",
    body: {
      notes: `partner onboard ${partner.code}`,
      copyFromPublished: true,
      offerings,
    },
  };
}

export function aiFragment(partner) {
  return {
    AI_PLATFORM_SERVICE_PRODUCT_CODES: partner.aiServiceCredentialHint.productCodes.join(","),
    credentialsEntry: {
      key: "<set outside git>",
      productCodes: [...partner.aiServiceCredentialHint.productCodes],
      internal: partner.aiServiceCredentialHint.internal === true,
    },
    note: "Put the key in the process environment or a secret store. Do not commit it and do not add it to this manifest.",
  };
}

export function accountCenterFragment(partner, copy) {
  const known = copy?.products?.[partner.code];
  const description = known?.summaryEn || partner.displayName;
  const url = `https://${partner.domains[0]}`;
  return partner.entitlementProductCodes.map((code) => ({
    code,
    name: partner.displayName,
    url,
    description,
  }));
}

export function websiteCard(partner, copy) {
  const known = copy?.products?.[partner.code] || null;
  const trial = known?.trial || "unspecified";
  let statusBadge = "sellable · trial unspecified";
  if (!partner.sellable) statusBadge = "目录可配置 · 就绪前不可售 · 无 Trial";
  else if (trial === "standard_7d") statusBadge = "正式可售 · 7 天 Trial";
  else if (trial === "disabled") statusBadge = "正式可售 · 无 Trial";
  const catalogConflict =
    partner.code === "vistacast" || partner.code === "syncrobrain"
      ? "spec/website-design.md section 03 still marks this product sellable. spec/products/index.md and the entitlement sellable offering list do not. Use sellable from this manifest."
      : null;
  return {
    code: partner.code,
    brand: partner.displayName,
    nameZh: known?.nameZh || null,
    roleZh: known?.roleZh || null,
    roleEn: known?.roleEn || null,
    summaryZh: known?.summaryZh || null,
    summaryEn: known?.summaryEn || null,
    chips: known?.chips || [],
    operatorLabel: partner.operatorLabel,
    operatorNote: "由其自己的团队或实体运营",
    sellable: partner.sellable,
    trial,
    statusBadge,
    siteUrl: `https://${partner.domains[0]}`,
    termsUrl: partner.legalTermsUrl,
    privacyUrl: partner.legalPrivacyUrl,
    sourceUrl: `https://github.com/${partner.githubOrg}/${partner.githubOrg}`,
    supportEmail: partner.supportEmail,
    statusPageUrl: partner.statusPageUrl,
    catalogConflict,
  };
}

function logtoScopes(partner) {
  const entitlement = [];
  const ai = [];
  for (const code of partner.entitlementProductCodes) {
    for (const scope of scopesForProduct(code)) {
      if (scope.endsWith(":ai:usage:read")) ai.push(scope);
      else entitlement.push(scope);
    }
  }
  return {
    entitlementResource: ENTITLEMENT_RESOURCE,
    entitlementScopes: entitlement,
    retainEntitlementAdmin: ["entitlement:admin", "entitlement:read"],
    aiResource: AI_RESOURCE,
    aiScopes: ai,
    platformAdminOnly: ["ai:admin", "entitlement:admin"],
  };
}

export function buildPlan(partner, appsDoc, copy) {
  const identity = diffPartnerApps(partner, appsDoc);
  const proposals = identity.apps.filter((app) => app.state === "missing").map((app) => proposalFor(app));
  const unknownProducts = partner.entitlementProductCodes.filter((code) => !KNOWN_PRODUCT_CODES.includes(code));
  const warnings = [];
  if (partner.supportEmail == null) warnings.push("supportEmail is null until the partner publishes a mailbox");
  if (partner.statusPageUrl == null) warnings.push("statusPageUrl is null until the partner publishes one");
  if (!partner.sellable) warnings.push("sellable is false; do not publish a priced SKU");
  if (unknownProducts.length) {
    warnings.push(
      `${unknownProducts.join(", ")} is not in the entitlement PRODUCT_CODES snapshot. The entitlement owner adds it. This command does not edit services/entitlement.`,
    );
  }
  const website = websiteCard(partner, copy);
  if (website.catalogConflict) warnings.push(website.catalogConflict);
  if (!identity.ok) warnings.push("identity/apps.json does not yet match every listed oidc app");
  return {
    dryRun: true,
    partner: {
      code: partner.code,
      displayName: partner.displayName,
      operatorLabel: partner.operatorLabel,
      status: partner.status,
      sellable: partner.sellable,
      domains: partner.domains,
      githubOrg: partner.githubOrg,
    },
    warnings,
    identity: { ok: identity.ok, apps: identity.apps, proposals },
    entitlementCatalog: catalogSeed(partner),
    aiPlatform: aiFragment(partner),
    accountCenter: accountCenterFragment(partner, copy),
    website,
    logtoScopes: logtoScopes(partner),
    audit: {
      stream: "AuditService.record writes audit_logs",
      readApi: "GET /v1/admin/audit",
      existingKillSwitchActions: ["product.lifecycle", "product.force_revoke"],
      partnerReadActionsToAdd: ["partner.orders.read", "partner.catalog.read", "partner.ai.usage.read"],
      note: "Use the existing entitlement audit stream. Do not add a second log or a console page in this command.",
    },
  };
}

function block(value) {
  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

export function renderPlan(plan) {
  const lines = [
    `# Partner onboard plan: ${plan.partner.code}`,
    "",
    "Dry-run. This command does not POST, does not call Logto, and does not write secrets.",
    "",
    `- code: ${plan.partner.code}`,
    `- displayName: ${plan.partner.displayName}`,
    `- operatorLabel: ${plan.partner.operatorLabel} (brand until a legal entity is supplied)`,
    `- status: ${plan.partner.status}`,
    `- sellable: ${plan.partner.sellable}`,
    "",
    "## Warnings",
    ...plan.warnings.map((item) => `- ${item}`),
    "",
    "## 1. identity/apps.json",
  ];
  for (const app of plan.identity.apps) {
    lines.push(`- ${app.state}: ${app.name} (${app.type})`);
    for (const issue of app.issues) lines.push(`  - ${issue}`);
  }
  if (plan.identity.proposals.length) {
    lines.push("", "Proposed fragment (not written):", block(plan.identity.proposals));
  }
  lines.push(
    "",
    "## 2. Entitlement catalog seed",
    `readyToPost: ${plan.entitlementCatalog.readyToPost}`,
    plan.entitlementCatalog.blockedReason,
    block(plan.entitlementCatalog.body),
    "",
    "## 3. AI platform credential",
    `AI_PLATFORM_SERVICE_PRODUCT_CODES=${plan.aiPlatform.AI_PLATFORM_SERVICE_PRODUCT_CODES}`,
    plan.aiPlatform.note,
    block(plan.aiPlatform.credentialsEntry),
    "",
    "## 4. Account Center card",
    "Merge into ACCOUNT_CENTER_APPS_JSON. This fragment uses the public site, not a guessed localhost port.",
    block(plan.accountCenter),
    "",
    "## 5. Website product card",
    block(plan.website),
    "",
    "## 6. Logto API resource scopes",
    `Entitlement ${plan.logtoScopes.entitlementResource}: ${plan.logtoScopes.entitlementScopes.join(", ")}`,
    `Keep platform admin scopes: ${plan.logtoScopes.retainEntitlementAdmin.join(", ")}`,
    `AI Platform ${plan.logtoScopes.aiResource}: ${plan.logtoScopes.aiScopes.join(", ")}`,
    "Create ai:admin for platform admins only. Do not grant it to the partner operator.",
    "",
    "## 7. Audit",
    `${plan.audit.stream}. Read with ${plan.audit.readApi}.`,
    `Kill switch already records ${plan.audit.existingKillSwitchActions.join(" and ")}.`,
    `Partner reads still to be recorded on that same stream: ${plan.audit.partnerReadActionsToAdd.join(", ")}.`,
    plan.audit.note,
    "",
  );
  return lines.join("\n");
}

export function renderCheck(partner, identity) {
  const lines = [`# Partner check: ${partner.code}`, ""];
  for (const app of identity.apps) {
    lines.push(`- ${app.state}: ${app.name}`);
    for (const issue of app.issues) lines.push(`  - ${issue}`);
  }
  lines.push("", identity.ok ? "ok" : "failed", "");
  return lines.join("\n");
}

export function renderList(partners) {
  const lines = ["# Partners", ""];
  for (const partner of partners) {
    lines.push(
      `- ${partner.code}  ${partner.displayName}  status=${partner.status}  sellable=${partner.sellable}  ${partner.domains[0]}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function applyWriteApps(appsDoc, partner) {
  const diff = diffPartnerApps(partner, appsDoc);
  const missing = diff.apps.filter((app) => app.state === "missing");
  if (missing.length === 0) {
    return { wrote: false, reason: "already-present", proposals: [] };
  }
  const blocked = missing.filter((app) => app.clientId !== PUBLIC_CLIENT_ID_PLACEHOLDER);
  const proposals = missing.map((app) => proposalFor(app));
  if (blocked.length) {
    return { wrote: false, reason: "not-a-public-placeholder", proposals };
  }
  const next = structuredClone(appsDoc);
  for (const proposal of proposals) {
    if (!Array.isArray(next[proposal.bucket])) {
      throw new Error(`identity/apps.json is missing ${proposal.bucket}`);
    }
    next[proposal.bucket].push(proposal.entry);
  }
  return { wrote: true, reason: "appended-template", doc: next, proposals };
}

export const HELP = `Partner registry

  pnpm partner:onboard -- --list
  pnpm partner:onboard -- --check <code>
  pnpm partner:onboard -- --plan <code>
  pnpm partner:onboard -- --write-apps <code>

--plan is a dry-run. --write-apps appends a missing app only when its clientId
is ${PUBLIC_CLIENT_ID_PLACEHOLDER}. Existing apps and secrets are left untouched.
--json prints the machine-readable result. --manifest and --apps override paths.
`;
