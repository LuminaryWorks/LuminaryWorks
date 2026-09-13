#!/usr/bin/env node
/**
 * Commit local changes on dev, then sync dev <-> main (latest on both).
 *
 * Usage:
 *   node scripts/sync-commit-branches.mjs
 *   node scripts/sync-commit-branches.mjs --dry-run
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
    console.log(`[dry-run] (${rel(cwd)}) ${cmd}`);
    return { ok: true, out: "" };
  }
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd}\n${out}`);
  return { ok: r.status === 0, out };
}

function rel(dir) {
  return path.relative(workspaceRoot, dir) || ".";
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

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

function ensureFetchAll(repoPath) {
  const fetchCfg = run("git config --get-all remote.origin.fetch", repoPath, { allowFail: true }).out;
  const mainOnly =
    fetchCfg.includes("refs/heads/main:refs/remotes/origin/main") &&
    !fetchCfg.includes("refs/heads/*");
  if (mainOnly) {
    run('git config --add remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"', repoPath);
  }
  run("git fetch origin --prune", repoPath);
}

function applyStash(repoPath) {
  const list = run("git stash list", repoPath, { allowFail: true }).out;
  if (!list) return;
  const first = list.split("\n")[0];
  if (!first.includes("auto-stash")) return;
  console.log(`  pop stash`);
  const pop = run("git stash pop", repoPath, { allowFail: true });
  if (!pop.ok) console.log(`  WARN stash pop conflict — resolve manually in ${rel(repoPath)}`);
}

function commitLocal(repoPath, label) {
  const dirty = run("git status --porcelain", repoPath).out;
  if (!dirty) return false;
  const n = dirty.split("\n").filter(Boolean).length;
  console.log(`  commit ${n} files`);
  run("git add -A", repoPath);
  const msg = `chore: sync local work on dev (${label})`;
  run(`git commit -m "${msg}"`, repoPath);
  return true;
}

function syncBranches(repoPath) {
  if (!run("git rev-parse --verify origin/main", repoPath, { allowFail: true }).ok) return;
  if (!run("git rev-parse --verify origin/dev", repoPath, { allowFail: true }).ok) return;

  run("git checkout dev", repoPath, { allowFail: true });
  run("git checkout -B dev", repoPath, { allowFail: true });

  const behind = Number(run("git rev-list --count origin/dev..origin/main", repoPath).out || "0");
  const ahead = Number(run("git rev-list --count origin/main..origin/dev", repoPath).out || "0");

  if (behind > 0) {
    console.log(`  merge main into dev (${behind} commits)`);
    run('git merge origin/main -m "sync: merge main into dev"', repoPath);
    run("git push origin dev", repoPath);
  }

  run("git fetch origin --prune", repoPath);
  const mainBehindDev = Number(run("git rev-list --count origin/main..dev", repoPath).out || "0");
  if (mainBehindDev > 0 || ahead > 0) {
    console.log(`  merge dev into main (${mainBehindDev || ahead} commits)`);
    run("git checkout -B main origin/main", repoPath);
    run('git merge dev -m "sync: merge dev into main"', repoPath);
    run("git push origin main", repoPath);
  }

  run("git checkout dev", repoPath);
  run("git merge origin/main --ff-only", repoPath, { allowFail: true });
  run("git push origin dev", repoPath, { allowFail: true });
}

function processRepo(repoPath) {
  const origin = run("git remote get-url origin", repoPath, { allowFail: true }).out;
  if (!origin || !ORG_PATTERN.test(origin)) return null;

  const label = rel(repoPath);
  console.log(`\n=== ${label} ===`);

  ensureFetchAll(repoPath);
  run("git checkout dev", repoPath, { allowFail: true });
  applyStash(repoPath);
  commitLocal(repoPath, label);
  syncBranches(repoPath);

  const sha = run("git rev-parse --short HEAD", repoPath, { allowFail: true }).out;
  const mainSha = run("git rev-parse --short origin/main", repoPath, { allowFail: true }).out;
  const devSha = run("git rev-parse --short origin/dev", repoPath, { allowFail: true }).out;
  const synced = mainSha === devSha ? "SYNCED" : `DIFF main=${mainSha} dev=${devSha}`;
  console.log(`  done @ ${sha} | ${synced}`);
  return synced;
}

let ok = 0;
let diff = 0;
let err = 0;

for (const repo of discoverRepos()) {
  try {
    const r = processRepo(repo);
    if (!r) continue;
    if (r === "SYNCED") ok++;
    else diff++;
  } catch (e) {
    err++;
    console.error(`ERR ${rel(repo)}: ${e.message.split("\n")[0]}`);
  }
}

console.log(`\nDone: ${ok} synced, ${diff} still differ, ${err} errors.`);
