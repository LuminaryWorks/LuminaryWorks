/**
 * Rebuild @luminaryworks/entitlement-client and force-refresh file: installs
 * in ecosystem product repos (pnpm content-addressable copies go stale when
 * source `dist/` gains new files such as `trial.js`).
 *
 * Usage (from LuminaryWorks MetaRepo):
 *   pnpm ent:client:sync
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { metaRoot, resolveWorkspacePath } from "./lib/workspace.mjs";

const pkgDir = path.join(metaRoot, "shared", "packages", "entitlement-client");

const consumers = [
  resolveWorkspacePath("DataLuminary", "DataTalk"),
  resolveWorkspacePath("BlockyEdu", "edu-server"),
  resolveWorkspacePath("BlockyEdu", "server"),
  resolveWorkspacePath("VistaRemote", "server"),
  resolveWorkspacePath("DoerFlow", "repos", "api"),
];

function run(cmd, args, cwd) {
  console.log(`\n> ${cmd} ${args.join(" ")}  (cwd=${cwd})`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    throw new Error(`command failed (${r.status}): ${cmd} ${args.join(" ")}`);
  }
}

function assertDistComplete() {
  const required = [
    "index.js",
    "index.d.ts",
    "trial.js",
    "trial.d.ts",
    "client.js",
    "types.js",
    "entitlement.module.js",
    "license/verify.js",
  ];
  for (const f of required) {
    const p = path.join(pkgDir, "dist", f);
    if (!fs.existsSync(p)) throw new Error(`missing build artifact: ${f}`);
  }
  // index must require trial
  const indexJs = fs.readFileSync(path.join(pkgDir, "dist", "index.js"), "utf8");
  if (!indexJs.includes('require("./trial")')) {
    throw new Error('dist/index.js does not require("./trial")');
  }
  console.log("source dist OK (includes trial.js)");
}

function removeEntitlementClientInstall(repo) {
  const nm = path.join(repo, "node_modules", "@luminaryworks", "entitlement-client");
  if (fs.existsSync(nm)) {
    fs.rmSync(nm, { recursive: true, force: true });
    console.log(`removed ${nm}`);
  }
  const pnpm = path.join(repo, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpm)) return;
  for (const name of fs.readdirSync(pnpm)) {
    if (name.includes("@luminaryworks+entitlement") || name.includes("entitlement-client@file")) {
      const full = path.join(pnpm, name);
      fs.rmSync(full, { recursive: true, force: true });
      console.log(`removed store ${full}`);
    }
  }
}

function verifyConsumer(repo) {
  const dist = path.join(
    repo,
    "node_modules",
    "@luminaryworks",
    "entitlement-client",
    "dist",
  );
  const trialJs = path.join(dist, "trial.js");
  if (!fs.existsSync(trialJs)) {
    throw new Error(`${repo}: still missing dist/trial.js after reinstall`);
  }
  const r = spawnSync(
    "node",
    [
      "-e",
      "require('@luminaryworks/entitlement-client'); console.log('require-ok')",
    ],
    { cwd: repo, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    throw new Error(`${repo}: require failed\n${r.stderr || r.stdout}`);
  }
  console.log(`${repo}: require-ok + trial.js present`);
}

// --- main
if (!fs.existsSync(pkgDir)) {
  throw new Error(`entitlement-client not found at ${pkgDir}`);
}

run("pnpm", ["run", "clean"], pkgDir);
run("pnpm", ["run", "build"], pkgDir);
assertDistComplete();

for (const repo of consumers) {
  if (!fs.existsSync(path.join(repo, "package.json"))) {
    console.warn(`skip missing repo: ${repo}`);
    continue;
  }
  console.log(`\n=== refresh ${repo} ===`);
  removeEntitlementClientInstall(repo);
  run("pnpm", ["install"], repo);
  verifyConsumer(repo);
}

console.log("\nAll consumers refreshed and verified.");
