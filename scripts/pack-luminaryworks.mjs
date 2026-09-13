#!/usr/bin/env node
/**
 * Assemble a LuminaryWorks first-install kit.
 *
 * No Docker Engine or image tarballs in the kit.
 * If the host has no Docker, install.sh installs Engine + Compose.
 * An existing Docker Engine is never uninstalled or replaced.
 * Which stacks start is chosen in site.json (products.*.enabled) — not one Compose merge.
 *
 *   node scripts/pack-luminaryworks.mjs
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PACK_PRODUCT_PROJECT, dockerPlatformToPackArch } from "./lib/pack-release.mjs";
import {
  INSTALL_KIT_COMPOSE_SETS,
  INSTALL_KIT_PUBLIC_OVERLAYS,
  INSTALL_PACK_FEDERAL_PRODUCTS,
  INSTALL_PACK_FORBIDDEN,
  fillInternalSecretsInKit,
  promoteExampleFilesToLive,
  renderEditMeList,
  shouldSkipInstallPackEntry,
} from "./lib/luminaryworks-install.mjs";
import { resolveProductCompose } from "./lib/scenario-pack.mjs";
import { BLOCKYEDU_PACK_IDS, DEFAULT_BLOCKYEDU_SEED } from "./lib/site-intent.mjs";
import { PRODUCT_REPOS, metaRoot, productDir } from "./lib/workspace.mjs";

const thisFile = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const options = { help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(64);
    }
  }
  return options;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: metaRoot,
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  }
}

function gitShortSha(cwd = metaRoot) {
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  return (result.stdout || "dev").trim();
}

function copyFiltered(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const ent of readdirSync(src, { withFileTypes: true })) {
    if (shouldSkipInstallPackEntry(ent.name)) continue;
    const from = join(src, ent.name);
    const to = join(dest, ent.name);
    if (ent.isDirectory()) copyFiltered(from, to);
    else cpSync(from, to);
  }
}

function treeBytes(dir) {
  let n = 0;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) n += treeBytes(path);
    else n += statSync(path).size;
  }
  return n;
}

function fmtMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function assertBlockyeduCoursePacks(kitDir) {
  const packsRoot = join(kitDir, "products", "blockyedu", "edu-server", "content", "course-packs");
  if (!existsSync(packsRoot)) {
    throw new Error("[luminaryworks-install] BlockyEdu course-packs missing (edu-server/content/course-packs)");
  }
  for (const id of BLOCKYEDU_PACK_IDS) {
    const packJson = join(packsRoot, id, "pack.json");
    if (!existsSync(packJson)) {
      throw new Error(`[luminaryworks-install] BlockyEdu course pack ${id} missing at ${packJson}`);
    }
  }
}

function isRequiredProduct(key) {
  const meta = PRODUCT_REPOS.find((item) => item.key === key);
  return meta ? meta.required !== false : true;
}

function packFederalProducts(kitDir) {
  const products = {};
  mkdirSync(join(kitDir, "products"), { recursive: true });
  for (const key of INSTALL_PACK_FEDERAL_PRODUCTS) {
    const root = productDir(key);
    if (!existsSync(root)) {
      if (isRequiredProduct(key)) {
        throw new Error(`[luminaryworks-install] missing required product repo ${key} at ${root}`);
      }
      console.warn(`[luminaryworks-install] skip optional ${key} (not cloned at ${root})`);
      continue;
    }
    const resolved = resolveProductCompose(key, { composeSets: INSTALL_KIT_COMPOSE_SETS });
    if (resolved.missing.length) {
      throw new Error(`[luminaryworks-install] ${key}: missing compose ${resolved.missing.join(", ")}`);
    }
    const dest = join(kitDir, "products", key);
    console.log(`[luminaryworks-install] copy ${key} ← ${root}`);
    copyFiltered(root, dest);
    products[key] = {
      project: PACK_PRODUCT_PROJECT[key],
      compose: resolved.files,
      overlays: resolved.overlays,
      gitSha: existsSync(join(root, ".git")) ? gitShortSha(root) : gitShortSha(metaRoot),
    };
  }
  for (const spec of Object.values(INSTALL_KIT_PUBLIC_OVERLAYS)) {
    const dest = join(kitDir, spec.to);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(metaRoot, spec.from), dest);
  }
  for (const [key, spec] of Object.entries(INSTALL_KIT_PUBLIC_OVERLAYS)) {
    if (!products[key]) continue;
    if (!products[key].compose.includes(spec.compose)) {
      products[key].compose = [...products[key].compose, spec.compose];
    }
  }
  writeFileSync(join(kitDir, "products", "MANIFEST.json"), `${JSON.stringify({ products }, null, 2)}\n`);
  return products;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/pack-luminaryworks.mjs");
    return 0;
  }

  const sha = gitShortSha();
  const packArch = dockerPlatformToPackArch("linux/amd64");
  const kitName = `luminaryworks-install-${packArch}-${sha}`;
  const kitDir = join(metaRoot, "dist", "kits", kitName);
  rmSync(kitDir, { recursive: true, force: true });
  mkdirSync(kitDir, { recursive: true });

  mkdirSync(join(kitDir, "deploy", "compose"), { recursive: true });
  mkdirSync(join(kitDir, "deploy", "env"), { recursive: true });
  cpSync(
    join(metaRoot, "deploy", "compose", "control-plane.yaml"),
    join(kitDir, "deploy", "compose", "control-plane.yaml"),
  );
  cpSync(
    join(metaRoot, "deploy", "env", "control-plane.env.example"),
    join(kitDir, "deploy", "env", "control-plane.env.example"),
  );

  copyFiltered(join(metaRoot, "services", "auth-gateway"), join(kitDir, "services", "auth-gateway"));
  copyFiltered(join(metaRoot, "services", "entitlement"), join(kitDir, "services", "entitlement"));
  copyFiltered(join(metaRoot, "apps", "control-console"), join(kitDir, "apps", "control-console"));

  const identityRoot = join(metaRoot, "identity");
  mkdirSync(join(kitDir, "identity"), { recursive: true });
  for (const file of [
    ".env.example",
    "ACCOUNTS.product.env.example",
    "seed-accounts.manifest.json",
    "apps.json",
  ]) {
    const from = join(identityRoot, file);
    if (existsSync(from)) cpSync(from, join(kitDir, "identity", file));
  }
  const identityScripts = join(identityRoot, "scripts");
  if (existsSync(identityScripts)) {
    copyFiltered(identityScripts, join(kitDir, "identity", "scripts"));
  }

  const packedProducts = packFederalProducts(kitDir);
  assertBlockyeduCoursePacks(kitDir);
  for (const key of Object.keys(packedProducts)) {
    console.log(`[luminaryworks-install] ${key} ${fmtMiB(treeBytes(join(kitDir, "products", key)))} (source; no node_modules/images)`);
  }

  const promoted = promoteExampleFilesToLive(kitDir);
  fillInternalSecretsInKit(kitDir);
  writeFileSync(join(kitDir, "EDIT-ME.md"), renderEditMeList(promoted));
  for (const rel of promoted) {
    if (/\.env$/i.test(rel)) chmodSync(join(kitDir, rel), 0o600);
  }

  cpSync(join(metaRoot, "scripts", "install-luminaryworks.sh"), join(kitDir, "install.sh"));
  chmodSync(join(kitDir, "install.sh"), 0o755);
  cpSync(join(metaRoot, "scripts", "ensure-docker.sh"), join(kitDir, "ensure-docker.sh"));
  chmodSync(join(kitDir, "ensure-docker.sh"), 0o755);
  cpSync(join(metaRoot, "scripts", "install-wizard.py"), join(kitDir, "install-wizard.py"));
  cpSync(join(metaRoot, "scripts", "install-runtime.py"), join(kitDir, "install-runtime.py"));
  cpSync(join(metaRoot, "scripts", "accept-luminaryworks.sh"), join(kitDir, "accept.sh"));
  chmodSync(join(kitDir, "accept.sh"), 0o755);
  mkdirSync(join(kitDir, "wizard"), { recursive: true });
  cpSync(
    join(metaRoot, "deploy", "luminaryworks-install", "wizard", "index.html"),
    join(kitDir, "wizard", "index.html"),
  );
  cpSync(
    join(metaRoot, "deploy", "luminaryworks-install", "hosts.defaults.json"),
    join(kitDir, "hosts.defaults.json"),
  );
  mkdirSync(join(kitDir, "deploy", "luminaryworks-install", "overlays"), { recursive: true });
  cpSync(
    join(metaRoot, "deploy", "luminaryworks-install", "overlays", "ingress.yml"),
    join(kitDir, "deploy", "luminaryworks-install", "overlays", "ingress.yml"),
  );
  cpSync(join(metaRoot, "deploy", "luminaryworks-install", "START-HERE.md"), join(kitDir, "START-HERE.md"));
  cpSync(join(metaRoot, "deploy", "luminaryworks-install", "README.md"), join(kitDir, "README.md"));
  cpSync(join(metaRoot, "deploy", "luminaryworks-install", "ENV.md"), join(kitDir, "ENV.md"));
  const siteExample = join(metaRoot, "deploy", "site.luminaryworks-install.example.json");
  cpSync(siteExample, join(kitDir, "site.json"));

  for (const forbidden of INSTALL_PACK_FORBIDDEN) {
    if (existsSync(join(kitDir, forbidden))) {
      throw new Error(`kit must not contain ${forbidden}`);
    }
  }

  const manifest = {
    name: kitName,
    kind: "luminaryworks-first-install",
    platform: "linux/amd64",
    gitSha: sha,
    includesDockerEngine: false,
    includesDockerImages: false,
    hostMustProvide: ["linux-host"],
    docker: "install-if-missing-never-replace",
    controlPlaneBuilds: ["auth-gateway", "entitlement", "control-console"],
    products: Object.keys(packedProducts),
    selectWith: "site.json products.*.enabled",
    blockyeduSeed: DEFAULT_BLOCKYEDU_SEED,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(kitDir, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  mkdirSync(join(metaRoot, "dist", "kits"), { recursive: true });
  const tarPath = join(metaRoot, "dist", "kits", `${kitName}.tar`);
  run("tar", ["-C", join(metaRoot, "dist", "kits"), "-cf", tarPath, kitName]);
  console.log(`[luminaryworks-install] wrote ${kitDir} (${fmtMiB(treeBytes(kitDir))} unpacked)`);
  console.log(`[luminaryworks-install] wrote ${tarPath} (${fmtMiB(statSync(tarPath).size)} — source only, host builds images)`);
  console.log("[luminaryworks-install] sudo bash install.sh   # wizard on :80 (auto ufw); or --no-wizard --public-host <IP>");
  console.log("[luminaryworks-install] sudo bash accept.sh    # re-run health + login acceptance");
  return 0;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === thisFile;
if (isCli) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(err.stack || err.message || err);
    process.exit(1);
  }
}
