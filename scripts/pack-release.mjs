#!/usr/bin/env node
/**
 * Build an offline install pack on this machine (or CI).
 *
 *   node scripts/pack-release.mjs --target control-plane
 *   node scripts/pack-release.mjs --target doerflow --git-pull
 *   node scripts/pack-release.mjs --target products --git-pull
 *   node scripts/pack-release.mjs --target all --platform linux/amd64
 *
 * Pack *time* (laptop / CI): git pull latest (optional) + docker compose build + docker save.
 * Target Linux host: docker load + compose up --no-build --pull never. No pnpm, no compilers.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CN_DOCKER_MIRROR,
  collectRequiredComposeVars,
  hubMirrorImage,
  shouldPullFromHub,
} from "./lib/docker-registry.mjs";
import {
  CONTROL_PLANE_PACK_IMAGES,
  dockerPlatformToPackArch,
  expandPackTargets,
  PACK_PRODUCT_PROJECT,
  packName,
} from "./lib/pack-release.mjs";
import {
  assertPackExcludesObjectStorage,
  objectStoragePackManifestNote,
  shouldCopyObjectStoragePackFile,
} from "./lib/object-storage.mjs";
import { resolveProductPackCompose } from "./lib/scenario-pack.mjs";
import { metaRoot, productDir } from "./lib/workspace.mjs";

function parseArgs(argv) {
  const options = {
    target: "control-plane",
    platform: process.env.PACK_PLATFORM || "",
    outDir: join(metaRoot, "dist", "packs"),
    skipBuild: false,
    gitPull: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--target":
        options.target = next();
        break;
      case "--platform":
        options.platform = next();
        break;
      case "--out-dir":
        options.outDir = next();
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--git-pull":
        options.gitPull = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(64);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/pack-release.mjs [options]

  --target control-plane|vistacast|syncrobrain|doerflow|vistaremote|dataluminary|blockyedu|products|all
  --platform linux/arm64|linux/amd64
  --git-pull     git pull --ff-only each product (and this repo for control-plane) before build
  --skip-build   Pack whatever images already exist locally
  --dry-run      Print the pack plan and exit

Build happens on this machine / CI. The customer host never git-pulls or compiles.
`);
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: opts.stdio || "inherit",
    cwd: opts.cwd || metaRoot,
    env: { ...process.env, ...(opts.env || {}) },
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  }
  return result;
}

function gitShortSha(repoDir) {
  const result = spawnSync("git", ["-C", repoDir, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  return (result.stdout || "dev").trim();
}

function gitPullFfOnly(repoDir, label) {
  if (!existsSync(join(repoDir, ".git"))) {
    throw new Error(`[pack] ${label}: not a git checkout (${repoDir})`);
  }
  console.log(`[pack] git pull --ff-only ${label}`);
  run("git", ["-C", repoDir, "pull", "--ff-only"]);
}

function detectPlatform(requested) {
  if (requested) return requested;
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"], {
    encoding: "utf8",
    shell: false,
  });
  const detected = (result.stdout || "").trim();
  return detected || "linux/arm64";
}

function imageExists(name) {
  const result = spawnSync("docker", ["image", "inspect", name], {
    encoding: "utf8",
    shell: false,
    stdio: "pipe",
  });
  return result.status === 0;
}

function pullImage(image) {
  if (!shouldPullFromHub(image) || imageExists(image)) return;
  console.log(`[pack] pulling ${image}`);
  const first = spawnSync("docker", ["pull", image], {
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
  });
  if (first.status === 0) return;
  const mirrored = hubMirrorImage(image, CN_DOCKER_MIRROR);
  console.log(`[pack] official Hub failed; retry ${mirrored}`);
  run("docker", ["pull", mirrored]);
  if (mirrored !== image) run("docker", ["tag", mirrored, image]);
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(path));
    else out.push(path);
  }
  return out;
}

function copyExamples(productRoot, packDir) {
  const deployRoot = join(productRoot, "deploy");
  for (const file of walkFiles(deployRoot)) {
    if (!file.endsWith(".example")) continue;
    const rel = relative(productRoot, file);
    const dest = join(packDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(file, dest);
  }
  const apiExample = join(productRoot, "deploy", "production.env.example");
  const apiDest = join(packDir, "deploy", "env", "api.env.example");
  if (existsSync(apiExample) && !existsSync(apiDest)) {
    mkdirSync(dirname(apiDest), { recursive: true });
    cpSync(apiExample, apiDest);
  }
}

function writePlaceholderEnv(composeFiles, destFile) {
  const keys = new Set();
  for (const file of composeFiles) {
    if (!existsSync(file)) continue;
    for (const key of collectRequiredComposeVars(readFileSync(file, "utf8"))) keys.add(key);
  }
  const lines = [...keys].map((key) => `${key}=pack-placeholder`);
  lines.push("");
  writeFileSync(destFile, lines.join("\n"));
}

function composeImages(cwd, files, envFile) {
  const args = ["compose"];
  if (envFile) args.push("--env-file", envFile);
  for (const file of files) args.push("-f", file);
  args.push("config", "--images");
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `docker compose config --images failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return (result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function tarPack(outDir, name) {
  const tarPath = join(outDir, `${name}.tar.gz`);
  rmSync(tarPath, { force: true });
  run("tar", ["-czf", tarPath, "-C", outDir, name], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  return tarPath;
}

function packControlPlane(options, platform, packArch) {
  const version = gitShortSha(metaRoot);
  const name = packName({ target: "control-plane", platform: packArch, version });
  const packDir = join(options.outDir, name);
  if (options.dryRun) {
    return {
      target: "control-plane",
      name,
      images: CONTROL_PLANE_PACK_IMAGES,
      gitSha: version,
      objectStorage: objectStoragePackManifestNote(),
    };
  }
  if (options.gitPull) gitPullFfOnly(metaRoot, "LuminaryWorks");

  if (!options.skipBuild) {
    const npmRegistry = process.env.NPM_REGISTRY || "https://registry.npmmirror.com";
    const tmp = mkdtempSync(join(tmpdir(), "lw-pack-env-"));
    const packEnv = join(tmp, "pack.env");
    writeFileSync(
      packEnv,
      [
        "IDENTITY_DB_PASSWORD=pack-placeholder",
        "ENTITLEMENT_DB_PASSWORD=pack-placeholder",
        "ENTITLEMENT_SERVICE_API_KEY=pack-placeholder",
        "ENTITLEMENT_PARTNER_SECRET_PEPPER=pack-placeholder",
        "ENTITLEMENT_PARTNER_TOKEN_SECRET=pack-placeholder",
        "AI_VAULT_MASTER_KEY=pack-placeholder",
        "IDENTITY_ENDPOINT=http://localhost:3001",
        "IDENTITY_ADMIN_ENDPOINT=http://localhost:3002",
        "AUTH_GATEWAY_PUBLIC_URL=http://localhost:3010",
        "ENTITLEMENT_OIDC_ISSUER=http://localhost:3001/oidc",
        "AUTH_GATEWAY_IMAGE=luminaryworks/auth-gateway:local",
        "ENTITLEMENT_IMAGE=luminaryworks/entitlement:local",
        "CONTROL_CONSOLE_IMAGE=luminaryworks/control-console:local",
        `NPM_REGISTRY=${npmRegistry}`,
        "",
      ].join("\n"),
    );
    console.log(`[pack] building auth-gateway + entitlement + control-console (${platform}, npm=${npmRegistry})`);
    try {
      run("docker", [
        "compose",
        "--env-file",
        packEnv,
        "-f",
        "deploy/compose/control-plane.yaml",
        "build",
        "auth-gateway",
        "entitlement",
        "control-console",
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  for (const image of CONTROL_PLANE_PACK_IMAGES) pullImage(image);

  const packedImages = assertPackExcludesObjectStorage(CONTROL_PLANE_PACK_IMAGES);
  if (!packedImages.ok) {
    throw new Error(
      `[pack] control-plane images must not include AIStor/MinIO CE: ${packedImages.violations.map((item) => item.image).join(", ")}`,
    );
  }

  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(join(packDir, "images"), { recursive: true });
  mkdirSync(join(packDir, "deploy", "compose"), { recursive: true });
  mkdirSync(join(packDir, "deploy", "env"), { recursive: true });
  mkdirSync(join(packDir, "identity"), { recursive: true });

  cpSync(
    join(metaRoot, "deploy", "compose", "control-plane.yaml"),
    join(packDir, "deploy", "compose", "control-plane.yaml"),
  );
  const overlay = join(metaRoot, "deploy", "compose", "control-plane.object-storage.yaml");
  if (existsSync(overlay)) {
    cpSync(overlay, join(packDir, "deploy", "compose", "control-plane.object-storage.yaml"));
  }
  const objectStorageSrc = join(metaRoot, "deploy", "object-storage");
  if (existsSync(objectStorageSrc)) {
    for (const file of walkFiles(objectStorageSrc)) {
      const rel = relative(objectStorageSrc, file);
      if (!shouldCopyObjectStoragePackFile(rel)) continue;
      const dest = join(packDir, "deploy", "object-storage", rel);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(file, dest);
    }
  }
  cpSync(
    join(metaRoot, "deploy", "env", "control-plane.env.example"),
    join(packDir, "deploy", "env", "control-plane.env.example"),
  );
  cpSync(join(metaRoot, "scripts", "install-from-pack.sh"), join(packDir, "install.sh"));
  chmodSync(join(packDir, "install.sh"), 0o755);
  const identityRoot = join(metaRoot, "identity");
  if (existsSync(identityRoot)) {
    for (const file of [
      ".env.example",
      "ACCOUNTS.dev.env.example",
      "ACCOUNTS.product.env.example",
      "seed-accounts.manifest.json",
    ]) {
      const from = join(identityRoot, file);
      if (existsSync(from)) cpSync(from, join(packDir, "identity", file));
    }
  }

  const imageTar = join(packDir, "images", "control-plane.tar");
  console.log(`[pack] docker save → ${imageTar}`);
  run("docker", ["save", "-o", imageTar, ...CONTROL_PLANE_PACK_IMAGES]);

  const manifest = {
    name,
    target: "control-plane",
    kind: "control-plane",
    project: "luminary-control-plane",
    platform,
    gitSha: version,
    images: CONTROL_PLANE_PACK_IMAGES,
    objectStorage: objectStoragePackManifestNote(),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(packDir, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const tarPath = tarPack(options.outDir, name);
  console.log(`[pack] wrote ${packDir}`);
  console.log(`[pack] wrote ${tarPath}`);
  return manifest;
}

function packProduct(product, options, platform, packArch) {
  const productRoot = productDir(product);
  const resolved = resolveProductPackCompose(product);
  if (resolved.missing.length) {
    throw new Error(
      `[pack] ${product}: missing compose ${resolved.missing.join(", ")} under ${productRoot}`,
    );
  }
  const version = existsSync(join(productRoot, ".git")) ? gitShortSha(productRoot) : gitShortSha(metaRoot);
  const name = packName({ target: product, platform: packArch, version });
  const packDir = join(options.outDir, name);
  const project = PACK_PRODUCT_PROJECT[product];
  const plan = {
    target: product,
    kind: "product",
    name,
    project,
    productRoot,
    compose: resolved.files,
    gitSha: version,
  };
  if (options.dryRun) return plan;
  if (options.gitPull) gitPullFfOnly(productRoot, product);

  const tmp = mkdtempSync(join(tmpdir(), "lw-pack-product-"));
  try {
    const packEnv = join(tmp, "pack.env");
    writePlaceholderEnv(
      resolved.files.map((file) => join(productRoot, file)),
      packEnv,
    );
    if (!options.skipBuild) {
      console.log(`[pack] building ${product} (${platform})`);
      const npmRegistry = process.env.NPM_REGISTRY || "https://registry.npmmirror.com";
      const buildArgs = ["compose", "--env-file", packEnv];
      for (const file of resolved.files) buildArgs.push("-f", file);
      buildArgs.push("build", "--build-arg", `NPM_REGISTRY=${npmRegistry}`);
      run("docker", buildArgs, { cwd: productRoot, env: { NPM_REGISTRY: npmRegistry } });
    }
    const images = composeImages(productRoot, resolved.files, packEnv);
    plan.images = images;
    const forbidden = assertPackExcludesObjectStorage(images);
    if (!forbidden.ok) {
      throw new Error(
        `[pack] ${product}: offline packs must not include AIStor/MinIO CE (${forbidden.violations.map((item) => item.image).join(", ")}). Customers obtain storage separately.`,
      );
    }
    for (const image of images) pullImage(image);

    rmSync(packDir, { recursive: true, force: true });
    mkdirSync(join(packDir, "images"), { recursive: true });
    for (const file of resolved.files) {
      const dest = join(packDir, file);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(productRoot, file), dest);
    }
    copyExamples(productRoot, packDir);
    cpSync(join(metaRoot, "scripts", "install-product-pack.sh"), join(packDir, "install.sh"));
    chmodSync(join(packDir, "install.sh"), 0o755);

    const imageTar = join(packDir, "images", `${product}.tar`);
    if (images.length === 0) {
      throw new Error(`[pack] ${product}: compose listed no images`);
    }
    console.log(`[pack] docker save ${images.length} image(s) → ${imageTar}`);
    run("docker", ["save", "-o", imageTar, ...images]);

    const manifest = {
      ...plan,
      platform,
      images,
      metaGitSha: gitShortSha(metaRoot),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(packDir, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const tarPath = tarPack(options.outDir, name);
    console.log(`[pack] wrote ${packDir}`);
    console.log(`[pack] wrote ${tarPath}`);
    return manifest;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  const targets = expandPackTargets(options.target);
  if (targets.length === 0) {
    console.error(`Unknown --target ${options.target}`);
    printHelp();
    return 64;
  }
  const platform = detectPlatform(options.platform);
  const packArch = dockerPlatformToPackArch(platform);
  mkdirSync(options.outDir, { recursive: true });
  const results = [];
  for (const target of targets) {
    console.log(`[pack] target ${target}`);
    if (target === "control-plane") {
      results.push(packControlPlane(options, platform, packArch));
    } else {
      results.push(packProduct(target, options, platform, packArch));
    }
  }
  if (options.dryRun) {
    console.log(JSON.stringify({ platform, packArch, targets, results }, null, 2));
  }
  return 0;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(err.stack || err.message || err);
    process.exit(1);
  }
}
