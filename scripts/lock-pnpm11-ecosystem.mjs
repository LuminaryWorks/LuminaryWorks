/**
 * Ensure ecosystem Node packages accept pnpm >=11 (11, 12, …).
 *
 * - engines.pnpm: ">=11" — rejects 9/10; does NOT reject future 12+
 * - Removes packageManager pins — Corepack/exact pins (e.g. pnpm@11.27.1)
 *   make `pnpm install` fail when the local CLI is a different major/minor
 *   (ERR_PNPM_BAD_PM_VERSION). Ranges are not valid in packageManager.
 *
 * Usage: node scripts/lock-pnpm11-ecosystem.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { metaRoot, productDir } from "./lib/workspace.mjs";

const ENGINE_PNPM = ">=11";

/** Roots to walk (MetaRepos + known nested Node packages). */
const roots = [
  metaRoot,
  path.join(metaRoot, "shared"),
  path.join(metaRoot, "services", "entitlement"),
  path.join(metaRoot, "services", "auth-gateway"),
  path.join(metaRoot, "services", "ai-platform"),
  path.join(metaRoot, "apps", "control-console"),
  path.join(metaRoot, "docs"),
  path.join(metaRoot, "website"),
  path.join(metaRoot, "scripts", "templates", "docs-vitepress"),
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
  "kits",
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
  if (!pkg.name && !pkg.scripts && !pkg.dependencies && !pkg.devDependencies) {
    return false;
  }

  const hadPm = Object.hasOwn(pkg, "packageManager");
  const prevEng = pkg.engines?.pnpm ?? null;
  if (!hadPm && prevEng === ENGINE_PNPM) {
    return false;
  }

  if (hadPm) {
    delete pkg.packageManager;
  }
  pkg.engines = { ...(pkg.engines ?? {}), pnpm: ENGINE_PNPM };

  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return true;
}

const patched = [];
const unchanged = [];
const skipped = [];
const seen = new Set();

for (const root of roots) {
  if (!fs.existsSync(root)) {
    console.warn(`SKIP missing root: ${root}`);
    continue;
  }
  for (const file of walkPackageJson(root)) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (patchPackageJson(file)) patched.push(file);
    else {
      try {
        const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!pkg.packageManager && pkg.engines?.pnpm === ENGINE_PNPM) {
          unchanged.push(file);
        } else if (!pkg.name && !pkg.scripts && !pkg.dependencies && !pkg.devDependencies) {
          skipped.push(file);
        } else {
          unchanged.push(file);
        }
      } catch {
        skipped.push(file);
      }
    }
  }
}

console.log(`engines.pnpm=${ENGINE_PNPM}; packageManager removed (no exact Corepack pin)`);
console.log(`patched ${patched.length} package.json`);
for (const f of patched) console.log(`  ${f}`);
if (unchanged.length) {
  console.log(`already current ${unchanged.length}`);
}
if (skipped.length) {
  console.log(`skipped ${skipped.length}`);
  for (const f of skipped) console.log(`  skip ${f}`);
}
