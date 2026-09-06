#!/usr/bin/env node
/**
 * helm template --dry-run each chart. Skip and record when helm is not installed.
 *
 *   node scripts/helm-template-dry-run.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { metaRoot } from "./lib/workspace.mjs";

export function runHelmTemplateDryRun(options = {}) {
  const helmRoot = options.helmRoot ?? join(metaRoot, "deploy", "helm");
  const spawn = options.spawn ?? spawnSync;
  if (!existsSync(helmRoot)) {
    return { skipped: false, ok: false, reason: `helm root missing: ${helmRoot}`, charts: [] };
  }
  const probe = spawn("helm", ["version", "--short"], { encoding: "utf8", shell: false });
  if (probe.error?.code === "ENOENT" || probe.status !== 0) {
    const detail =
      probe.error?.code === "ENOENT"
        ? "helm CLI not found on PATH"
        : (probe.stderr || probe.stdout || "helm version failed").trim();
    return { skipped: true, reason: detail, charts: [] };
  }

  const charts = readdirSync(helmRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(helmRoot, entry.name, "Chart.yaml")))
    .map((entry) => entry.name)
    .sort((a, b) => {
      if (a === "luminaryworks") return 1;
      if (b === "luminaryworks") return -1;
      return a.localeCompare(b);
    });
  const results = [];
  for (const name of charts) {
    const dir = join(helmRoot, name);
    if (!existsSync(join(dir, "Chart.yaml"))) {
      results.push({ name, ok: false, reason: `Chart.yaml missing in ${dir}` });
      continue;
    }
    const args = ["template", name, dir, "--dry-run"];
    if (name === "luminaryworks") args.push("--dependency-update");
    const rendered = spawn("helm", args, { encoding: "utf8", shell: false, cwd: helmRoot });
    if (rendered.status !== 0) {
      results.push({
        name,
        ok: false,
        reason: (rendered.stderr || rendered.stdout || "helm template failed").trim(),
      });
    } else {
      results.push({ name, ok: true, reason: "templated" });
    }
  }

  return {
    skipped: false,
    reason: probe.stdout.trim(),
    charts: results,
    ok: results.every((item) => item.ok),
  };
}

function main() {
  const result = runHelmTemplateDryRun();
  if (result.skipped) {
    console.log(`[helm] SKIPPED — ${result.reason}`);
    return 0;
  }
  for (const chart of result.charts) {
    console.log(`[helm] ${chart.name}: ${chart.ok ? "OK" : "FAIL"} ${chart.reason.split("\n")[0]}`);
  }
  console.log(`[helm] ${result.ok ? "OK" : "FAIL"} — ${result.reason}`);
  return result.ok ? 0 : 1;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("helm-template-dry-run.mjs")
) {
  process.exit(main());
}
