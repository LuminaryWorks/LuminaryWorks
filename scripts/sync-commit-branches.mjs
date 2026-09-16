#!/usr/bin/env node
/**
 * Commit local work, fold into `dev`, then sync remote `main` — and push both.
 *
 * Per-repo policy:
 * 1. Commit uncommitted changes on the *current* branch first.
 * 2. If not on `dev`: checkout local `dev` (never reset away local tip), merge
 *    the source branch into `dev`.
 * 3. If already on `dev`: stay; commits already on `dev`.
 * 4. Merge remote `main` into `dev` when main is ahead (auto or conflict list).
 * 5. Push `dev` and update remote `main` from `dev`.
 * 6. Local checkout always ends on `dev` (except open conflict left on `dev`).
 *
 * Usage:
 *   pnpm sync:commit-branches
 *   node scripts/sync-commit-branches.mjs
 *   node scripts/sync-commit-branches.mjs --dry-run
 *   node scripts/sync-commit-branches.mjs --dry-run --only=VistaCast/desktop
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { metaRoot, workspaceRoot } from "./lib/workspace.mjs";

const DRY = process.argv.includes("--dry-run");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length);
const DEV = "dev";
const MAIN = "main";

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

/** Read-only probes — always run under --dry-run so the preview reflects real state. */
const READ_CMD =
  /^(git remote get-url|git status --porcelain|git rev-parse|git merge-base|git rev-list|git branch --show-current|git branch --list|git for-each-ref|git diff --name-only|git stash list|git config --get)/;

/** @type {{ label: string; path: string; step: string; files: string[]; hint: string }[]} */
const conflicts = [];
/** @type {{ label: string; reason: string }[]} */
const errors = [];

