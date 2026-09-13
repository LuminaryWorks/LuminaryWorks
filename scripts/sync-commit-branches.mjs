#!/usr/bin/env node
/**
 * Commit local work on `dev`, then sync remote `main` with `dev`.
 *
 * Policy (daily workflow):
 * - Develop on `dev` only.
 * - Prefer merging / pushing so remote `main` catches up to `dev`.
 * - Local HEAD always returns to `dev` (never leave the working tree on `main`).
 * - Auto-merge when Git can; otherwise leave conflict on `dev` (or abort a
 *   temporary `main` merge) and print a manual checklist at the end.
 *
 * Usage:
 *   pnpm sync:commit-branches
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

/** @type {{ label: string; path: string; step: string; files: string[]; hint: string }[]} */
const conflicts = [];
/** @type {{ label: string; reason: string }[]} */
const errors = [];

function run(cmd, cwd, { allowFail = false } = {}) {
  if (DRY) {
    console.log(`[dry-run] (${rel(cwd)}) ${cmd}`);
    return { ok: true, out: "" };
  }
  const r = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd}\n${out}`);
  return { ok: r.status === 0, out, status: r.status };
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
}

function unmergedFiles(repoPath) {
  const out = run("git diff --name-only --diff-filter=U", repoPath, { allowFail: true }).out;
  return out ? out.split("\n").filter(Boolean) : [];
}

function inMerge(repoPath) {
  return (
    fs.existsSync(path.join(repoPath, ".git", "MERGE_HEAD")) ||
    unmergedFiles(repoPath).length > 0
  );
}

/** Always leave the working tree on `dev` unless an open conflict is already on `dev`. */
function ensureOnDev(repoPath) {
  const cur = run("git branch --show-current", repoPath, { allowFail: true }).out;
  if (cur === "dev") return;

  if (inMerge(repoPath)) {
    // Conflict happened while on main — abort so we can return to dev for daily work.
    console.log(`  abort merge on ${cur || "detached"} so local can stay on dev`);
    run("git merge --abort", repoPath, { allowFail: true });
  }

  run("git checkout -B dev origin/dev", repoPath, { allowFail: true });
  const after = run("git branch --show-current", repoPath, { allowFail: true }).out;
  if (after !== "dev") {
    run("git checkout -B dev", repoPath, { allowFail: true });
  }
  console.log(`  local checkout restored to: ${run("git branch --show-current", repoPath, { allowFail: true }).out || "?"}`);
}

function recordConflict(repoPath, step, hint) {
  const files = unmergedFiles(repoPath);
  conflicts.push({
    label: rel(repoPath),
    path: repoPath,
    step,
    files,
    hint,
  });
  console.log(`  CONFLICT (${step}): ${files.length || "?"} file(s) — left for manual fix`);
}

function applyStash(repoPath) {
  const list = run("git stash list", repoPath, { allowFail: true }).out;
  if (!list) return "ok";
  const first = list.split("\n")[0];
  if (!first.includes("auto-stash")) return "ok";

  console.log(`  pop stash`);
  const pop = run("git stash pop", repoPath, { allowFail: true });
  if (pop.ok) return "ok";

  const files = unmergedFiles(repoPath);
  if (files.length > 0) {
    recordConflict(
      repoPath,
      "stash pop",
      [
        `cd ${repoPath}`,
        `git checkout dev`,
        `git status`,
        `# resolve stash conflicts, then:`,
        `git add -A`,
        `git stash drop   # if stash entry still present`,
        `git commit -m "chore: apply stashed local work on dev"`,
        `git push origin dev`,
        `pnpm sync:commit-branches`,
      ].join("\n"),
    );
    return "conflict";
  }
  console.log(`  WARN stash pop: ${pop.out.split("\n")[0]}`);
  return "ok";
}

function commitLocal(repoPath, label) {
  const dirty = run("git status --porcelain", repoPath).out;
  if (!dirty) return "ok";
  if (unmergedFiles(repoPath).length > 0) return "conflict";

  const n = dirty.split("\n").filter(Boolean).length;
  console.log(`  commit ${n} files on dev`);
  run("git add -A", repoPath);
  const commit = run(`git commit -m "chore: sync local work on dev (${label})"`, repoPath, {
    allowFail: true,
  });
  if (commit.ok) return "ok";

  errors.push({
    label: rel(repoPath),
    reason: `commit failed (hook/lint?): ${commit.out.split("\n").slice(-2).join(" ")}`,
  });
  console.log(`  ERR commit: ${commit.out.split("\n")[0]}`);
  return "error";
}

