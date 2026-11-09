#!/usr/bin/env node
/**
 * Sync the product-facing `ent:sidecar` delegate into sibling product MetaRepos.
 *
 *   pnpm sync:ent-sidecar
 *   pnpm sync:ent-sidecar --check
 *
 * Products keep a thin scripts/ent-sidecar.mjs + package.json scripts; Docker
 * ownership stays in this repo (`pnpm ent:sidecar`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const lwRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(lwRoot, "scripts", "product-ent-sidecar-delegate.mjs");
const checkOnly = process.argv.includes("--check");

const PRODUCTS = [
  "DataLuminary",
  "BlockyEdu",
  "DoerFlow",
  "VistaRemote",
  "VistaCast",
  "SyncroBrain",
];

const PACKAGE_SCRIPTS = {
  "ent:sidecar": "node ./scripts/ent-sidecar.mjs ent:sidecar",
  "ent:sidecar:down": "node ./scripts/ent-sidecar.mjs ent:sidecar:down",
  "ent:sidecar:ps": "node ./scripts/ent-sidecar.mjs ent:sidecar:ps",
  "ent:sidecar:ready": "node ./scripts/ent-sidecar.mjs ent:sidecar:ready",
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(source)) {
  fail(`missing template: ${source}`);
}

const template = readFileSync(source, "utf8");
let changed = 0;
let missingRoots = 0;

for (const name of PRODUCTS) {
  const productRoot = join(lwRoot, "..", name);
  if (!existsSync(join(productRoot, "package.json"))) {
    console.warn(`skip ${name}: no sibling package.json at ${productRoot}`);
    missingRoots += 1;
    continue;
  }

  const scriptsDir = join(productRoot, "scripts");
  const target = join(scriptsDir, "ent-sidecar.mjs");
  const pkgPath = join(productRoot, "package.json");

  if (checkOnly) {
    const fileOk = existsSync(target) && readFileSync(target, "utf8") === template;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts ?? {};
    const scriptsOk = Object.entries(PACKAGE_SCRIPTS).every(([k, v]) => scripts[k] === v);
    if (!fileOk || !scriptsOk) {
      console.error(`out of sync: ${name}`);
      changed += 1;
    } else {
      console.log(`ok: ${name}`);
    }
    continue;
  }

  mkdirSync(scriptsDir, { recursive: true });
  if (!existsSync(target) || readFileSync(target, "utf8") !== template) {
    writeFileSync(target, template, "utf8");
    console.log(`wrote ${target}`);
    changed += 1;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.scripts = pkg.scripts ?? {};
  let pkgChanged = false;
  for (const [key, value] of Object.entries(PACKAGE_SCRIPTS)) {
    if (pkg.scripts[key] !== value) {
      pkg.scripts[key] = value;
      pkgChanged = true;
    }
  }
  if (pkgChanged) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    console.log(`updated scripts in ${pkgPath}`);
    changed += 1;
  } else {
    console.log(`scripts ok: ${name}`);
  }
}

if (checkOnly && changed > 0) {
  fail(`${changed} product(s) out of sync — run: pnpm sync:ent-sidecar`);
}

console.log(
  checkOnly
    ? `ent-sidecar sync check passed (${PRODUCTS.length - missingRoots} products)`
    : `ent-sidecar sync done (${changed} change(s); skipped ${missingRoots} missing siblings)`,
);
