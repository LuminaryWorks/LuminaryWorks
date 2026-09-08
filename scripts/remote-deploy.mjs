#!/usr/bin/env node
/**
 * Deploy LuminaryWorks Compose stacks to a remote Linux host over SSH.
 *
 * Same entrypoint for a laptop and GitHub Actions:
 *
 *   node scripts/remote-deploy.mjs --host 192.168.64.3 --user andy \
 *     --key ~/.ssh/id_ed25519_lw_lab --target control-plane
 *
 *   node scripts/remote-deploy.mjs --host 192.168.64.3 --bootstrap-only
 *
 * Targets:
 *   control-plane     Identity + Auth Gateway + Entitlement (this repo)
 *   agent-commerce    also rsyncs sibling product repos when present
 *   smart-site        overlay on agent-commerce
 *
 * A local UTM VM is not reachable from github.com. GitHub Actions needs a
 * public host (Hetzner) or a self-hosted runner on the private machine.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDotEnv } from "./init-scenario-env.mjs";
import {
  assertObjectStorageRemotePreflight,
  objectStorageProfileRequested,
  probeUrls,
  renderControlPlaneEnv,
  RSYNC_EXCLUDES,
  sshArgs,
  TARGETS,
} from "./lib/remote-deploy.mjs";
import { initRemoteIdentity } from "./lib/remote-identity.mjs";
import { metaRoot, productDir, PRODUCT_REPOS } from "./lib/workspace.mjs";

const thisFile = fileURLToPath(import.meta.url);
const bootstrapScript = join(dirname(thisFile), "remote-host-bootstrap.sh");

function parseArgs(argv) {
  const options = {
    host: process.env.DEPLOY_HOST || "",
    user: process.env.DEPLOY_USER || process.env.USER || "andy",
    key: process.env.DEPLOY_SSH_KEY || "",
    remoteDir: process.env.DEPLOY_REMOTE_DIR || "~/luminaryworks",
    target: "control-plane",
    publicHost: process.env.DEPLOY_PUBLIC_HOST || "",
    bindAddr: process.env.DEPLOY_BIND_ADDR || "0.0.0.0",
    protocol: process.env.DEPLOY_PROTOCOL || "http",
    npmRegistry: process.env.NPM_REGISTRY || "",
    bootstrapOnly: false,
    skipBootstrap: false,
    skipSync: false,
    skipUp: false,
    skipProbe: false,
    withControlPlane: true,
    registryMirror: process.env.DEPLOY_REGISTRY_MIRROR || "auto",
    pack: process.env.DEPLOY_PACK || "",
    initIdentity: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--host":
        options.host = next();
        break;
      case "--user":
        options.user = next();
        break;
      case "--key":
        options.key = next();
        break;
      case "--remote-dir":
        options.remoteDir = next();
        break;
      case "--target":
        options.target = next();
        break;
      case "--public-host":
        options.publicHost = next();
        break;
      case "--bind-addr":
        options.bindAddr = next();
        break;
      case "--protocol":
        options.protocol = next();
        break;
      case "--npm-registry":
        options.npmRegistry = next();
        break;
      case "--bootstrap-only":
        options.bootstrapOnly = true;
        break;
      case "--skip-bootstrap":
        options.skipBootstrap = true;
        break;
      case "--skip-sync":
        options.skipSync = true;
        break;
      case "--skip-up":
        options.skipUp = true;
        break;
      case "--skip-probe":
        options.skipProbe = true;
        break;
      case "--no-control-plane":
        options.withControlPlane = false;
        break;
      case "--registry-mirror":
        options.registryMirror = next();
        break;
      case "--pack":
        options.pack = next();
        break;
      case "--init-identity":
        options.initIdentity = true;
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
  console.log(`Usage: node scripts/remote-deploy.mjs --host <ip> [options]

  --user <name>           SSH user (default: $DEPLOY_USER or $USER)
  --key <path>            SSH private key (default: $DEPLOY_SSH_KEY)
  --remote-dir <path>     Remote checkout (default: ~/luminaryworks)
  --target <name>         control-plane | agent-commerce | smart-site
  --public-host <host>    Browser-reachable host (default: --host)
  --bind-addr <addr>      Compose publish address (default: 0.0.0.0)
  --bootstrap-only        Install Docker / sudo / git on the host and exit
  --skip-bootstrap        Do not run the host bootstrap script
  --skip-sync             Do not rsync
  --skip-up               Do not docker compose up
  --skip-probe            Do not curl /health /ready after up
  --registry-mirror auto|none|<url>
                          auto (default): probe Docker Hub, else docker.m.daocloud.io
  --npm-registry <url>    npm registry for Entitlement image build
  --pack <file.tar>       Offline pack from scripts/pack-release.mjs (load + up, no build)
  --init-identity         After up, create Logto Console operator + seed (inside identity container)

Environment: DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_REMOTE_DIR
             DEPLOY_PUBLIC_HOST DEPLOY_BIND_ADDR DEPLOY_PROTOCOL
             DEPLOY_REGISTRY_MIRROR DEPLOY_PACK

Environment: DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_REMOTE_DIR
             DEPLOY_PUBLIC_HOST DEPLOY_BIND_ADDR DEPLOY_PROTOCOL
             DEPLOY_REGISTRY_MIRROR
`);
}

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: opts.stdio || "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function ssh(options, remoteCommand, spawnOpts = {}) {
  const args = sshArgs({
    key: options.key || undefined,
    user: options.user,
    host: options.host,
  });
  args.push(remoteCommand);
  return run("ssh", args, spawnOpts);
}

function sshCapture(options, remoteCommand) {
  const args = sshArgs({
    key: options.key || undefined,
    user: options.user,
    host: options.host,
  });
  args.push(remoteCommand);
  const result = spawnSync("ssh", args, { encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(`ssh ${remoteCommand} failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`);
  }
  return (result.stdout || "").trim();
}

function dockerReady(options) {
  try {
    sshCapture(options, "docker info >/dev/null && docker compose version >/dev/null && echo ok");
    return true;
  } catch {
    return false;
  }
}

function bootstrapHost(options) {
  if (!existsSync(bootstrapScript)) {
    throw new Error(`missing ${bootstrapScript}`);
  }
  const remoteTmp = `/tmp/lw-bootstrap-${process.pid}.sh`;
  const scpArgs = [];
  if (options.key) scpArgs.push("-i", options.key, "-o", "IdentitiesOnly=yes");
  scpArgs.push("-o", "BatchMode=yes", bootstrapScript, `${options.user}@${options.host}:${remoteTmp}`);
  run("scp", scpArgs);
  const extra =
    !options.registryMirror || options.registryMirror === "auto"
      ? " --registry-mirror auto"
      : options.registryMirror === "none"
        ? " --registry-mirror none"
        : ` --registry-mirror ${options.registryMirror}`;
  ssh(options, `sudo bash ${remoteTmp} --user ${options.user}${extra}`);
}

function applyRegistryMirror(options) {
  const raw = String(options.registryMirror || "auto").trim();
  if (!raw || raw === "auto" || raw === "none") return;
  const mirror = raw.replace(/["\\]/g, "");
  try {
    const current = sshCapture(options, "sudo cat /etc/docker/daemon.json 2>/dev/null || echo {}");
    if (current.includes(mirror)) {
      console.log(`[remote-deploy] registry mirror already set: ${mirror}`);
      return;
    }
  } catch {
    // write below
  }
  const tmp = mkdtempSync(join(tmpdir(), "lw-mirror-"));
  const localPath = join(tmp, "daemon-mirror.sh");
  const remotePath = `/tmp/lw-daemon-mirror-${process.pid}.sh`;
  try {
    writeFileSync(
      localPath,
      `#!/bin/bash
set -euo pipefail
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["${mirror}"]
}
EOF
systemctl restart docker
echo "configured registry-mirrors: ${mirror}"
`,
    );
    const scpArgs = [];
    if (options.key) scpArgs.push("-i", options.key, "-o", "IdentitiesOnly=yes");
    scpArgs.push("-o", "BatchMode=yes", localPath, `${options.user}@${options.host}:${remotePath}`);
    run("scp", scpArgs);
    ssh(options, `sudo bash ${remotePath}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function rsyncArgs(options, src, dest) {
  const args = ["-az", "--delete-delay"];
  for (const pattern of RSYNC_EXCLUDES) {
    args.push("--exclude", pattern);
  }
  const sshCmd = ["ssh"];
  if (options.key) sshCmd.push("-i", options.key, "-o", "IdentitiesOnly=yes");
  sshCmd.push("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new");
  args.push("-e", sshCmd.join(" "), `${src.replace(/\/?$/, "/")}`, dest);
  return args;
}

function syncTree(options, src, dest) {
  if (!existsSync(src)) {
    console.warn(`[remote-deploy] skip missing ${src}`);
    return false;
  }
  console.log(`[remote-deploy] rsync ${src} -> ${dest}`);
  run("rsync", rsyncArgs(options, src, dest));
  return true;
}

function gitSha() {
  const result = spawnSync("git", ["-C", metaRoot, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    shell: false,
  });
  return (result.stdout || "unknown").trim();
}

function ensureRemoteControlPlaneEnv(options) {
  const example = readFileSync(join(metaRoot, "deploy", "env", "control-plane.env.example"), "utf8");
  let existingText = "";
  try {
    existingText = sshCapture(
      options,
      `test -f ${options.remoteDir}/deploy/env/control-plane.env && cat ${options.remoteDir}/deploy/env/control-plane.env || true`,
    );
  } catch {
    existingText = "";
  }
  const rendered = renderControlPlaneEnv(example, {
    publicHost: options.publicHost || options.host,
    protocol: options.protocol,
    bindAddr: options.bindAddr,
    existingText,
    gitSha: gitSha(),
    npmRegistry: options.npmRegistry || undefined,
  });
  const tmp = mkdtempSync(join(tmpdir(), "lw-cp-env-"));
  const localPath = join(tmp, "control-plane.env");
  try {
    writeFileSync(localPath, rendered);
    const scpArgs = [];
    if (options.key) scpArgs.push("-i", options.key, "-o", "IdentitiesOnly=yes");
    scpArgs.push("-o", "BatchMode=yes", localPath, `${options.user}@${options.host}:${options.remoteDir}/deploy/env/control-plane.env`);
    ssh(options, `mkdir -p ${options.remoteDir}/deploy/env && chmod 700 ${options.remoteDir}/deploy/env`);
    run("scp", scpArgs);
    ssh(options, `chmod 600 ${options.remoteDir}/deploy/env/control-plane.env`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const env = parseDotEnv(rendered);
  if (!env.IDENTITY_DB_PASSWORD) throw new Error("control-plane.env missing IDENTITY_DB_PASSWORD");
  assertObjectStorageRemotePreflight(env);
  return env;
}

function composeUpControlPlane(options, env = {}) {
  const extra = objectStorageProfileRequested(env)
    ? " -f deploy/compose/control-plane.object-storage.yaml --profile object-storage"
    : "";
  const cmd = [
    `cd ${options.remoteDir}`,
    `docker compose --env-file deploy/env/control-plane.env -f deploy/compose/control-plane.yaml${extra} up -d --build`,
  ].join(" && ");
  ssh(options, cmd);
}

function composeUpScenario(options) {
  const extra = options.withControlPlane ? " --with-control-plane" : "";
  const cmd = [
    `cd ${options.remoteDir}`,
    "command -v node >/dev/null || { echo 'Node.js 24 is required on the host for scenario:up' >&2; exit 1; }",
    `node scripts/scenario-up.mjs ${options.target}${extra}`,
  ].join(" && ");
  ssh(options, cmd);
}

function installRemotePack(options) {
  const pack = resolve(expandHome(options.pack));
  if (!existsSync(pack)) {
    throw new Error(`pack not found: ${pack}`);
  }
  const remoteTar = `/tmp/${basename(pack)}`;
  const scpArgs = [];
  if (options.key) scpArgs.push("-i", options.key, "-o", "IdentitiesOnly=yes");
  scpArgs.push("-o", "BatchMode=yes", pack, `${options.user}@${options.host}:${remoteTar}`);
  console.log(`[remote-deploy] scp pack ${pack}`);
  run("scp", scpArgs);
  const listingCmd = pack.endsWith(".gz") ? `tar -tzf ${remoteTar}` : `tar -tf ${remoteTar}`;
  const top = sshCapture(
    options,
    `${listingCmd} | awk -F/ '$1 != "." && $1 !~ /^\\._/ { print $1; exit }'`,
  ).replace(/\/.*$/, "");
  if (!top) throw new Error("pack tar has no top-level directory");
  const publicHost = options.publicHost || options.host;
  const extract = pack.endsWith(".gz") ? "tar -xzf" : "tar -xf";
  ssh(
    options,
    `mkdir -p ~/lw-packs && ${extract} ${remoteTar} -C ~/lw-packs && bash ~/lw-packs/${top}/install.sh --public-host ${publicHost} --bind-addr ${options.bindAddr} --protocol ${options.protocol}`,
  );
}

function initIdentityConsole(options) {
  const identityRoot = join(metaRoot, "identity");
  if (!existsSync(join(identityRoot, "scripts", "ensure-logto-admin.mjs"))) {
    console.warn("[remote-deploy] skip --init-identity: identity/ checkout missing");
    return;
  }
  const publicHost = options.publicHost || options.host;
  return initRemoteIdentity({
    host: options.host,
    user: options.user,
    key: options.key,
    identityRoot,
    identityEndpoint: `${options.protocol || "http"}://${publicHost}:3001`,
    publicHost,
    seed: true,
  });
}

async function probeFromHere(options) {
  const host = options.publicHost || options.host;
  const urls = probeUrls(host, { protocol: options.protocol });
  const results = [];
  for (const item of urls) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      const res = await fetch(item.url, { signal: ac.signal });
      clearTimeout(timer);
      const ok = res.ok;
      results.push({ ...item, ok, status: res.status });
      console.log(`[probe] ${ok ? "OK  " : "FAIL"} ${item.name} ${res.status} ${item.url}`);
    } catch (err) {
      results.push({ ...item, ok: false, status: 0, error: String(err.message || err) });
      console.log(`[probe] FAIL ${item.name} ${item.url} — ${err.message || err}`);
    }
  }
  return results;
}

async function waitForProbes(options, { attempts = 30, delayMs = 10000 } = {}) {
  let last = [];
  for (let i = 1; i <= attempts; i += 1) {
    console.log(`[probe] attempt ${i}/${attempts}`);
    last = await probeFromHere(options);
    if (last.every((item) => item.ok)) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

function productSyncList(target) {
  const wanted = new Set();
  if (target === "agent-commerce" || target === "smart-site") {
    wanted.add("vistacast");
    wanted.add("syncrobrain");
    wanted.add("doerflow");
  }
  if (target === "smart-site") {
    wanted.add("vistaremote");
    wanted.add("dataluminary");
    wanted.add("blockyedu");
  }
  return PRODUCT_REPOS.filter((p) => wanted.has(p.key));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  if (!options.host) {
    console.error("missing --host (or DEPLOY_HOST)");
    printHelp();
    return 64;
  }
  if (!TARGETS.includes(options.target)) {
    console.error(`unknown --target ${options.target}`);
    return 64;
  }
  options.key = options.key ? resolve(expandHome(options.key)) : "";
  if (options.key && !existsSync(options.key)) {
    console.error(`SSH key not found: ${options.key}`);
    return 78;
  }
  if (!options.publicHost) options.publicHost = options.host;

  if (!options.skipBootstrap && (options.bootstrapOnly || !dockerReady(options))) {
    console.log("[remote-deploy] bootstrapping host (Docker Engine + Compose)");
    bootstrapHost(options);
    if (options.bootstrapOnly) {
      applyRegistryMirror(options);
      return 0;
    }
  }

  if (options.bootstrapOnly) return 0;

  if (options.pack) {
    options.pack = resolve(expandHome(options.pack));
    installRemotePack(options);
    if (!options.skipProbe && options.target === "control-plane") {
      const results = await waitForProbes(options, { attempts: 45, delayMs: 10000 });
      const failed = results.filter((item) => !item.ok);
      if (failed.length) {
        console.error(`[remote-deploy] ${failed.length} probe(s) failed after waiting for ready`);
        return 1;
      }
      console.log("[remote-deploy] control-plane ready (from pack)");
    }
    if (options.initIdentity) await initIdentityConsole(options);
    return 0;
  }

  applyRegistryMirror(options);

  if (!options.skipSync) {
    ssh(options, `mkdir -p ${options.remoteDir}`);
    syncTree(options, metaRoot, `${options.user}@${options.host}:${options.remoteDir}`);
    const remoteParent = dirname(options.remoteDir.replace(/\/$/, "")) || "~";
    // Sibling product repos sit beside LuminaryWorks on both laptop and host.
    for (const product of productSyncList(options.target)) {
      const src = productDir(product.key);
      const dest = `${options.user}@${options.host}:${remoteParent}/${product.dir}`;
      syncTree(options, src, dest);
    }
  }

  let controlPlaneEnv = {};
  if (options.target === "control-plane" || options.withControlPlane) {
    controlPlaneEnv = ensureRemoteControlPlaneEnv(options);
  }

  if (!options.skipUp) {
    if (options.target === "control-plane") composeUpControlPlane(options, controlPlaneEnv);
    else composeUpScenario(options);
  }

  if (!options.skipProbe && !options.skipUp && options.target === "control-plane") {
    const results = await waitForProbes(options, { attempts: 45, delayMs: 10000 });
    const failed = results.filter((item) => !item.ok);
    if (failed.length) {
      console.error(`[remote-deploy] ${failed.length} probe(s) failed after waiting for ready`);
      return 1;
    }
    console.log("[remote-deploy] control-plane ready");
  }
  if (options.initIdentity) await initIdentityConsole(options);
  return 0;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === thisFile;
if (isCli) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err.stack || err.message || err);
      process.exit(1);
    });
}
