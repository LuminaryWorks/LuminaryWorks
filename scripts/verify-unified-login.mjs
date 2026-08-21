/**
 * Data-driven Playwright acceptance for every LuminaryWorks product login.
 *
 * Local default: offline SPAs are reported and skipped.
 * CI and --strict: every configured SPA must be online and pass.
 *
 * Usage:
 *   node scripts/verify-unified-login.mjs [--strict|--allow-skip] [--headed]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const metaRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const IDP_ORIGIN = (process.env.IDP_ORIGIN || "http://localhost:3001").replace(/\/$/, "");
const argv = new Set(process.argv.slice(2));
const knownFlags = new Set(["--strict", "--allow-skip", "--headed", "--help"]);
const unknownFlags = [...argv].filter((arg) => !knownFlags.has(arg));

if (unknownFlags.length) {
  console.error(`Unknown option(s): ${unknownFlags.join(", ")}`);
  process.exit(2);
}
if (argv.has("--help")) {
  console.log("Usage: node scripts/verify-unified-login.mjs [--strict|--allow-skip] [--headed]");
  process.exit(0);
}

const strict = Boolean(process.env.CI) || argv.has("--strict");
const allowSkip = !strict && (argv.has("--allow-skip") || !argv.has("--strict"));

function loadEnvFile(path) {
  const values = {};
  try {
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = rawLine.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    // The shell/CI environment may provide all account values.
  }
  return values;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const accounts = loadEnvFile(join(metaRoot, "identity", "ACCOUNTS.dev.env"));
const registered = readJson(join(metaRoot, "identity", "registered-apps.json"));

function credential(productKey, field, fallback) {
  const key = `LW_ADMIN_${productKey}_${field}`;
  return process.env[key] || accounts[key] || fallback;
}

function loginUrl(id, fallback) {
  return process.env[`VERIFY_LOGIN_${id.replaceAll("-", "_").toUpperCase()}_URL`] || fallback;
}

function leftLogin(url) {
  return (
    !url.pathname.startsWith("/login") &&
    !url.pathname.startsWith("/auth/callback") &&
    !url.pathname.startsWith("/direct") &&
    !url.pathname.startsWith("/sign-in")
  );
}

const productCases = [
  {
    id: "dataluminary",
    product: "DataLuminary",
    surface: "DataView",
    url: loginUrl("dataluminary", "http://localhost:3003/#/login"),
    clientIdKey: "DataView (DataLuminary)",
    accountKey: "DATALUMINARY",
    fallbackEmail: "admin.dataluminary@luminaryworks.dev",
    success: (url) => url.origin === "http://localhost:3003" && /^#\/(space|account)/.test(url.hash),
  },
  {
    id: "blockyedu-lms",
    product: "BlockyEdu",
    surface: "LMS (edu-app-web)",
    url: loginUrl("blockyedu-lms", "http://localhost:18082/login"),
    clientIdKey: "VibeEdu edu-app-web",
    accountKey: "BLOCKYEDU",
    fallbackEmail: "admin.blockyedu@luminaryworks.dev",
    success: leftLogin,
  },
  {
    id: "blockyedu-code",
    product: "BlockyEdu",
    surface: "Code (code-app-web)",
    url: loginUrl("blockyedu-code", "http://localhost:18081/login"),
    clientIdKey: "VibeEdu code-app-web",
    accountKey: "BLOCKYEDU",
    fallbackEmail: "admin.blockyedu@luminaryworks.dev",
    success: leftLogin,
  },
  {
    id: "doerflow-web",
    product: "DoerFlow",
    surface: "Web",
    url: loginUrl("doerflow-web", "http://localhost:5174/login"),
    clientIdKey: "VibeAgent Web",
    accountKey: "DOERFLOW",
    fallbackEmail: "admin.doerflow@luminaryworks.dev",
    success: leftLogin,
  },
  {
    id: "doerflow-admin",
    product: "DoerFlow",
    surface: "Admin",
    url: loginUrl("doerflow-admin", "http://localhost:13011/login?returnUrl=%2Fdashboard"),
    clientIdKey: "DoerFlow Admin",
    accountKey: "DOERFLOW",
    fallbackEmail: "admin.doerflow@luminaryworks.dev",
    success: (url) => url.pathname.startsWith("/dashboard"),
  },
  {
    id: "vistacast",
    product: "VistaCast",
    surface: "Admin Web",
    url: loginUrl("vistacast", "http://localhost:13101/login"),
    clientIdKey: "VistaCast Admin",
    accountKey: "VISTACAST",
    fallbackEmail: "admin.vistacast@luminaryworks.dev",
    success: leftLogin,
  },
  {
    id: "vistaremote-client",
    product: "VistaRemote",
    surface: "Client Web (desktop renderer replacement)",
    url: loginUrl("vistaremote-client", "http://localhost:5173/login?next=%2Fpairing"),
    clientIdKey: "VistaRemote Client",
    accountKey: "VISTAREMOTE",
    fallbackEmail: "admin.vistaremote@luminaryworks.dev",
    success: (url) => url.pathname.startsWith("/pairing"),
    note:
      "Electron desktop has no independently reliable browser entry; the registered VistaRemote Client Web OIDC surface verifies the same client login contract.",
  },
  {
    id: "vistaremote-admin",
    product: "VistaRemote",
    surface: "Admin Web",
    url: loginUrl("vistaremote-admin", "http://localhost:5175/login"),
    clientIdKey: "VistaRemote Admin",
    accountKey: "VISTAREMOTE",
    fallbackEmail: "admin.vistaremote@luminaryworks.dev",
    success: leftLogin,
  },
  {
    id: "syncrobrain",
    product: "SyncroBrain",
    surface: "IoT Console",
    url: loginUrl("syncrobrain", "http://localhost:15180/login"),
    clientIdKey: "LuminaryIoTChain iot-console-web",
    accountKey: "SYNCROBRAIN",
    fallbackEmail: "admin.syncrobrain@luminaryworks.dev",
    success: leftLogin,
  },
].map((spec) => ({
  ...spec,
  email: credential(spec.accountKey, "EMAIL", spec.fallbackEmail),
  password: credential(spec.accountKey, "PASSWORD", "LuminaryDev!234"),
  spaClientId: registered.spa?.[spec.clientIdKey],
}));

async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch {
    const resolved = execFileSync(
      "npm",
      [
        "exec",
        "--yes",
        "--package=playwright",
        "--",
        "node",
        "-p",
        "require.resolve('playwright')",
      ],
      { encoding: "utf8", cwd: metaRoot },
    ).trim();
    return (await import(pathToFileURL(resolved).href)).chromium;
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function spaOrigin(spec) {
  return new URL(spec.url).origin;
}

async function isOnline(spec) {
  try {
    const response = await fetch(spec.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(2500),
    });
    return response.status > 0 && response.status < 500;
  } catch {
    return false;
  }
}

async function verifyDiscovery(spec) {
  const origin = spaOrigin(spec);
  const response = await fetch(`${origin}/oidc/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`discovery returned ${response.status}`);
  const discovery = await response.json();
  const authorize = String(discovery.authorization_endpoint || "");
  if (!authorize.startsWith(`${IDP_ORIGIN}/`)) {
    throw new Error(`authorization_endpoint must remain on ${IDP_ORIGIN}, got ${authorize || "<empty>"}`);
  }
  if (!discovery.token_endpoint || !discovery.jwks_uri) {
    throw new Error("discovery is missing token_endpoint or jwks_uri");
  }
  return authorize;
}

function watchAuthFailures(page) {
  const failures = [];
  page.on("request", (request) => {
    if (/invalid_client|oidc\.invalid_client/i.test(request.url())) {
      failures.push(`request URL: ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (/invalid_client|oidc\.invalid_client/i.test(url)) {
      failures.push(`response URL: ${url}`);
    }
    if (url.includes("/api/experience") && response.status() >= 500) {
      failures.push(`Experience ${response.request().method()} ${response.status()}: ${url}`);
    }
  });
  return failures;
}

async function assertNoInvalidClient(page, failures) {
  const body = await page.locator("body").innerText().catch(() => "");
  if (/invalid_client|oidc\.invalid_client|invalid client/i.test(body)) {
    failures.push(`page text: ${body.replace(/\s+/g, " ").slice(0, 240)}`);
  }
  if (failures.length) throw new Error(failures.join(" | "));
}

async function signInExperience(page, spec) {
  const endpoint = new URL("/api/.well-known/sign-in-exp", spec.url);
  endpoint.searchParams.set("appId", spec.spaClientId);
  const response = await page.request.get(endpoint.toString(), {
    timeout: 10000,
  });
  const text = await response.text();
  if (/invalid_client|oidc\.invalid_client|invalid client/i.test(text)) {
    throw new Error(`sign-in-exp rejected ${spec.clientIdKey}: ${text.slice(0, 200)}`);
  }
  if (!response.ok()) {
    throw new Error(`sign-in-exp returned ${response.status()}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("sign-in-exp did not return JSON");
  }
}

function socialConnectors(signInExp) {
  return Array.isArray(signInExp?.socialConnectors) ? signInExp.socialConnectors : [];
}

function hasConnector(connectors, provider) {
  const needle = provider.toLowerCase();
  return connectors.some((connector) => JSON.stringify(connector).toLowerCase().includes(needle));
}

async function detectLoginCapability(page) {
  const identifier = page.locator(
    'input[name="identifier"], input[autocomplete="username"], input[type="email"]',
  ).first();
  const password = page.locator('input[name="password"], input[type="password"]').first();
  if (
    await identifier.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false) &&
    await password.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)
  ) {
    return { mode: "Headless", identifier, password };
  }

  const hostedTrigger = page
    .locator("button, a")
    .filter({ hasText: /统一账号|single sign|hosted|oidc|sso|sign in/i })
    .first();
  if (!(await hostedTrigger.isVisible().catch(() => false))) {
    throw new Error("neither a Headless password form nor a Hosted/OIDC login trigger is visible");
  }
  await hostedTrigger.click();
  await identifier.waitFor({ state: "visible", timeout: 30000 });
  await password.waitFor({ state: "visible", timeout: 15000 });
  return { mode: "Hosted", identifier, password };
}

async function verifySocialHop(browser, spec, provider) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(spec.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const button = page.getByRole("button", { name: new RegExp(`^${provider}$`, "i") }).first();
    await button.waitFor({ state: "visible", timeout: 15000 });
    await button.click();
    await page.waitForURL(
      (url) => {
        const href = url.toString();
        return (
          (provider === "Google" && /accounts\.google\.com/i.test(href)) ||
          (provider === "GitHub" && /github\.com\/login\/oauth/i.test(href)) ||
          new RegExp(
            `^${IDP_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/direct/social/${provider.toLowerCase()}`,
            "i",
          ).test(href) ||
          href.startsWith(`${spaOrigin(spec)}/direct`) ||
          href.startsWith(`${spaOrigin(spec)}/sign-in`)
        );
      },
      { timeout: 25000 },
    );
    const href = page.url();
    if (href.startsWith(`${spaOrigin(spec)}/direct`) || href.startsWith(`${spaOrigin(spec)}/sign-in`)) {
      throw new Error(`${provider} got stuck on SPA-hosted IdP route: ${href}`);
    }
    return href;
  } finally {
    await context.close();
  }
}

async function verifyProduct(browser, spec) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const authFailures = watchAuthFailures(page);
  let clientIdSeen = false;
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (url.searchParams.get("client_id") === spec.spaClientId) clientIdSeen = true;
    } catch {
      // Ignore non-URL requests.
    }
  });

  try {
    const authorize = await verifyDiscovery(spec);
    console.log(`  ✓ discovery → ${authorize}`);

    await page.goto(spec.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const signInExp = await signInExperience(page, spec);
    const capability = await detectLoginCapability(page);
    await assertNoInvalidClient(page, authFailures);
    console.log(`  ✓ capability: ${capability.mode} password form; client key: ${spec.clientIdKey}`);

    const connectors = socialConnectors(signInExp);
    for (const provider of ["Google", "GitHub"]) {
      const buttonCount = await page.getByRole("button", {
        name: new RegExp(`^${provider}$`, "i"),
      }).count();
      const connected = hasConnector(connectors, provider);
      if (buttonCount > 0 && !connected) {
        throw new Error(`${provider} button is visible but no ${provider} connector exists`);
      }
      if (buttonCount > 0 && connected) {
        const href = await verifySocialHop(browser, spec, provider);
        console.log(`  ✓ ${provider} connector hop → ${href.slice(0, 150)}`);
      }
    }
    if (!connectors.length) {
      console.log("  · social: no connector configured; hop checks omitted");
    } else {
      console.log(`  · social connectors reported: ${connectors.length}`);
    }

    await capability.identifier.fill(spec.email);
    await capability.password.fill(spec.password);
    const loginForm = capability.password.locator("xpath=ancestor::form[1]");
    const submit = (await loginForm.count())
      ? loginForm.locator('button[type="submit"]').first()
      : page.locator('button[type="submit"]').filter({ visible: true }).first();
    await submit.waitFor({ state: "visible", timeout: 10000 });
    await submit.click();
    await page.waitForURL((url) => spec.success(url), { timeout: 90000 });
    await page.waitForTimeout(1200);
    if (!spec.success(new URL(page.url()))) {
      throw new Error(`login left the success route after callback and returned to ${page.url()}`);
    }
    await assertNoInvalidClient(page, authFailures);
    if (!clientIdSeen) {
      throw new Error(`authorization did not use registered client id ${spec.spaClientId}`);
    }
    console.log(`  ✓ password login → ${page.url()}`);
  } finally {
    await context.close();
  }
}

console.log(
  `LuminaryWorks unified login: ${productCases.length} entries; mode=${strict ? "strict" : "allow-skip"}; IdP=${IDP_ORIGIN}`,
);

const results = [];
const preflightResults = new Map();
for (const spec of productCases) {
  if (!spec.spaClientId) {
    const detail = `registered client missing: identity/registered-apps.json spa["${spec.clientIdKey}"]`;
    preflightResults.set(spec.id, { status: "FAIL", detail });
    continue;
  }
  if (!(await isOnline(spec))) {
    const detail = `SPA offline at ${spaOrigin(spec)}`;
    preflightResults.set(spec.id, { status: allowSkip ? "SKIP" : "FAIL", detail });
  }
}

const onlineCount = productCases.length - preflightResults.size;
const browser = onlineCount
  ? await (await loadChromium()).launch({ headless: !argv.has("--headed") })
  : null;
try {
  for (const spec of productCases) {
    console.log(`\n▶ ${spec.product} / ${spec.surface}\n  ${spec.url}`);
    if (spec.note) console.log(`  · ${spec.note}`);
    const preflight = preflightResults.get(spec.id);
    if (preflight) {
      const marker = preflight.status === "SKIP" ? "↷ skipped:" : "✗";
      const output = preflight.status === "SKIP" ? console.log : console.error;
      output(`  ${marker} ${preflight.detail}`);
      results.push({ spec, ...preflight });
      continue;
    }

    try {
      await verifyProduct(browser, spec);
      results.push({ spec, status: "PASS", detail: "discovery, capability, client, password, social" });
    } catch (error) {
      console.error(`  ✗ ${message(error)}`);
      results.push({ spec, status: "FAIL", detail: message(error) });
    }
  }
} finally {
  if (browser) {
    await browser.close();
  }
}

console.log("\nUnified login summary");
for (const { spec, status, detail } of results) {
  const marker = status === "PASS" ? "✓" : status === "SKIP" ? "↷" : "✗";
  console.log(`${marker} ${status.padEnd(4)} ${spec.product} / ${spec.surface}: ${detail}`);
}

const totals = Object.fromEntries(
  ["PASS", "FAIL", "SKIP"].map((status) => [
    status,
    results.filter((result) => result.status === status).length,
  ]),
);
console.log(
  `Total ${results.length}/${productCases.length}: pass=${totals.PASS}, fail=${totals.FAIL}, skip=${totals.SKIP}`,
);

if (results.length !== productCases.length || totals.FAIL > 0) {
  process.exit(1);
}
console.log("✓ unified login verification passed");
