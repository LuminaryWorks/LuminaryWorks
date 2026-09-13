#!/usr/bin/env node
/**
 * Ensure ecosystem MetaRepos use dev (default) + main (release) workflow.
 *
 * - Renames remote master -> main when needed
 * - Creates or syncs dev from main
 * - Sets GitHub default branch to dev
 *
 * Usage:
 *   node scripts/sync-ecosystem-dev-branch.mjs
 *   node scripts/sync-ecosystem-dev-branch.mjs --dry-run
 *   node scripts/sync-ecosystem-dev-branch.mjs --remote-only   # all org repos via gh API
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { metaRoot, workspaceRoot } from "./lib/workspace.mjs";

const DRY = process.argv.includes("--dry-run");
const REMOTE_ONLY = process.argv.includes("--remote-only");

const LOCAL_REPOS = [
  { path: metaRoot, label: "LuminaryWorks" },
  { path: path.join(metaRoot, "identity"), label: "identity" },
  { path: path.join(metaRoot, "shared"), label: "shared" },
  { path: path.join(metaRoot, "docs"), label: "docs" },
  { path: path.join(metaRoot, "website"), label: "website" },
  { path: path.join(workspaceRoot, "DataLuminary"), label: "DataLuminary" },
  { path: path.join(workspaceRoot, "BlockyEdu"), label: "BlockyEdu" },
  { path: path.join(workspaceRoot, "DoerFlow"), label: "DoerFlow" },
  { path: path.join(workspaceRoot, "VistaCast"), label: "VistaCast" },
  { path: path.join(workspaceRoot, "VistaRemote"), label: "VistaRemote" },
  { path: path.join(workspaceRoot, "SyncroBrain"), label: "SyncroBrain" },
];

const ORGS = [
  "LuminaryWorks",
  "DataLuminary",
  "BlockyEdu",
  "DoerFlow",
  "VistaCast",
  "VistaRemote",
  "SyncroBrain",
];

const READ_CMD =
  /^(git remote get-url|git status --porcelain|git rev-parse|git merge-base|git rev-list --count|gh api repos\/[^ ]+ --jq)/;

function run(cmd, cwd, { allowFail = false, readOnly = false } = {}) {
  const isRead = readOnly || READ_CMD.test(cmd);
  if (DRY && !isRead) {
    console.log(`[dry-run] (${cwd}) ${cmd}`);
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
    throw new Error(`Command failed (${cwd}): ${cmd}\n${out}`);
  }
  return { ok: r.status === 0, out };
}

function ghJson(cmd, { allowFail = false } = {}) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    if (allowFail) return null;
    return null;
  }
  const text = (r.stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.replace(/^"|"$/g, "");
  }
}

function parseRemote(cwd) {
  const { out } = run("git remote get-url origin", cwd, { allowFail: true });
  if (!out) return null;
  const s = out.trim().replace(/\.git$/i, "");
  const m =
    s.match(/github\.com[^:]*:([^/]+)\/(.+)$/i) ||
    s.match(/github\.com\/([^/]+)\/(.+)$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function remoteHasBranch(cwd, branch) {
  const { ok } = run(`git rev-parse --verify origin/${branch}`, cwd, { allowFail: true });
  return ok;
}

function mergeBaseExists(cwd, a, b) {
  const { ok } = run(`git merge-base --is-ancestor ${a} ${b}`, cwd, { allowFail: true });
  if (ok) return true;
  const r = spawnSync(`git merge-base ${a} ${b}`, {
    cwd,
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return r.status === 0 && Boolean(r.stdout?.trim());
}

function renameMasterToMain(owner, repo, cwd) {
  if (!remoteHasBranch(cwd, "master")) return "main";
  if (remoteHasBranch(cwd, "main")) return "main";
  console.log(`  rename master -> main on ${owner}/${repo}`);
  run(
    `gh api -X POST repos/${owner}/${repo}/branches/master/rename -f new_name=main`,
    cwd,
  );
  run("git fetch origin --prune", cwd);
  run("git branch -m master main 2>/dev/null || true", cwd, { allowFail: true });
  return "main";
}

function ensureDevOnRemote(owner, repo, release, cwd) {
  if (!remoteHasBranch(cwd, "dev")) {
    console.log(`  create dev from origin/${release}`);
    run(`gh api -X POST repos/${owner}/${repo}/git/refs -f ref=refs/heads/dev -f sha="$(git rev-parse origin/${release})"`, cwd);
    run("git fetch origin --prune", cwd);
    return;
  }

  if (!mergeBaseExists(cwd, `origin/${release}`, "origin/dev")) {
    console.log(`  dev has unrelated history — reset dev to origin/${release}`);
    run(`git push origin origin/${release}:refs/heads/dev --force`, cwd);
    run("git fetch origin --prune", cwd);
    return;
  }

  const devAhead = Number(
    run(`git rev-list --count origin/${release}..origin/dev`, cwd).out || "0",
  );
  const releaseAhead = Number(
    run(`git rev-list --count origin/dev..origin/${release}`, cwd).out || "0",
  );

  if (releaseAhead > 0) {
    console.log(`  merge origin/${release} into dev (${releaseAhead} commits)`);
    run(`git checkout -B dev origin/dev`, cwd);
    run(`git merge origin/${release} -m "sync: merge ${release} into dev"`, cwd);
    run("git push origin dev", cwd);
  }

  if (devAhead > 0) {
    console.log(`  merge dev into ${release} (${devAhead} commits)`);
    run(`git checkout -B ${release} origin/${release}`, cwd);
    run(`git merge origin/dev -m "sync: merge dev into ${release}"`, cwd);
    run(`git push origin ${release}`, cwd);
  } else if (releaseAhead > 0) {
    // dev was updated; release already contains dev after first merge if fast-forward
    run(`git checkout -B ${release} origin/${release}`, cwd);
    run(`git merge origin/dev -m "sync: align ${release} with dev"`, cwd, { allowFail: true });
    run(`git push origin ${release}`, cwd, { allowFail: true });
  }

  if (devAhead === 0 && releaseAhead === 0) {
    console.log("  dev and release already in sync");
  }
}

function processLocalRepo({ path: repoPath, label }) {
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    console.log(`\n[skip] ${label}: not a git repo`);
    return;
  }

  console.log(`\n=== ${label} ===`);
  const remote = parseRemote(repoPath);
  if (!remote) {
    console.log("  skip: cannot parse origin");
    return;
  }

  const dirty = run("git status --porcelain", repoPath).out;
  if (dirty) {
    console.log(`  stashing ${dirty.split("\n").filter(Boolean).length} local changes`);
    run(`git stash push -u -m "auto-stash before dev-branch sync ${new Date().toISOString().slice(0, 10)}"`, repoPath);
  }

  run("git fetch origin --prune", repoPath);

  let release = remoteHasBranch(repoPath, "main")
    ? "main"
    : remoteHasBranch(repoPath, "master")
      ? "master"
      : null;
  if (!release) {
    console.log("  skip: no main/master on origin");
    return;
  }

  if (release === "master") {
    release = renameMasterToMain(remote.owner, remote.repo, repoPath);
  }

  ensureDevOnRemote(remote.owner, remote.repo, release, repoPath);
  run("git fetch origin --prune", repoPath);

  if (!DRY) {
    run(`gh api -X PATCH repos/${remote.owner}/${remote.repo} -f default_branch=dev`, repoPath);
    const cur = ghJson(`gh api repos/${remote.owner}/${remote.repo} --jq .default_branch`);
    console.log(`  default branch now: ${cur}`);
  } else {
    console.log("  [dry-run] would set default branch to dev");
  }

  run("git checkout -B dev origin/dev", repoPath);
  run("git branch --set-upstream-to=origin/dev dev", repoPath, { allowFail: true });
  console.log(`  local checkout: dev @ ${run("git rev-parse --short HEAD", repoPath).out}`);
}

function processRemoteRepo(owner, name, defaultBranch) {
  const release =
    defaultBranch === "master" && !ghJson(`gh api repos/${owner}/${name}/branches/main --jq .name`)
      ? "master"
      : defaultBranch === "master"
        ? "main"
        : defaultBranch;

  if (defaultBranch === "master") {
    const hasMain = ghJson(`gh api repos/${owner}/${name}/branches/main --jq .name`);
    if (!hasMain) {
      console.log(`  ${owner}/${name}: rename master -> main`);
      if (!DRY) {
        run(
          `gh api -X POST repos/${owner}/${name}/branches/master/rename -f new_name=main`,
          metaRoot,
          { allowFail: true },
        );
      }
    }
  }

  const hasDev = ghJson(`gh api repos/${owner}/${name}/branches/dev --jq .name`, {
    allowFail: true,
  });
  const relBranch = release === "master" ? "main" : release;
  const relSha = ghJson(
    `gh api repos/${owner}/${name}/git/ref/heads/${relBranch} --jq .object.sha`,
    { allowFail: true },
  );
  if (!relSha) {
    console.log(`  ${owner}/${name}: skip (no release branch sha)`);
    return;
  }

  if (!hasDev) {
    console.log(`  ${owner}/${name}: create dev from ${relBranch}`);
    if (!DRY) {
      run(
        `gh api -X POST repos/${owner}/${name}/git/refs -f ref=refs/heads/dev -f sha=${relSha}`,
        metaRoot,
        { allowFail: true },
      );
    }
  }

  if (!DRY) {
    run(
      `gh api -X PATCH repos/${owner}/${name} -f default_branch=dev`,
      metaRoot,
      { allowFail: true },
    );
  } else {
    console.log(`  [dry-run] ${owner}/${name}: default -> dev`);
  }
}

function main() {
  if (!REMOTE_ONLY) {
    for (const repo of LOCAL_REPOS) {
      try {
        processLocalRepo(repo);
      } catch (err) {
        console.error(`ERROR ${repo.label}: ${err.message}`);
      }
    }
  }

  console.log("\n=== Remote org repos (API) ===");
  const localKeys = new Set(
    LOCAL_REPOS.map((r) => {
      const remote = parseRemote(r.path);
      return remote ? `${remote.owner}/${remote.repo}`.toLowerCase() : "";
    }).filter(Boolean),
  );

  for (const org of ORGS) {
    const repos = ghJson(`gh repo list ${org} --limit 200 --json name,defaultBranchRef`) || [];
    for (const item of repos) {
      const key = `${org}/${item.name}`.toLowerCase();
      if (localKeys.has(key)) continue;
      try {
        processRemoteRepo(org, item.name, item.defaultBranchRef?.name || "main");
      } catch (err) {
        console.error(`ERROR ${org}/${item.name}: ${err.message}`);
      }
    }
  }

  console.log("\nDone.");
}

main();
