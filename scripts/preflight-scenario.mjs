#!/usr/bin/env node
/**
 * Scenario pack preflight — product Compose presence + Control Manifest gates.
 *
 *   node scripts/preflight-scenario.mjs --scenario agent-commerce
 *   node scripts/preflight-scenario.mjs --scenario smart-site --with-control-plane
 *
 * Never starts a container. Never runs `docker compose config` on product files.
 * Control-plane Compose contract stays in scripts/preflight-control-plane.mjs.
 *
 * Exit codes: 0 ok · 1 contract violation · 78 (EX_CONFIG) unusable input.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { formatScenarioIssues, preflightScenario, SCENARIO_IDS } from "./lib/scenario-pack.mjs";
import { metaRoot } from "./lib/workspace.mjs";

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const options = {
    scenario: "agent-commerce",
    withControlPlane: false,
    productRoots: process.env.PRODUCT_ROOTS,
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

function printHelp() {
  console.log(`Usage: node scripts/preflight-scenario.mjs [options]

  --scenario <id>         agent-commerce | smart-site (default agent-commerce)
  --with-control-plane    Include optional lw-control project (does not merge it)
  --product-roots <spec>  Override sibling roots: vistacast=/abs,doerflow=/abs
                          or JSON object. Default: ../<ProductDir> from MetaRepo.
`);
}

function loadControlManifestModule() {
  const distEntry = join(metaRoot, "shared", "packages", "control-manifest", "dist", "index.js");
  if (!existsSync(distEntry)) return null;
  return require(distEntry);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  if (!SCENARIO_IDS.includes(options.scenario)) {
    console.error(
      `[preflight] unknown scenario "${options.scenario}". Known: ${SCENARIO_IDS.join(", ")}`,
    );
    return 78;
  }

  console.log(
    `[preflight] scenario=${options.scenario} control-plane=${options.withControlPlane ? "optional-on" : "skipped"}`,
  );
  const result = preflightScenario(options.scenario, {
    withControlPlane: options.withControlPlane,
    env: { PRODUCT_ROOTS: options.productRoots },
    cwd: metaRoot,
  });

  if (result.manifest) {
    const cm = loadControlManifestModule();
    if (cm) {
      const { inspectControlManifest } = cm;
      const inspected = inspectControlManifest(result.manifest);
      for (const item of [...inspected.result.errors, ...inspected.result.warnings]) {
        result.issues.push({
          severity: item.severity,
          code: item.code,
          target: item.path ?? "(manifest)",
          message: item.message,
        });
      }
    } else {
      console.warn(
        "  [warning] @luminaryworks/control-manifest is not built; scenario pack still applied the ai=central stage gate locally. Run: pnpm --dir shared/packages/control-manifest run build",
      );
    }
  }

  const errors = result.issues.filter((item) => item.severity === "error");
  const warnings = result.issues.filter((item) => item.severity === "warning");
  if (result.issues.length) console.log(formatScenarioIssues(result.issues));
  console.log(`  projects: ${result.plan.map((item) => item.project).join(" → ") || "(none)"}`);
  const failed = errors.length > 0;
  console.log(
    `[preflight] ${failed ? "FAIL" : "OK"} — ${errors.length} error(s), ${warnings.length} warning(s)`,
  );
  return failed ? 1 : 0;
}

process.exit(main());
