#!/usr/bin/env node
/**
 * Preflight for composable LuminaryWorks deployments.
 *
 *   node scripts/preflight-control-plane.mjs
 *   node scripts/preflight-control-plane.mjs --manifest deploy/manifests/smart-site.dev.json
 *   node scripts/preflight-control-plane.mjs --stage production --strict
 *
 * Two independent gates:
 *   1. Control Manifest validation via @luminaryworks/control-manifest
 *      (profile / capability / degradation / contract versions / secret-free).
 *   2. Compose contract checks over `docker compose config` output
 *      (no fixed container_name, no host.docker.internal, no host-port
 *      conflicts, no weak default secrets, no exposed production datastore,
 *      no floating production image tags).
 *
 * Never starts a service and never performs a liveness probe: readiness of the
 * declared services is the job of each service's own /ready endpoint.
 *
 * Exit codes: 0 ok · 1 contract violation · 78 (EX_CONFIG) unusable input.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkComposeConfig, checkManifestAgainstCompose } from "./lib/compose-contract.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const DEFAULTS = {
  manifest: "deploy/manifests/control-plane.dev.json",
  compose: ["deploy/compose/control-plane.yaml"],
  envFile: "deploy/env/control-plane.env",
};

function parseArgs(argv) {
  const options = {
    manifest: DEFAULTS.manifest,
    compose: [],
    envFile: null,
    stage: null,
    strict: false,
    skipCompose: false,
    profiles: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--manifest":
        options.manifest = next();
        break;
      case "--compose":
      case "-f":
        options.compose.push(next());
        break;
      case "--env-file":
        options.envFile = next();
        break;
      case "--stage":
        options.stage = next();
        break;
      case "--profile":
        options.profiles.push(next());
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--no-compose":
        options.skipCompose = true;
        break;
      case "--no-manifest":
        options.manifest = null;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(78);
    }
  }
  if (options.compose.length === 0) options.compose = [...DEFAULTS.compose];
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/preflight-control-plane.mjs [options]

  --manifest <path>   Control Manifest to validate (default ${DEFAULTS.manifest})
  --no-manifest       Skip manifest validation
  -f, --compose <p>   Compose file (repeatable; default ${DEFAULTS.compose.join(", ")})
  --env-file <path>   Env file for Compose interpolation (default ${DEFAULTS.envFile} when present)
  --profile <name>    Compose profile to include (repeatable, e.g. ai, observability)
  --stage <stage>     Override the stage used for Compose checks (dev|lab|pilot|production)
  --no-compose        Skip Compose checks
  --strict            Treat warnings as failures, and fail when Docker is unavailable
`);
}

function loadControlManifestModule() {
  const distEntry = join(
    repoRoot,
    "shared",
    "packages",
    "control-manifest",
    "dist",
    "index.js",
  );
  if (!existsSync(distEntry)) {
    console.error(
      `[preflight] @luminaryworks/control-manifest is not built.\n` +
        `            Run: pnpm --dir shared/packages/control-manifest run build`,
    );
    process.exit(78);
  }
  return require(distEntry);
}

function runDockerComposeConfig(options) {
  const args = [];
  if (options.envFile) args.push("--env-file", options.envFile);
  for (const file of options.compose) args.push("-f", file);
  for (const profile of options.profiles) args.push("--profile", profile);
  args.push("config", "--format", "json");

  const result = spawnSync("docker", ["compose", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });

  if (result.error?.code === "ENOENT") {
    return { unavailable: true, reason: "docker CLI not found on PATH" };
  }
  if (result.status !== 0) {
    return {
      failed: true,
      reason: (result.stderr || result.stdout || "docker compose config failed").trim(),
    };
  }
  try {
    return { config: JSON.parse(result.stdout) };
  } catch (err) {
    return { failed: true, reason: `could not parse compose config JSON: ${err.message}` };
  }
}

function report(label, issues) {
  for (const item of issues) {
    const target = item.target ?? item.path ?? "(root)";
    const line = `  [${item.severity}] ${target}: ${item.message}`;
    if (item.severity === "error") console.error(line);
    else console.warn(line);
  }
  const errors = issues.filter((item) => item.severity === "error").length;
  const warnings = issues.length - errors;
  console.log(`  ${label}: ${errors} error(s), ${warnings} warning(s)`);
  return { errors, warnings };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }

  if (!options.envFile) {
    const fallback = join(repoRoot, DEFAULTS.envFile);
    if (existsSync(fallback)) options.envFile = DEFAULTS.envFile;
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  let manifest = null;
  let stage = options.stage;

  if (options.manifest) {
    const manifestPath = resolve(repoRoot, options.manifest);
    if (!existsSync(manifestPath)) {
      console.error(`[preflight] manifest not found: ${manifestPath}`);
      return 78;
    }
    const { inspectControlManifest, describeAiCentralGate } = loadControlManifestModule();
    const raw = readFileSync(manifestPath, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) {
      console.error(`[preflight] ${options.manifest} starts with a UTF-8 BOM; save as UTF-8 without BOM.`);
      totalErrors += 1;
    }

    console.log(`[preflight] Control Manifest: ${options.manifest}`);
    const { result, manifest: parsed } = inspectControlManifest(raw);
    const counts = report("manifest", [...result.errors, ...result.warnings]);
    totalErrors += counts.errors;
    totalWarnings += counts.warnings;

    if (parsed) {
      manifest = parsed;
      stage = stage ?? parsed.stage;
      console.log(
        `  profile=${parsed.profile} stage=${parsed.stage} identity=${parsed.capabilities.identity} entitlement=${parsed.capabilities.entitlement} ai=${parsed.capabilities.ai} notification=${parsed.capabilities.notification}`,
      );
      if (parsed.capabilities.ai === "central") {
        const gate = describeAiCentralGate();
        console.warn(
          `  [warning] capabilities.ai=central is dev/lab only — outstanding hardening: ${gate.blockers.join(", ")}`,
        );
        totalWarnings += 1;
      }
    }
  }

  stage = stage ?? "dev";

  if (!options.skipCompose) {
    console.log(
      `[preflight] Compose contract (stage=${stage}): ${options.compose.join(", ")}${options.envFile ? ` (env ${options.envFile})` : ""}`,
    );
    const outcome = runDockerComposeConfig(options);

    if (outcome.unavailable) {
      const message = `Docker unavailable — Compose checks skipped (${outcome.reason})`;
      if (options.strict) {
        console.error(`  [error] ${message}`);
        totalErrors += 1;
      } else {
        console.warn(`  [warning] ${message}`);
        totalWarnings += 1;
      }
    } else if (outcome.failed) {
      console.error(`  [error] docker compose config failed: ${outcome.reason}`);
      totalErrors += 1;
    } else {
      const { issues, serviceNames } = checkComposeConfig(outcome.config, { stage });
      const all = manifest
        ? [...issues, ...checkManifestAgainstCompose(manifest, serviceNames)]
        : issues;
      const counts = report("compose", all);
      totalErrors += counts.errors;
      totalWarnings += counts.warnings;
      console.log(`  services: ${serviceNames.join(", ")}`);
    }
  }

  const failed = totalErrors > 0 || (options.strict && totalWarnings > 0);
  console.log(
    `[preflight] ${failed ? "FAIL" : "OK"} — ${totalErrors} error(s), ${totalWarnings} warning(s)`,
  );
  return failed ? 1 : 0;
}

process.exit(main());