/**
 * Sync strategy (stay on `dev`):
 * 1. Merge origin/main → local `dev` if main is ahead (auto or conflict on `dev`).
 * 2. Push `dev`.
 * 3. Update remote `main` by fast-forward push from `dev` (no local checkout to main).
 * 4. If ff push fails, briefly checkout `main`, merge `dev`, push, then return to `dev`.
 */
function syncBranches(repoPath) {
  if (!run("git rev-parse --verify origin/main", repoPath, { allowFail: true }).ok) return "ok";
  if (!run("git rev-parse --verify origin/dev", repoPath, { allowFail: true }).ok) return "ok";
  if (unmergedFiles(repoPath).length > 0) return "conflict";

  run("git checkout -B dev", repoPath, { allowFail: true });
  run("git branch --set-upstream-to=origin/dev dev", repoPath, { allowFail: true });

  const mainAheadOfDev = Number(
    run("git rev-list --count HEAD..origin/main", repoPath).out || "0",
  );

  if (mainAheadOfDev > 0) {
    console.log(`  merge origin/main into local dev (${mainAheadOfDev} commits)`);
    const merge = run('git merge origin/main -m "sync: merge main into dev"', repoPath, {
      allowFail: true,
    });
    if (!merge.ok) {
      if (unmergedFiles(repoPath).length > 0 || inMerge(repoPath)) {
        recordConflict(
          repoPath,
          "merge origin/main → dev",
          [
            `cd ${repoPath}`,
            `git checkout dev`,
            `git status`,
            `# resolve conflict markers, then:`,
            `git add -A`,
            `git commit -m "sync: merge main into dev"`,
            `git push origin dev`,
            `# update remote main without staying on main:`,
            `git push origin refs/heads/dev:refs/heads/main`,
            `# or re-run:`,
            `pnpm sync:commit-branches`,
          ].join("\n"),
        );
        return "conflict";
      }
      run("git merge --abort", repoPath, { allowFail: true });
      errors.push({
        label: rel(repoPath),
        reason: merge.out.split("\n").slice(-3).join(" | ") || "merge main→dev failed",
      });
      return "error";
    }
  }

  // Push local/dev commits to origin/dev
  const localAhead = Number(run("git rev-list --count origin/dev..HEAD", repoPath).out || "0");
  if (localAhead > 0) {
    console.log(`  push origin/dev (${localAhead} commits)`);
    const pushDev = run("git push origin HEAD:dev", repoPath, { allowFail: true });
    if (!pushDev.ok) {
      errors.push({ label: rel(repoPath), reason: `push origin/dev failed: ${pushDev.out}` });
      return "error";
    }
  }

  run("git fetch origin --prune", repoPath);

  const remoteMainBehind = Number(
    run("git rev-list --count origin/main..HEAD", repoPath).out || "0",
  );
  if (remoteMainBehind === 0) {
    console.log("  remote main already matches dev");
    return "ok";
  }

  // Prefer updating remote main without checking out main (fast-forward only).
  console.log(`  update remote main from dev (${remoteMainBehind} commits, prefer ff push)`);
  const ff = run("git push origin HEAD:main", repoPath, { allowFail: true });
  if (ff.ok) {
    console.log("  remote main fast-forwarded from dev (local stayed on dev)");
    return "ok";
  }

  // Non-ff: temporary checkout main, merge, push, then always return to dev.
  console.log("  ff push rejected — temporary checkout main to merge, then return to dev");
  run("git checkout -B main origin/main", repoPath);
  const mergeMain = run('git merge dev -m "sync: merge dev into main"', repoPath, {
    allowFail: true,
  });
  if (!mergeMain.ok) {
    if (unmergedFiles(repoPath).length > 0 || inMerge(repoPath)) {
      // Abort so we do not leave the user stuck on `main`.
      run("git merge --abort", repoPath, { allowFail: true });
      ensureOnDev(repoPath);
      recordConflict(
        repoPath,
        "merge dev → main (temporary)",
        [
          `cd ${repoPath}`,
          `# preferred: stay on / return to dev first`,
          `git checkout dev`,
          `# then either resolve by merging main into dev and ff-pushing:`,
          `git merge origin/main`,
          `# …fix conflicts on dev…`,
          `git push origin HEAD:dev`,
          `git push origin HEAD:main`,
          `# or briefly:`,
          `git checkout main && git merge origin/dev && git push origin main && git checkout dev`,
        ].join("\n"),
      );
      return "conflict";
    }
    run("git merge --abort", repoPath, { allowFail: true });
    ensureOnDev(repoPath);
    errors.push({
      label: rel(repoPath),
      reason: mergeMain.out.split("\n").slice(-3).join(" | ") || "merge dev→main failed",
    });
    return "error";
  }

  const pushMain = run("git push origin main", repoPath, { allowFail: true });
  ensureOnDev(repoPath);
  if (!pushMain.ok) {
    errors.push({ label: rel(repoPath), reason: `push origin/main failed: ${pushMain.out}` });
    return "error";
  }
  return "ok";
}

