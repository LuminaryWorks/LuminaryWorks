#!/usr/bin/env node
/**
 * Bring up (or down) a scenario as independent Compose projects, in order.
 *
 *   node scripts/scenario-up.mjs agent-commerce
 *   node scripts/scenario-up.mjs smart-site --with-control-plane
 *   node scripts/scenario-up.mjs agent-commerce down
 *
 * smart-site reuses agent-commerce project names so control-plane and product
 * databases are not deployed twice. Products are never merged into one project.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listScenarioEnvFiles, parseDotEnv } from "./init-scenario-env.mjs";
import {
  assertIndependentProjects,
  formatScenarioIssues,
  preflightScenario,
  SCENARIO_IDS,
} from "./lib/scenario-pack.mjs";
import { metaRoot } from "./lib/workspace.mjs";

function parseArgs(argv) {
  const options = {
    scenario: "agent-commerce",
    action: "up",
    withControlPlane: false,
    productRoots: process.env.PRODUCT_ROOTS,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--scenario":
        options.scenario = next();
        break;
      case "--with-control-plane":
        options.withControlPlane = true;
        break;
      case "--product-roots":
        options.productRoots = next();
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "up":
      case "down":
        options.action = arg;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (SCENARIO_IDS.includes(arg) && options.scenario === "agent-commerce") {
          options.scenario = arg;
          break;
        }
        console.error(`Unknown argument: ${arg}`);
        process.exit(78);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/scenario-up.mjs <agent-commerce|smart-site> [up|down] [options]

  --with-control-plane    Start optional lw-control first (Identity + Entitlement)
  --product-roots <spec>  Override sibling product roots
  --dry-run               Print the independent docker compose commands and exit

Scenario env files (gitignored, created by pnpm peers:init) are passed as
--env-file so Compose interpolation sees luminary-control-edge and Inbox URLs.
`);
}

function collectEnvFiles(scenario) {
  const files = [];
  const controlPlaneEnv = join(metaRoot, "deploy", "env", "control-plane.env");
  if (existsSync(controlPlaneEnv)) files.push(controlPlaneEnv);
  if (scenario === "smart-site") {
    files.push(...listScenarioEnvFiles(join(metaRoot, "deploy", "scenarios", "agent-commerce")));
  }
  files.push(...listScenarioEnvFiles(join(metaRoot, "deploy", "scenarios", scenario)));
  return [...new Set(files)].filter((file) => !file.endsWith("peers.secrets.env"));
}

function loadEnvMap(paths) {
  const extra = {};
  for (const file of paths) {
    Object.assign(extra, parseDotEnv(readFileSync(file, "utf8")));
  }
  return extra;
}

function composeArgs(item, action, envFiles) {
  const args = ["--project-name", item.project, "--project-directory", item.cwd];
  for (const file of envFiles) {
    args.push("--env-file", file);
  }
  for (const file of item.files) {
    args.push("-f", file);
  }
  if (action === "down") args.push("down");
  else args.push("up", "-d");
  return args;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  if (!SCENARIO_IDS.includes(options.scenario)) {
    console.error(`Unknown scenario "${options.scenario}"`);
    return 78;
  }

  const result = preflightScenario(options.scenario, {
    withControlPlane: options.withControlPlane,
    env: { PRODUCT_ROOTS: options.productRoots },
    cwd: metaRoot,
  });

  if (!result.ok) {
    console.error(formatScenarioIssues(result.issues));
    console.error(`[scenario] preflight failed; not invoking docker compose.`);
    return 1;
  }

  assertIndependentProjects(result.plan);

  const envFiles = collectEnvFiles(options.scenario);
  const extraEnv = loadEnvMap(envFiles);
  const sequence = options.action === "down" ? [...result.plan].reverse() : result.plan;
  for (const item of sequence) {
    const args = composeArgs(item, options.action, envFiles);
    const printable = `docker compose ${args.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ")}`;
    console.log(`[scenario] ${item.project}: ${printable}`);
    if (options.dryRun) continue;
    const spawned = spawnSync("docker", ["compose", ...args], {
      cwd: item.cwd,
      stdio: "inherit",
      shell: false,
      env: { ...process.env, ...extraEnv },
    });
    if (spawned.error?.code === "ENOENT") {
      console.error("[scenario] docker CLI not found on PATH");
      return 1;
    }
    if (spawned.status !== 0) {
      console.error(`[scenario] ${item.project} ${options.action} failed (exit ${spawned.status})`);
      return spawned.status ?? 1;
    }
  }

  console.log(
    `[scenario] ${options.action} ${options.scenario}: ${sequence.map((item) => item.project).join(" → ")}`,
  );
  return 0;
}

process.exit(main());
