#!/usr/bin/env node
/**
 * Preflight for the optional object-storage Compose profile.
 *
 *   node scripts/preflight-object-storage.mjs
 *   node scripts/preflight-object-storage.mjs --env-file deploy/env/control-plane.env
 *   node scripts/preflight-object-storage.mjs --strict --compose-config
 *
 * Never starts AIStor and never pulls the image. --compose-config runs
 * `docker compose config` only (interpolation + contract), which still
 * requires a license *path* that exists on disk — not a valid license.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDotEnv } from "./init-scenario-env.mjs";
import { checkComposeConfig } from "./lib/compose-contract.mjs";
import {
  OBJECT_STORAGE_COMPOSE_OVERLAY,
  checkObjectStorageCompose,
  overlaySecurityProperties,
  overlayUsesRequiredVars,
  preflightObjectStorageEnv,
} from "./lib/object-storage.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    envFile: "deploy/env/control-plane.env",
    overlay: OBJECT_STORAGE_COMPOSE_OVERLAY,
    core: "deploy/compose/control-plane.yaml",
    composeConfig: false,
    strict: false,
    skipLicenseStat: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--env-file":
        options.envFile = next();
        break;
      case "--overlay":
        options.overlay = next();
        break;
      case "--compose-config":
        options.composeConfig = true;
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--skip-license-stat":
        options.skipLicenseStat = true;
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
  return options;
}

function report(label, issues) {
  for (const item of issues) {
    const line = `  [${item.severity}] ${item.target}: ${item.message}`;
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
    console.log(`Usage: node scripts/preflight-object-storage.mjs [options]

  --env-file <path>     Env for AISTOR_* (default deploy/env/control-plane.env)
  --overlay <path>      Overlay compose file
  --compose-config      Also run docker compose config (no up, no pull)
  --strict              Fail on warnings; fail if Docker is missing when --compose-config
  --skip-license-stat   Do not require the license file to exist (unit tests)

Fails clearly without license path, pinned images, root credentials, or product secrets.
Does not download AIStor and does not fabricate a license.
`);
    return 0;
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  const overlayPath = resolve(repoRoot, options.overlay);
  if (!existsSync(overlayPath)) {
    console.error(`[preflight-object-storage] overlay not found: ${overlayPath}`);
    return 78;
  }
  const overlayText = readFileSync(overlayPath, "utf8");
  if (overlayText.includes("\uFFFD")) {
    console.error("[preflight-object-storage] overlay contains U+FFFD; re-save as UTF-8 no BOM.");
    return 1;
  }

  console.log(`[preflight-object-storage] overlay ${options.overlay}`);
  const required = overlayUsesRequiredVars(overlayText);
  if (!required.ok) {
    console.error(`  [error] overlay missing \${VAR:?} for: ${required.missing.join(", ")}`);
    totalErrors += 1;
  }
  const props = overlaySecurityProperties(overlayText);
  const failedProps = Object.entries(props)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  if (failedProps.length) {
    console.error(`  [error] overlay security properties failed: ${failedProps.join(", ")}`);
    totalErrors += 1;
  } else {
    console.log("  overlay security properties: ok");
  }

  const envPath = resolve(repoRoot, options.envFile);
  let env = {};
  if (!existsSync(envPath)) {
    console.error(
      `[preflight-object-storage] env file not found: ${options.envFile}. Copy deploy/env/control-plane.env.example and fill AISTOR_* (license, pinned images, root, product secrets).`,
    );
    totalErrors += 1;
  } else {
    env = parseDotEnv(readFileSync(envPath, "utf8"));
    console.log(`[preflight-object-storage] env ${options.envFile}`);
    const result = preflightObjectStorageEnv(env, { skipLicenseStat: options.skipLicenseStat });
    const counts = report("env", result.issues);
    totalErrors += counts.errors;
    totalWarnings += counts.warnings;
  }

  if (options.composeConfig) {
    console.log("[preflight-object-storage] docker compose config (no up)");
    const args = [];
    if (existsSync(envPath)) args.push("--env-file", options.envFile);
    args.push(
      "-f",
      options.core,
      "-f",
      options.overlay,
      "--profile",
      "object-storage",
      "config",
      "--format",
      "json",
    );
    const result = spawnSync("docker", ["compose", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
    });
    if (result.error?.code === "ENOENT") {
      const message = "Docker unavailable — compose config skipped";
      if (options.strict) {
        console.error(`  [error] ${message}`);
        totalErrors += 1;
      } else {
        console.warn(`  [warning] ${message}`);
        totalWarnings += 1;
      }
    } else if (result.status !== 0) {
      console.error(`  [error] docker compose config failed: ${(result.stderr || result.stdout || "").trim()}`);
      totalErrors += 1;
    } else {
      const config = JSON.parse(result.stdout);
      const composeIssues = [
        ...checkComposeConfig(config, { stage: "production" }).issues,
        ...checkObjectStorageCompose(config).issues,
      ];
      const counts = report("compose", composeIssues);
      totalErrors += counts.errors;
      totalWarnings += counts.warnings;
    }
  }

  const failed = totalErrors > 0 || (options.strict && totalWarnings > 0);
  console.log(
    `[preflight-object-storage] ${failed ? "FAIL" : "OK"} — ${totalErrors} error(s), ${totalWarnings} warning(s)`,
  );
  return failed ? 1 : 0;
}

process.exit(main());
