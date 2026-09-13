#!/usr/bin/env node
/**
 * Checkout `dev` in every local LuminaryWorks ecosystem git clone
 * (MetaRepo + nested product sub-repos under DataLuminary / BlockyEdu / …).
 *
 * Usage:
 *   pnpm checkout:dev
 *   node scripts/checkout-local-dev.mjs
 *   node scripts/checkout-local-dev.mjs --dry-run
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { metaRoot, workspaceRoot } from "./lib/workspace.mjs";

const DRY = process.argv.includes("--dry-run");

const ORG_PATTERN =
  /github\.com[^:/]*[/:](LuminaryWorks|DataLuminary|BlockyEdu|DoerFlow|VistaCast|VistaRemote|SyncroBrain)\//i;

const SCAN_ROOTS = [
  metaRoot,
  path.join(workspaceRoot, "DataLuminary"),
  path.join(workspaceRoot, "BlockyEdu"),
  path.join(workspaceRoot, "DoerFlow"),
  path.join(workspaceRoot, "VistaCast"),
  path.join(workspaceRoot, "VistaRemote"),
  path.join(workspaceRoot, "SyncroBrain"),
];

function run(cmd, cwd, { allowFail = false } = {}) {
  if (DRY) {
    console.log(`[dry-run] (${path.relative(workspaceRoot, cwd)}) ${cmd}`);
    return { ok: true, out: "" };
  }
  const r = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd}\n${out}`);
  }
  return { ok: r.status === 0, out };
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

/** Walk MetaRepos and nested clones (e.g. BlockyEdu/code-server). */
function discoverRepos() {
  const found = new Set();

  function walk(dir, depth = 0) {
    if (depth > 8 || !fs.existsSync(dir)) return;
    if (isGitRepo(dir)) found.add(path.resolve(dir));
    for (const name of fs.readdirSync(dir)) {
      if (name === "node_modules" || name === ".turbo" || name === ".git") continue;
      const child = path.join(dir, name);
      try {
        if (fs.statSync(child).isDirectory()) walk(child, depth + 1);
      } catch {
        /* ignore */
      }
    }
  }

  for (const root of SCAN_ROOTS) walk(root);
  return [...found].sort();
}

function rel(dir) {
  return path.relative(workspaceRoot, dir) || ".";
}

function checkoutDev(repoPath) {
  const origin = run("git remote get-url origin", repoPath, { allowFail: true }).out;
  if (!origin || !ORG_PATTERN.test(origin)) return null;

  const fetchCfg = run("git config --get-all remote.origin.fetch", repoPath, {
    allowFail: true,
  }).out;
  const mainOnly =
    fetchCfg.includes("refs/heads/main:refs/remotes/origin/main") &&
    !fetchCfg.includes("refs/heads/*");
  if (mainOnly) {
    run('git config --add remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"', repoPath);
  }

  run("git fetch origin --prune", repoPath);

  const hasDev = run("git rev-parse --verify origin/dev", repoPath, { allowFail: true }).ok;
  if (!hasDev) {
    console.log(`SKIP ${rel(repoPath)}: no origin/dev`);
    return { status: "skip" };
  }

  const current = run("git branch --show-current", repoPath).out;
  if (current === "dev") {
    run("git merge --ff-only origin/dev", repoPath, { allowFail: true });
    run("git branch --set-upstream-to=origin/dev dev", repoPath, { allowFail: true });
    console.log(
      `OK   ${rel(repoPath)}: already dev @ ${run("git rev-parse --short HEAD", repoPath).out}`,
    );
    return { status: "ok" };
  }

  const dirty = run("git status --porcelain", repoPath).out;
  if (dirty) {
    console.log(`  stash ${rel(repoPath)} (${dirty.split("\n").filter(Boolean).length} files)`);
    run(
      `git stash push -u -m "auto-stash before checkout dev ${new Date().toISOString().slice(0, 10)}"`,
      repoPath,
    );
  }

  run("git checkout -B dev origin/dev", repoPath);
  run("git branch --set-upstream-to=origin/dev dev", repoPath, { allowFail: true });
  run("git remote set-head origin -a", repoPath, { allowFail: true });

  const head = run("git rev-parse --short HEAD", repoPath).out;
  console.log(`OK   ${rel(repoPath)}: ${current} -> dev @ ${head}`);
  return { status: "ok" };
}

let ok = 0;
let skip = 0;
let err = 0;
/** @type {string[]} */
const notOnDev = [];

for (const repo of discoverRepos()) {
  try {
    const r = checkoutDev(repo);
    if (!r) continue;
    if (r.status === "ok") {
      ok++;
      const cur = run("git branch --show-current", repo, { allowFail: true }).out;
      if (cur !== "dev") notOnDev.push(rel(repo));
    } else {
      skip++;
      notOnDev.push(rel(repo));
    }
  } catch (e) {
    err++;
    notOnDev.push(rel(repo));
    console.error(`ERR  ${rel(repo)}: ${e.message.split("\n")[0]}`);
  }
}

console.log(`\nDone: ${ok} on/updated to dev, ${skip} skipped, ${err} errors.`);
if (notOnDev.length) {
  console.log("\nNOT on `dev` (manual check):");
  for (const p of notOnDev) console.log(`  - ${p}`);
  process.exitCode = 1;
}