function processRepo(repoPath) {
  const origin = run("git remote get-url origin", repoPath, { allowFail: true }).out;
  if (!origin || !ORG_PATTERN.test(origin)) return null;

  console.log(`\n=== ${rel(repoPath)} ===`);

  try {
    ensureFetchAll(repoPath);
    run("git checkout -B dev origin/dev", repoPath, { allowFail: true });
    run("git checkout -B dev", repoPath, { allowFail: true });
    run("git branch --set-upstream-to=origin/dev dev", repoPath, { allowFail: true });

    let status = applyStash(repoPath);
    if (status === "conflict") return "conflict";

    status = commitLocal(repoPath, rel(repoPath));
    if (status === "conflict" || status === "error") return status;

    status = syncBranches(repoPath);

    const sha = run("git rev-parse --short HEAD", repoPath, { allowFail: true }).out;
    const mainSha = run("git rev-parse --short origin/main", repoPath, { allowFail: true }).out;
    const devSha = run("git rev-parse --short origin/dev", repoPath, { allowFail: true }).out;
    if (status === "ok") {
      const synced = mainSha === devSha ? "SYNCED" : `DIFF main=${mainSha} dev=${devSha}`;
      console.log(`  done @ ${sha} | ${synced} | branch=${run("git branch --show-current", repoPath, { allowFail: true }).out}`);
      return mainSha === devSha ? "synced" : "diff";
    }
    console.log(`  stopped @ ${sha} | status=${status}`);
    return status;
  } finally {
    // Never leave successful (or failed non-conflict-on-dev) worktrees on `main`.
    if (!inMerge(repoPath) || run("git branch --show-current", repoPath, { allowFail: true }).out !== "dev") {
      if (!inMerge(repoPath)) ensureOnDev(repoPath);
      else if (run("git branch --show-current", repoPath, { allowFail: true }).out !== "dev") {
        ensureOnDev(repoPath);
      }
    }
  }
}

function printConflictReport() {
  if (conflicts.length === 0 && errors.length === 0) return;

  console.log("\n" + "=".repeat(72));
  console.log("MANUAL ACTION REQUIRED");
  console.log("=".repeat(72));

  if (conflicts.length > 0) {
    console.log(`\n## Conflicts (${conflicts.length}) — need manual merge\n`);
    for (const c of conflicts) {
      console.log(`### ${c.label}`);
      console.log(`- step: ${c.step}`);
      if (c.files.length) {
        console.log(`- files:`);
        for (const f of c.files) console.log(`  - ${f}`);
      }
      console.log(`- commands:\n\`\`\`bash\n${c.hint}\n\`\`\`\n`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n## Other errors (${errors.length})\n`);
    for (const e of errors) {
      console.log(`- ${e.label}: ${e.reason}`);
    }
  }

  console.log(
    "After fixing, re-run: pnpm sync:commit-branches\n" +
      "Local checkouts should remain on `dev`. Already-synced repos skip quickly.",
  );
}

let synced = 0;
let diff = 0;
let conflictCount = 0;
let errCount = 0;

for (const repo of discoverRepos()) {
  try {
    const r = processRepo(repo);
    if (!r) continue;
    if (r === "synced") synced++;
    else if (r === "diff") diff++;
    else if (r === "conflict") conflictCount++;
    else errCount++;
  } catch (e) {
    errCount++;
    errors.push({ label: rel(repo), reason: e.message.split("\n")[0] });
    console.error(`ERR ${rel(repo)}: ${e.message.split("\n")[0]}`);
    try {
      ensureOnDev(repo);
    } catch {
      /* ignore */
    }
  }
}

console.log(
  `\nDone: ${synced} synced, ${diff} still differ, ${conflictCount} conflicts, ${errCount} errors.`,
);
printConflictReport();

if (conflictCount > 0 || errCount > 0) process.exitCode = 1;
