/**
 * Playwright smoke for product Headless login (password + social hops).
 *
 * Requires local IdP (`pnpm id:up`) and product SPAs. Missing SPAs are skipped.
 *
 *   DataLuminary DataView     http://localhost:3003/#/login
 *   BlockyEdu edu-app-web     http://localhost:18082/login
 *   BlockyEdu code-app-web    http://localhost:18081/login
 *
 * Usage: node scripts/verify-unified-login.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const metaRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const IDP_ORIGIN = "http://localhost:3001";

async function loadChromium() {
  try {
    const mod = await import("playwright");
    return mod.chromium;
  } catch {
    /* fall through */
  }
  const fromNpx = execFileSync("npm", ["exec", "--yes", "--package=playwright", "--", "node", "-p", "require.resolve('playwright')"], {
    encoding: "utf8",
    cwd: metaRoot,
  }).trim();
  const mod = await import(pathToFileURL(fromNpx).href);
  return mod.chromium;
}

function loadEnvFile(path) {
  const map = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) map[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  } catch {
    /* missing */
  }
  return map;
}

async function originUp(origin) {
  try {
    const res = await fetch(origin, { signal: AbortSignal.timeout(2000), redirect: "manual" });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

const accounts = loadEnvFile(join(metaRoot, "identity", "ACCOUNTS.dev.env"));
const registered = JSON.parse(
  readFileSync(join(metaRoot, "identity", "registered-apps.json"), "utf8"),
);

const cases = [
  {
    name: "DataLuminary",
    url: "http://localhost:3003/#/login",
    required: true,
    email: accounts.LW_ADMIN_DATALUMINARY_EMAIL || "admin.dataluminary@luminaryworks.dev",
    password: accounts.LW_ADMIN_DATALUMINARY_PASSWORD || "LuminaryDev!234",
    spaClientId: registered.spa["DataView (DataLuminary)"],
    success: (page) =>
      page.waitForFunction(
        () => !window.location.hash.includes("/login") && window.location.hash.length > 1,
        null,
        { timeout: 30000 },
      ),
  },
  {
    name: "BlockyEdu LMS",
    url: "http://localhost:18082/login",
    required: true,
    email: accounts.LW_ADMIN_BLOCKYEDU_EMAIL || "admin.blockyedu@luminaryworks.dev",
    password: accounts.LW_ADMIN_BLOCKYEDU_PASSWORD || "LuminaryDev!234",
    spaClientId: registered.spa["VibeEdu edu-app-web"],
    success: async (page) => {
      await page.waitForFunction(
        () => {
          const p = window.location.pathname;
          return !p.startsWith("/login") && !p.startsWith("/auth/callback") && !p.startsWith("/direct");
        },
        null,
        { timeout: 45000 },
      );
    },
  },
  {
    name: "BlockyEdu Code",
    url: "http://localhost:18081/login",
    required: false,
    email: accounts.LW_ADMIN_BLOCKYEDU_EMAIL || "admin.blockyedu@luminaryworks.dev",
    password: accounts.LW_ADMIN_BLOCKYEDU_PASSWORD || "LuminaryDev!234",
    spaClientId: registered.spa["VibeEdu code-app-web"],
    success: async (page) => {
      await page.waitForFunction(
        () => {
          const p = window.location.pathname;
          return !p.startsWith("/login") && !p.startsWith("/auth/callback") && !p.startsWith("/direct");
        },
        null,
        { timeout: 45000 },
      );
    },
  },
];

function spaOriginOf(url) {
  return new URL(url).origin;
}

async function assertAuthorizeOnIdp(origin, name) {
  const res = await fetch(`${origin}/oidc/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`discovery ${res.status}`);
  }
  const json = await res.json();
  const authorize = String(json.authorization_endpoint || "");
  if (!authorize.startsWith(`${IDP_ORIGIN}/`)) {
    throw new Error(
      `authorization_endpoint is ${authorize} (must stay on ${IDP_ORIGIN} so Google/GitHub do not stick on ${origin}/direct/social/*)`,
    );
  }
  console.log(`  · discovery authorize: ${authorize}`);
}

async function clickSocialAndExpectIdpHop(page, spec, provider) {
  const spaOrigin = spaOriginOf(spec.url);
  const button = page.getByRole("button", { name: new RegExp(`^${provider}$`, "i") });
  if ((await button.count()) === 0) {
    throw new Error(`${provider} button missing`);
  }
  await button.click();
  await page.waitForURL(
    (url) => {
      const href = url.toString();
      const onProvider =
        (provider === "Google" && /accounts\.google\.com/i.test(href)) ||
        (provider === "GitHub" && /github\.com\/login\/oauth/i.test(href));
      const onIdpDirect = new RegExp(`${IDP_ORIGIN.replace("://", ":\\/\\/")}/direct/social/${provider.toLowerCase()}`, "i").test(
        href,
      );
      const stuckOnSpa = href.startsWith(`${spaOrigin}/direct`) || href.startsWith(`${spaOrigin}/sign-in`);
      return onProvider || onIdpDirect || stuckOnSpa;
    },
    { timeout: 20000 },
  );
  const href = page.url();
  if (href.startsWith(`${spaOrigin}/direct`) || href.startsWith(`${spaOrigin}/sign-in`)) {
    throw new Error(`${provider} stuck on SPA hosted UI: ${href}`);
  }
  console.log(`  ✓ ${provider} hop → ${href.slice(0, 160)}`);
}

const experienceFailures = [];
let failed = 0;
let skipped = 0;

const browser = await (await loadChromium()).launch({ headless: true });
try {
  for (const spec of cases) {
    const origin = spaOriginOf(spec.url);
    console.log(`▶ ${spec.name} ${spec.url}`);
    if (!(await originUp(origin))) {
      const msg = `  · SPA not running at ${origin}`;
      if (spec.required) {
        console.error(`  ✗ ${msg}`);
        failed += 1;
      } else {
        console.log(`  · skipped (${msg})`);
        skipped += 1;
      }
      continue;
    }

    try {
      await assertAuthorizeOnIdp(origin, spec.name);
    } catch (e) {
      console.error(`  ✗ OIDC discovery: ${e instanceof Error ? e.message : e}`);
      failed += 1;
      continue;
    }

    const page = await browser.newPage();
    page.on("response", (res) => {
      const u = res.url();
      if (u.includes("/api/experience") && res.status() >= 500) {
        experienceFailures.push(`${spec.name} ${res.request().method()} ${u} → ${res.status()}`);
      }
    });
    try {
      await page.goto(spec.url, { waitUntil: "networkidle", timeout: 30000 });
      await page.locator('input[name="identifier"]').waitFor({ timeout: 15000 });
      await page.waitForTimeout(1200);

      const bodyText = await page.locator("body").innerText();
      if (/invalid_client|oidc\.invalid_client/i.test(bodyText)) {
        console.error(`  ✗ page shows invalid_client`);
        failed += 1;
        continue;
      }
      if (spec.spaClientId && bodyText.includes("invalid client") && bodyText.includes(spec.spaClientId)) {
        console.error(`  ✗ page rejects current registered client`);
        failed += 1;
        continue;
      }

      const google = page.getByRole("button", { name: /^Google$/i });
      const github = page.getByRole("button", { name: /^GitHub$/i });
      const googleCount = await google.count();
      const githubCount = await github.count();
      const sie = await page.request.get(new URL("/api/.well-known/sign-in-exp", spec.url).toString());
      let socialCount = 0;
      if (sie.ok()) {
        const json = await sie.json();
        socialCount = Array.isArray(json.socialConnectors) ? json.socialConnectors.length : 0;
      }
      if (socialCount === 0 && (googleCount > 0 || githubCount > 0)) {
        console.warn(
          `  ! fake social buttons (Google=${googleCount} GitHub=${githubCount}) while IdP has no connectors — needs @luminaryworks/auth-react@0.3.2`,
        );
      } else {
        console.log(`  · social buttons: google=${googleCount} github=${githubCount} (IdP connectors=${socialCount})`);
      }

      if (socialCount > 0 && googleCount > 0) {
        try {
          await clickSocialAndExpectIdpHop(page, spec, "Google");
        } catch (e) {
          console.error(`  ✗ Google hop: ${e instanceof Error ? e.message : e}`);
          failed += 1;
        }
        await page.goto(spec.url, { waitUntil: "networkidle", timeout: 30000 });
        await page.locator('input[name="identifier"]').waitFor({ timeout: 15000 });
        await page.waitForTimeout(800);
      }
      if (socialCount > 0 && (await page.getByRole("button", { name: /^GitHub$/i }).count()) > 0) {
        try {
          await clickSocialAndExpectIdpHop(page, spec, "GitHub");
        } catch (e) {
          console.error(`  ✗ GitHub hop: ${e instanceof Error ? e.message : e}`);
          failed += 1;
        }
        await page.goto(spec.url, { waitUntil: "networkidle", timeout: 30000 });
        await page.locator('input[name="identifier"]').waitFor({ timeout: 15000 });
        await page.waitForTimeout(800);
      }

      const identifier = page.locator('input[name="identifier"]');
      const password = page.locator('input[name="password"]');
      await identifier.fill(spec.email);
      await password.fill(spec.password);
      await page.locator("form").locator('button[type="submit"]').click();

      try {
        await spec.success(page);
        console.log(`  ✓ password sign-in left the login page (${page.url()})`);
      } catch (e) {
        const errText = await page.locator("body").innerText();
        console.error(`  ✗ password sign-in did not leave login: ${e instanceof Error ? e.message : e}`);
        if (/internal server|500|invalid_client/i.test(errText)) {
          console.error(`    page: ${errText.slice(0, 280)}`);
        }
        failed += 1;
      }
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

if (experienceFailures.length) {
  console.error("✗ Experience API 5xx:");
  for (const line of experienceFailures) console.error(`  ${line}`);
  failed += 1;
}

if (failed) {
  console.error(`✗ unified login verification failed (${failed})${skipped ? `, skipped ${skipped}` : ""}`);
  process.exit(1);
}
console.log(`✓ unified login smoke passed${skipped ? ` (skipped ${skipped} offline SPA)` : ""}`);
