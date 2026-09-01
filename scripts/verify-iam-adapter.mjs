/**
 * IAM Adapter acceptance: catalog unit tests + Playwright login-panel modes
 * + live Logto discovery when identity is up.
 *
 * Usage:
 *   node scripts/verify-iam-adapter.mjs [--headed] [--skip-live] [--skip-login]
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const metaRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const authReactDir = join(metaRoot, "shared", "packages", "auth-react");
const authCoreDir = join(metaRoot, "shared", "packages", "auth-core");
const identityDir = join(metaRoot, "identity");
const IDP_ORIGIN = (process.env.IDP_ORIGIN || "http://localhost:3001").replace(/\/$/, "");
const argv = new Set(process.argv.slice(2));

if (argv.has("--help")) {
  console.log("Usage: node scripts/verify-iam-adapter.mjs [--headed] [--skip-live] [--skip-login]");
  process.exit(0);
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function runNodeTests(cwd, files) {
  run("node", ["--test", ...files], cwd);
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

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

async function verifyLiveLogto() {
  const discoveryUrl = `${IDP_ORIGIN}/oidc/.well-known/openid-configuration`;
  const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`Logto discovery returned ${response.status}`);
  const discovery = await response.json();
  if (discovery.issuer !== `${IDP_ORIGIN}/oidc`) {
    throw new Error(`expected issuer ${IDP_ORIGIN}/oidc, got ${discovery.issuer}`);
  }
  if (!discovery.authorization_endpoint || !discovery.jwks_uri) {
    throw new Error("discovery is missing authorization_endpoint or jwks_uri");
  }
  const jwks = await fetch(discovery.jwks_uri, { signal: AbortSignal.timeout(7000) });
  if (!jwks.ok) throw new Error(`JWKS returned ${jwks.status}`);
  const body = await jwks.json();
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error("JWKS has no keys");
  }
  return discovery.issuer;
}

async function bundleLoginPanel() {
  const outDir = join(authReactDir, "test", ".iam-fixture");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, "panel.js");
  const esbuildBin = join(authReactDir, "node_modules", ".bin", "esbuild");
  if (!existsSync(esbuildBin)) {
    throw new Error("esbuild binary missing; run pnpm install in shared/packages/auth-react");
  }
  execFileSync(
    esbuildBin,
    [
      join(authReactDir, "test", "iam-login-panel.fixture.tsx"),
      "--bundle",
      "--format=iife",
      "--platform=browser",
      `--outfile=${outfile}`,
      "--jsx=automatic",
      "--log-level=error",
    ],
    { cwd: authReactDir, stdio: "inherit" },
  );
  writeFileSync(
    join(outDir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>IAM login fixture</title></head><body><div id="root"></div><script src="/panel.js"></script></body></html>\n`,
  );
  return outDir;
}

function startStaticServer(rootDir) {
  const files = new Map([
    ["/", "index.html"],
    ["/index.html", "index.html"],
    ["/panel.js", "panel.js"],
  ]);
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const name = files.get(url.pathname);
      if (!name) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      const body = readFileSync(join(rootDir, name));
      response.writeHead(200, {
        "Content-Type": name.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8",
      });
      response.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function verifyLoginPanel(browser, origin, provider, expectPassword) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${origin}/?provider=${provider}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    try {
      await page.getByText(new RegExp(`IAM ${provider}`, "i")).waitFor({
        state: "visible",
        timeout: 10000,
      });
    } catch (error) {
      const html = await page.content();
      throw new Error(
        `${message(error)}; pageerror=${errors.join(" | ") || "none"}; html=${html.replace(/\s+/g, " ").slice(0, 800)}`,
      );
    }
    const identifier = page.locator('input[name="identifier"]');
    const password = page.locator('input[name="password"]');
    const sso = page.getByRole("button", { name: /continue with unified account/i });
    if (expectPassword) {
      await identifier.waitFor({ state: "visible", timeout: 5000 });
      await password.waitFor({ state: "visible", timeout: 3000 });
      if (await sso.isVisible().catch(() => false)) {
        throw new Error(`${provider} unexpectedly showed hosted SSO`);
      }
      return "Headless password form";
    }
    await sso.waitFor({ state: "visible", timeout: 5000 });
    if (await identifier.isVisible().catch(() => false)) {
      throw new Error(`${provider} unexpectedly showed a password form`);
    }
    return "Hosted SSO button";
  } finally {
    await page.close();
  }
}

console.log("IAM Adapter verification");

console.log("\n▶ identity catalog / management factory");
runNodeTests(identityDir, [
  "scripts/lib/iam-provider.test.mjs",
  "scripts/lib/logto-management-provider.test.mjs",
]);

console.log("\n▶ auth-core runtime + IAM catalog");
run("pnpm", ["test"], authCoreDir);

console.log("\n▶ auth-react login experience factory");
run("pnpm", ["test"], authReactDir);

const results = [];

if (!argv.has("--skip-live")) {
  console.log(`\n▶ live Logto discovery (${IDP_ORIGIN})`);
  try {
    const issuer = await verifyLiveLogto();
    console.log(`  ✓ default IdP still Logto: ${issuer}`);
    results.push({ name: "live Logto discovery", status: "PASS", detail: issuer });
  } catch (error) {
    const detail = message(error);
    console.log(`  ↷ skipped: ${detail}`);
    results.push({ name: "live Logto discovery", status: "SKIP", detail });
  }
}

console.log("\n▶ Playwright Headless vs Hosted login panel");
const fixtureDir = await bundleLoginPanel();
const { server, origin } = await startStaticServer(fixtureDir);
const browser = await (await loadChromium()).launch({ headless: !argv.has("--headed") });
try {
  const logtoMode = await verifyLoginPanel(browser, origin, "logto", true);
  console.log(`  ✓ logto → ${logtoMode}`);
  results.push({ name: "Playwright logto Headless", status: "PASS", detail: logtoMode });

  const zitadelMode = await verifyLoginPanel(browser, origin, "zitadel", false);
  console.log(`  ✓ zitadel → ${zitadelMode}`);
  results.push({ name: "Playwright zitadel Hosted", status: "PASS", detail: zitadelMode });

  const oidcMode = await verifyLoginPanel(browser, origin, "oidc", false);
  console.log(`  ✓ oidc → ${oidcMode}`);
  results.push({ name: "Playwright oidc Hosted", status: "PASS", detail: oidcMode });
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (!argv.has("--skip-login")) {
  console.log("\n▶ product login regression (allow-skip offline SPAs)");
  run("node", [join(metaRoot, "scripts", "verify-unified-login.mjs"), "--allow-skip"], metaRoot);
}

console.log("\nIAM Adapter summary");
for (const result of results) {
  const marker = result.status === "PASS" ? "✓" : result.status === "SKIP" ? "↷" : "✗";
  console.log(`${marker} ${result.status.padEnd(4)} ${result.name}: ${result.detail}`);
}

if (results.some((result) => result.status === "FAIL")) {
  process.exit(1);
}
console.log("✓ IAM Adapter verification passed");
