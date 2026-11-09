#!/usr/bin/env node
/**
 * Product-facing Entitlement Docker sidecar (minimal control-plane slice).
 *
 * Starts only what products need for central commerce / membership / legal:
 *   control-plane-db → identity-redis → identity → entitlement (:3040)
 *
 * Does NOT start notification, control-console, auth-gateway, or AI platform.
 * Does NOT require opening this repo in an IDE — product MetaRepos call
 * `pnpm ent:sidecar` via a thin sibling delegate.
 *
 *   node scripts/entitlement-sidecar.mjs up
 *   node scripts/entitlement-sidecar.mjs down
 *   node scripts/entitlement-sidecar.mjs ps
 *   node scripts/entitlement-sidecar.mjs ready
 *
 * Host Nest (`pnpm ent:dev`) remains for Entitlement source changes only.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, "deploy", "env", "control-plane.env");
const example = join(root, "deploy", "env", "control-plane.env.example");
const compose = join(root, "deploy", "compose", "control-plane.yaml");
const ports = join(root, "deploy", "compose", "control-plane.dev-ports.yaml");

/** Minimal set: entitlement + its hard deps (db, redis, identity). */
const SIDECAR_SERVICES = ["control-plane-db", "identity-redis", "identity", "entitlement"];

const action = String(process.argv[2] || "up").toLowerCase();

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(envFile)) {
  fail(
    [
      "Missing deploy/env/control-plane.env",
      `  cp ${example} ${envFile}`,
      "  Fill required secrets (DB passwords, ENTITLEMENT_SERVICE_API_KEY, OIDC issuer, …).",
      "  Then re-run: pnpm ent:sidecar",
    ].join("\n"),
  );
}

const envText = readFileSync(envFile, "utf8");
let project = "luminary-works";
const projectMatch = envText.match(/^CONTROL_PLANE_PROJECT=(.+)$/m);
if (projectMatch?.[1]?.trim()) project = projectMatch[1].trim();

/**
 * Local lab often leaves a placeholder in ENTITLEMENT_LICENSE_PUBLIC_KEYS.
 * Entitlement boot requires JSON `{ kid: pem }` or empty — clear invalid values
 * for the sidecar spawn without rewriting control-plane.env.
 */
function licensePublicKeysOverride() {
  const match = envText.match(/^ENTITLEMENT_LICENSE_PUBLIC_KEYS=(.*)$/m);
  const raw = match?.[1]?.trim() ?? "";
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return undefined;
  } catch {
    // fall through
  }
  console.warn(
    [
      "WARN: ENTITLEMENT_LICENSE_PUBLIC_KEYS in control-plane.env is not a JSON object.",
      "      Sidecar will start with an empty key ring (online SaaS path).",
      "      Fix the env to `{}` or a kid→PEM JSON map when testing offline licenses.",
    ].join("\n"),
  );
  return "";
}

const licenseOverride = licensePublicKeysOverride();
const dockerEnv = {
  ...process.env,
  ...(licenseOverride !== undefined ? { ENTITLEMENT_LICENSE_PUBLIC_KEYS: licenseOverride } : {}),
};

const base = [
  "compose",
  "--env-file",
  envFile,
  "-p",
  project,
  "-f",
  compose,
  "-f",
  ports,
];

function runDocker(args) {
  const result = spawnSync("docker", args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: dockerEnv,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function ensureVolumes() {
  for (const volume of ["luminary_works_pg", "luminary_works_ai_platform_data"]) {
    spawnSync("docker", ["volume", "create", volume], {
      cwd: root,
      stdio: "ignore",
      shell: false,
    });
  }
}

async function waitReady(timeoutMs = 180_000) {
  const started = Date.now();
  const url = "http://127.0.0.1:3040/ready";
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`Entitlement ready: ${url}`);
        return;
      }
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  fail(
    [
      `Timed out waiting for ${url}.`,
      `  docker compose -p ${project} ps entitlement`,
      `  docker logs ${project}-entitlement-1 --tail 80`,
    ].join("\n"),
  );
}

if (action === "up") {
  ensureVolumes();
  // After first successful local image build, set ENTITLEMENT_SIDECAR_NO_BUILD=1 to skip rebuild.
  const build = process.env.ENTITLEMENT_SIDECAR_NO_BUILD === "1" ? [] : ["--build"];
  runDocker([...base, "up", "-d", ...build, ...SIDECAR_SERVICES]);
  // Force recreate entitlement so LICENSE override / image changes take effect.
  if (licenseOverride !== undefined) {
    runDocker([...base, "up", "-d", "--force-recreate", "entitlement"]);
  }
  console.log(
    [
      "",
      "Entitlement sidecar starting (minimal control-plane slice):",
      `  services: ${SIDECAR_SERVICES.join(", ")}`,
      "  host:     http://127.0.0.1:3040",
      "  product:  ENTITLEMENT_BASE_URL=http://localhost:3040",
      "            ENTITLEMENT_MODE=shadow_read  (local; not enforce)",
      "            ENTITLEMENT_SERVICE_API_KEY=<same as control-plane.env>",
      "  source:   pnpm ent:dev is only for editing Entitlement itself",
      "",
    ].join("\n"),
  );
  await waitReady();
} else if (action === "down" || action === "stop") {
  // Stop entitlement + identity (+ redis). Keep shared Postgres volume warm
  // unless the caller also runs ent:down / control-plane-db down.
  runDocker([...base, "stop", "entitlement", "identity", "identity-redis"]);
  console.log("Stopped entitlement + identity (+ redis). control-plane-db left running.");
} else if (action === "ps") {
  runDocker([...base, "ps", ...SIDECAR_SERVICES]);
} else if (action === "ready") {
  await waitReady(15_000);
} else {
  fail(`Usage: node scripts/entitlement-sidecar.mjs <up|down|stop|ps|ready> (got ${action})`);
}
