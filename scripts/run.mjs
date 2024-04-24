/**
 * Thin dispatcher for sub-repo commands.
 *   node scripts/run.mjs <repo> <action>
 *
 * Examples:
 *   node scripts/run.mjs identity bootstrap
 *   node scripts/run.mjs identity down
 *   node scripts/run.mjs shared build
 *   node scripts/run.mjs docs dev
 *   node scripts/run.mjs entitlement up
 *   node scripts/run.mjs entitlement dev
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const [repo, action] = process.argv.slice(2);

const map = {
  identity: {
    bootstrap: isWin ? "powershell -ExecutionPolicy Bypass -File ./bootstrap.ps1" : "bash ./bootstrap.sh",
    down: "docker compose down",
    register: "node scripts/register-apps.mjs",
    sync: "node scripts/sync-client-ids.mjs",
    "seed-user": "node scripts/seed-dev-user.mjs",
  },
  shared: { build: "pnpm build", check: "pnpm check" },
  docs: { dev: "pnpm dev", build: "pnpm build" },
  entitlement: {
    up: "docker compose up -d",
    down: "docker compose down",
    install: "pnpm install",
    build: "pnpm build",
    check: "pnpm check",
    test: "pnpm test",
    migrate: "pnpm migration:run",
    seed: "pnpm seed",
    dev: "pnpm start:dev",
    start: "pnpm start",
  },
};

/** Nested dirs for MetaRepo-owned services (not sibling clones). */
const repoDirs = {
  entitlement: "services/entitlement",
};

const cmd = map[repo]?.[action];
if (!cmd) {
  console.error(`Unknown: ${repo} ${action}\nAvailable: ${JSON.stringify(map, null, 2)}`);
  process.exit(1);
}

const dir = join(root, repoDirs[repo] ?? repo);
if (!existsSync(dir)) {
  console.error(`✗ ${repoDirs[repo] ?? repo}/ not found. Clone LuminaryWorks/${repo} here.`);
  process.exit(1);
}

console.log(`$ ${cmd}  (in ${repo}/)`);
execSync(cmd, { cwd: dir, stdio: "inherit", shell: true });
