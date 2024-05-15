#!/usr/bin/env node
/**
 * Verify GitHub org/repo remotes and local sibling paths.
 * Usage: pnpm verify:migration
 *        node scripts/verify-migration.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  PRODUCT_REPOS,
  productDir,
  remotesMatch,
  sshRemote,
  workspaceRoot,
} from "./lib/workspace.mjs";

function findGitRoot(start) {
  if (!fs.existsSync(start)) return null;
  if (fs.existsSync(path.join(start, ".git"))) return start;
  let entries;
  try {
    entries = fs.readdirSync(start, { withFileTypes: true });
  } catch {
    return null;
  }
  const gitKids = entries.filter(
    (e) => e.isDirectory() && fs.existsSync(path.join(start, e.name, ".git")),
  );
  return gitKids.length === 1 ? path.join(start, gitKids[0].name) : null;
}

function gitRemote(cwd) {
  const r = spawnSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return (r.stdout || "").trim();
}

function ghAvailable() {
  const r = spawnSync("gh", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

function ghOrgExists(org) {
  const r = spawnSync("gh", ["api", `orgs/${org}`, "--jq", ".login"], {
    encoding: "utf8",
  });
  return r.status === 0;
}

const hasGh = ghAvailable();
let allOk = true;
console.log(`=== Migration verification (workspace=${workspaceRoot}) ===`);
if (!hasGh) {
  console.log("(gh not found — skip GitHub org API checks)");
}

for (const c of PRODUCT_REPOS) {
  const localPath = productDir(c.dir);
  const want = sshRemote(c.org, c.repo);
  const gitRoot = findGitRoot(localPath);
  const cur = gitRoot ? gitRemote(gitRoot) : null;
  const pathOk = gitRoot !== null;
  const remoteOk = remotesMatch(cur, want);
  const orgOk = hasGh ? ghOrgExists(c.org) : true;

  if (c.required && !(orgOk && remoteOk && pathOk)) allOk = false;
  const status = !c.required
    ? "OPTIONAL"
    : orgOk && remoteOk && pathOk
      ? "OK"
      : "PENDING";
  console.log(`[${status}] ${c.org} (${localPath})`);
  if (!orgOk) console.log("  GitHub org missing (or gh not authenticated)");
  if (!pathOk) console.log("  local path missing");
  if (!remoteOk) console.log(`  remote: ${cur ?? "(none)"} want: ${want}`);
}

process.exit(allOk ? 0 : 1);
