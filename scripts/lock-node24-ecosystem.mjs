/**
 * Lock Node.js >=24.0.0 across LuminaryWorks ecosystem package.json files.
 * Also writes .nvmrc / .node-version and .npmrc engine-strict where missing.
 *
 * Usage: node scripts/lock-node24-ecosystem.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { metaRoot, productDir } from "./lib/workspace.mjs";

const ENGINE = ">=24.0.0";
const NVMRC = "24\n";

/** Roots to walk (MetaRepos + known nested Node packages). */
const roots = [
  metaRoot,
  path.join(metaRoot, "shared"),
  path.join(metaRoot, "services", "entitlement"),
  ...["DataLuminary", "BlockyEdu", "DoerFlow", "VistaRemote", "VistaCast", "SyncroBrain"].map(
    (d) => productDir(d),
  ),
];

const skipDirNames = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "coverage",
  "doc_build",
  ".next",
  ".turbo",
  "vendor",
]);

function walkPackageJson(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".") && ent.name !== ".cursor") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (skipDirNames.has(ent.name)) continue;
      walkPackageJson(full, out);
    } else if (ent.name === "package.json") {
      out.push(full);
    }
  }
  return out;
}

function patchPackageJson(file) {
  const raw = fs.readFileSync(file, "utf8");
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (e) {
    console.warn(`SKIP invalid JSON: ${file} (${e.message})`);
    return false;
  }
  // skip empty private scaffolds without name? still lock if it has scripts/deps
  if (!pkg.name && !pkg.scripts && !pkg.dependencies && !pkg.devDependencies) {
    return false;
  }
  pkg.engines = { ...(pkg.engines ?? {}), node: ENGINE };
  // Prefer Node 24 types when already declaring @types/node
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (pkg[field]?.["@types/node"]) {
      pkg[field]["@types/node"] = "^24.0.0";
    }
  }
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  return true;
}

function ensureNodeVersionFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const nvmrc = path.join(dir, ".nvmrc");
  const nodeVersion = path.join(dir, ".node-version");
  const npmrc = path.join(dir, ".npmrc");
  fs.writeFileSync(nvmrc, NVMRC, "utf8");
  fs.writeFileSync(nodeVersion, NVMRC, "utf8");
  let npmrcBody = "";
  if (fs.existsSync(npmrc)) {
    npmrcBody = fs.readFileSync(npmrc, "utf8");
  }
  if (!/^engine-strict\s*=/m.test(npmrcBody)) {
    npmrcBody = `${npmrcBody.trimEnd()}${npmrcBody.trim() ? "\n" : ""}engine-strict=true\n`;
    fs.writeFileSync(npmrc, npmrcBody, "utf8");
  }
}

const patched = [];
const skipped = [];

for (const root of roots) {
  ensureNodeVersionFiles(root);
  const files = walkPackageJson(root);
  for (const file of files) {
    // Don't walk into other orgs accidentally; roots already scoped
    if (patchPackageJson(file)) patched.push(file);
    else skipped.push(file);
  }
}

// Also lock identity/docs if present under LuminaryWorks
for (const extra of [
  path.join(metaRoot, "identity"),
  path.join(metaRoot, "docs"),
]) {
  if (fs.existsSync(extra)) {
    ensureNodeVersionFiles(extra);
    for (const file of walkPackageJson(extra)) {
      if (patchPackageJson(file)) patched.push(file);
    }
  }
}

console.log(`patched ${patched.length} package.json`);
for (const f of patched) console.log(`  ${f}`);
if (skipped.length) {
  console.log(`skipped ${skipped.length}`);
}