function run(cmd, cwd, { allowFail = false, readOnly = false } = {}) {
  const isRead = readOnly || READ_CMD.test(cmd) || /^git fetch\b/.test(cmd);
  if (DRY && !isRead) {
    console.log(`  [dry-run] ${cmd}`);
    return { ok: true, out: "", status: 0 };
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
  const gitPath = path.join(dir, ".git");
  if (!fs.existsSync(gitPath)) return false;
  try {
    if (fs.statSync(gitPath).isFile()) return false;
  } catch {
    return false;
  }
  if (dir.split(path.sep).includes(".worktrees")) return false;
  return true;
}

function discoverRepos() {
  const found = new Set();
  function walk(dir, depth = 0) {
    if (depth > 8 || !fs.existsSync(dir)) return;
    if (isGitRepo(dir)) found.add(path.resolve(dir));
    for (const name of fs.readdirSync(dir)) {
      if (
        name === "node_modules" ||
        name === ".turbo" ||
        name === ".git" ||
        name === ".worktrees"
      ) {
        continue;
      }
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

function hasRef(repoPath, ref) {
  return run(`git rev-parse --verify ${ref}`, repoPath, { allowFail: true }).ok;
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

/** Checkout local DEV without resetting away unpushed local commits. */
function checkoutDevPreserveLocal(repoPath) {
  if (hasRef(repoPath, "refs/heads/" + DEV)) {
    run(`git checkout ${DEV}`, repoPath);
    return;
  }

  if (hasRef(repoPath, "origin/" + DEV)) {
    console.log(`  create local ${DEV} from origin/${DEV}`);
    run(`git checkout -b ${DEV} origin/${DEV}`, repoPath);
    return;
  }

  if (hasRef(repoPath, "origin/" + MAIN)) {
    console.log(`  create local ${DEV} from origin/${MAIN} (no origin/${DEV} yet)`);
    run(`git checkout -b ${DEV} origin/${MAIN}`, repoPath);
    return;
  }

  console.log(`  create local ${DEV} from current HEAD`);
  run(`git checkout -b ${DEV}`, repoPath);
}

function ensureOnDev(repoPath) {
  const cur = run("git branch --show-current", repoPath, { allowFail: true }).out;
  if (cur === DEV) return;

  if (inMerge(repoPath)) {
    console.log(`  abort merge on ${cur || "detached"} so local can stay on ${DEV}`);
    run("git merge --abort", repoPath, { allowFail: true });
  }

  try {
    checkoutDevPreserveLocal(repoPath);
  } catch (e) {
    console.log(`  WARN could not return to ${DEV}: ${e.message.split("\n")[0]}`);
  }
  run(`git branch --set-upstream-to=origin/${DEV} ${DEV}`, repoPath, { allowFail: true });
}

function applyStash(repoPath) {
  const list = run("git stash list", repoPath, { allowFail: true }).out;
  if (!list) return "ok";
  const first = list.split("\n")[0];
  if (!first.includes("auto-stash")) return "ok";

  console.log("  pop auto-stash onto current branch");
  const pop = run("git stash pop", repoPath, { allowFail: true });
  if (pop.ok) return "ok";

  if (unmergedFiles(repoPath).length > 0) {
    recordConflict(
      repoPath,
      "stash pop",
      [
        `cd ${repoPath}`,
        "git status",
        "# resolve stash conflicts, then:",
        "git add -A",
        "git stash drop   # if stash entry still present",
        'git commit -m "chore: apply stashed local work"',
        "pnpm sync:commit-branches",
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

  const branch = run("git branch --show-current", repoPath, { allowFail: true }).out || "detached";
  const n = dirty.split("\n").filter(Boolean).length;
  console.log(`  commit ${n} files on ${branch}`);
  run("git add -A", repoPath);
  const commit = run(
    `git commit -m "chore: sync local work on ${branch} (${label})"`,
    repoPath,
    { allowFail: true },
  );
  if (commit.ok) return "ok";

  errors.push({
    label: rel(repoPath),
    reason: `commit failed (hook/lint?): ${commit.out.split("\n").slice(-2).join(" ")}`,
  });
  console.log(`  ERR commit: ${commit.out.split("\n")[0]}`);
  return "error";
}

function foldCurrentIntoDev(repoPath) {
  const source = run("git branch --show-current", repoPath, { allowFail: true }).out || "";
  const sourceSha = run("git rev-parse HEAD", repoPath).out;

  if (source === DEV) {
    console.log(`  already on ${DEV}`);
    return "ok";
  }

  const label = source || sourceSha.slice(0, 7);
  console.log(`  fold ${label} → ${DEV}`);

  // Decide whether DEV already contains source *before* checkout, using the
  // DEV tip we will land on (local DEV / origin/DEV / origin/MAIN) — not HEAD
  // after a dry-run no-op checkout (which would still be the source tip).
  let devTip = null;
  if (hasRef(repoPath, "refs/heads/" + DEV)) {
    devTip = run("git rev-parse refs/heads/" + DEV, repoPath).out;
  } else if (hasRef(repoPath, "origin/" + DEV)) {
    devTip = run("git rev-parse origin/" + DEV, repoPath).out;
  } else if (hasRef(repoPath, "origin/" + MAIN)) {
    devTip = run("git rev-parse origin/" + MAIN, repoPath).out;
  }

  const already =
    Boolean(devTip) &&
    run(`git merge-base --is-ancestor ${sourceSha} ${devTip}`, repoPath, {
      allowFail: true,
    }).ok;

  try {
    checkoutDevPreserveLocal(repoPath);
  } catch (e) {
    errors.push({
      label: rel(repoPath),
      reason: `checkout ${DEV} failed: ${e.message.split("\n")[0]}`,
    });
    return "error";
  }

  if (already) {
    console.log(`  ${DEV} already contains ${label}`);
    return "ok";
  }

  const mergeRef = source || sourceSha;
  const merge = run(
    `git merge ${mergeRef} -m "sync: merge ${label} into ${DEV}"`,
    repoPath,
    { allowFail: true },
  );
  if (!merge.ok) {
    if (unmergedFiles(repoPath).length > 0 || inMerge(repoPath)) {
      recordConflict(
        repoPath,
        `merge ${label} → ${DEV}`,
        [
          `cd ${repoPath}`,
          `git checkout ${DEV}`,
          "git status",
          "# resolve conflict markers, then:",
          "git add -A",
          `git commit -m "sync: merge ${label} into ${DEV}"`,
          `git push origin HEAD:${DEV}`,
          `git push origin HEAD:${MAIN}`,
          "# or: pnpm sync:commit-branches",
        ].join("\n"),
      );
      return "conflict";
    }
    run("git merge --abort", repoPath, { allowFail: true });
    errors.push({
      label: rel(repoPath),
      reason: merge.out.split("\n").slice(-3).join(" | ") || `merge ${label}→${DEV} failed`,
    });
    return "error";
  }

  return "ok";
}

function syncMainFromDev(repoPath) {
  if (!hasRef(repoPath, "origin/" + MAIN) && !hasRef(repoPath, "refs/heads/" + MAIN)) {
    console.log(`  no ${MAIN} branch — skip ${MAIN} sync (will still push ${DEV})`);
  }
  if (unmergedFiles(repoPath).length > 0) return "conflict";

  run(`git branch --set-upstream-to=origin/${DEV} ${DEV}`, repoPath, { allowFail: true });

  if (hasRef(repoPath, "origin/" + MAIN)) {
    const mainAheadOfDev = Number(
      run("git rev-list --count HEAD..origin/" + MAIN, repoPath).out || "0",
    );
    if (mainAheadOfDev > 0) {
      console.log(`  merge origin/${MAIN} into local ${DEV} (${mainAheadOfDev} commits)`);
      const merge = run(
        `git merge origin/${MAIN} -m "sync: merge ${MAIN} into ${DEV}"`,
        repoPath,
        { allowFail: true },
      );
      if (!merge.ok) {
        if (unmergedFiles(repoPath).length > 0 || inMerge(repoPath)) {
          recordConflict(
            repoPath,
            `merge origin/${MAIN} → ${DEV}`,
            [
              `cd ${repoPath}`,
              `git checkout ${DEV}`,
              "git status",
              "# resolve, then:",
              "git add -A",
              `git commit -m "sync: merge ${MAIN} into ${DEV}"`,
              `git push origin HEAD:${DEV}`,
              `git push origin HEAD:${MAIN}`,
              "pnpm sync:commit-branches",
            ].join("\n"),
          );
          return "conflict";
        }
        run("git merge --abort", repoPath, { allowFail: true });
        errors.push({
          label: rel(repoPath),
          reason: merge.out.split("\n").slice(-3).join(" | ") || `merge ${MAIN}→${DEV} failed`,
        });
        return "error";
      }
    }
  }

  const remoteDev = hasRef(repoPath, "origin/" + DEV);
  const localAhead = remoteDev
    ? Number(run("git rev-list --count origin/" + DEV + "..HEAD", repoPath).out || "0")
    : 1;
  if (!remoteDev || localAhead > 0) {
    console.log(
      remoteDev
        ? `  push origin/${DEV} (${localAhead} commits)`
        : `  push origin/${DEV} (create remote branch)`,
    );
    const pushDev = run(`git push -u origin HEAD:${DEV}`, repoPath, { allowFail: true });
    if (!pushDev.ok) {
      errors.push({
        label: rel(repoPath),
        reason: `push origin/${DEV} failed: ${pushDev.out}`,
      });
      return "error";
    }
  } else {
    console.log(`  origin/${DEV} already up to date`);
  }

  run("git fetch origin --prune", repoPath);

  if (!hasRef(repoPath, "origin/" + MAIN)) {
    console.log(`  create remote ${MAIN} from ${DEV}`);
    const createMain = run(`git push origin HEAD:${MAIN}`, repoPath, { allowFail: true });
    if (!createMain.ok) {
      errors.push({
        label: rel(repoPath),
        reason: `create origin/${MAIN} failed: ${createMain.out}`,
      });
      return "error";
    }
    return "ok";
  }

  const remoteMainBehind = Number(
    run("git rev-list --count origin/" + MAIN + "..HEAD", repoPath).out || "0",
  );
  if (remoteMainBehind === 0) {
    console.log(`  remote ${MAIN} already matches ${DEV}`);
    return "ok";
  }

  console.log(
    `  update remote ${MAIN} from ${DEV} (${remoteMainBehind} commits, prefer ff push)`,
  );
  const ff = run(`git push origin HEAD:${MAIN}`, repoPath, { allowFail: true });
  if (ff.ok) {
    console.log(`  remote ${MAIN} fast-forwarded from ${DEV} (local stayed on ${DEV})`);
    return "ok";
  }

  console.log(
    `  ff push rejected — temporary checkout ${MAIN} to merge, then return to ${DEV}`,
  );
  run(`git checkout -B ${MAIN} origin/${MAIN}`, repoPath);
  const mergeMain = run(
    `git merge ${DEV} -m "sync: merge ${DEV} into ${MAIN}"`,
    repoPath,
    { allowFail: true },
  );
  if (!mergeMain.ok) {
    if (unmergedFiles(repoPath).length > 0 || inMerge(repoPath)) {
      run("git merge --abort", repoPath, { allowFail: true });
      ensureOnDev(repoPath);
      recordConflict(
        repoPath,
        `merge ${DEV} → ${MAIN} (temporary)`,
        [
          `cd ${repoPath}`,
          `git checkout ${DEV}`,
          `git merge origin/${MAIN}`,
          `# … fix on ${DEV}…`,
          `git push origin HEAD:${DEV}`,
          `git push origin HEAD:${MAIN}`,
        ].join("\n"),
      );
      return "conflict";
    }
    run("git merge --abort", repoPath, { allowFail: true });
    ensureOnDev(repoPath);
    errors.push({
      label: rel(repoPath),
      reason: mergeMain.out.split("\n").slice(-3).join(" | ") || `merge ${DEV}→${MAIN} failed`,
    });
    return "error";
  }

  const pushMain = run(`git push origin ${MAIN}`, repoPath, { allowFail: true });
  ensureOnDev(repoPath);
  if (!pushMain.ok) {
    errors.push({ label: rel(repoPath), reason: `push origin/${MAIN} failed: ${pushMain.out}` });
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

    if (inMerge(repoPath) && unmergedFiles(repoPath).length > 0) {
      recordConflict(
        repoPath,
        "pre-existing merge",
        [`cd ${repoPath}`, "git status", "# finish or: git merge --abort"].join("\n"),
      );
      return "conflict";
    }

    let status = applyStash(repoPath);
    if (status === "conflict") return "conflict";

    // 1) Commit dirty work on *current* branch first.
    status = commitLocal(repoPath, rel(repoPath));
    if (status === "conflict" || status === "error") return status;

    // 2) If not on DEV, fold current branch into DEV.
    status = foldCurrentIntoDev(repoPath);
    if (status === "conflict" || status === "error") return status;

    // 3) Push DEV and align remote MAIN.
    status = syncMainFromDev(repoPath);

    const sha = run("git rev-parse --short HEAD", repoPath, { allowFail: true }).out;
    const branch = run("git branch --show-current", repoPath, { allowFail: true }).out;
    const mainSha = hasRef(repoPath, "origin/" + MAIN)
      ? run("git rev-parse --short origin/" + MAIN, repoPath, { allowFail: true }).out
      : "";
    const DEV_SHA = hasRef(repoPath, "origin/" + DEV)
      ? run("git rev-parse --short origin/" + DEV, repoPath, { allowFail: true }).out
      : "";

    if (status === "ok") {
      // Under --dry-run pushes did not happen — report WOULD_SYNC, not a false SYNCED.
      if (DRY) {
        console.log(`  done @ ${sha} | WOULD_SYNC | branch=${branch}`);
        return "synced";
      }
      const headFull = run("git rev-parse HEAD", repoPath, { allowFail: true }).out;
      const mainFull = hasRef(repoPath, "origin/" + MAIN)
        ? run("git rev-parse origin/" + MAIN, repoPath, { allowFail: true }).out
        : headFull;
      const DEV_FULL = hasRef(repoPath, "origin/" + DEV)
        ? run("git rev-parse origin/" + DEV, repoPath, { allowFail: true }).out
        : headFull;
      const syncedNow = Boolean(headFull) && headFull === mainFull && headFull === DEV_FULL;
      const mark = syncedNow
        ? "SYNCED"
        : `DIFF main=${mainSha || "?"} ${DEV}=${DEV_SHA || "?"} HEAD=${sha}`;
      console.log(`  done @ ${sha} | ${mark} | branch=${branch}`);
      return syncedNow ? "synced" : "diff";
    }
    console.log(`  stopped @ ${sha} | status=${status}`);
    return status;
  } finally {
    if (!inMerge(repoPath)) ensureOnDev(repoPath);
    else if (run("git branch --show-current", repoPath, { allowFail: true }).out !== DEV) {
      ensureOnDev(repoPath);
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
        console.log("- files:");
        for (const f of c.files) console.log(`  - ${f}`);
      }
      console.log("- commands:\n" + "```bash\n" + c.hint + "\n```\n");
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
      `Local checkouts should remain on ${DEV}. Already-synced repos skip quickly.`,
  );
}

let synced = 0;
let diff = 0;
let conflictCount = 0;
let errCount = 0;

for (const repo of discoverRepos()) {
  if (ONLY && !rel(repo).includes(ONLY) && !repo.includes(ONLY)) continue;
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
