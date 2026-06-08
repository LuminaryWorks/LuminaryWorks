/**
 * Thin dispatcher for sub-repo commands.
 *   node scripts/run.mjs <repo> <action>
 *
 * Examples:
 *   node scripts/run.mjs identity bootstrap
 *   node scripts/run.mjs identity down
 *   node scripts/run.mjs shared build
 *   node scripts/run.mjs docs dev
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
  },
  shared: { build: "pnpm build", check: "pnpm check" },
  docs: { dev: "pnpm dev", build: "pnpm build" },
};

const cmd = map[repo]?.[action];
if (!cmd) {
  console.error(`Unknown: ${repo} ${action}\nAvailable: ${JSON.stringify(map, null, 2)}`);
  process.exit(1);
}

const dir = join(root, repo);
if (!existsSync(dir)) {
  console.error(`✗ ${repo}/ not found. Clone LuminaryWorks/${repo} here.`);
  process.exit(1);
}

console.log(`$ ${cmd}  (in ${repo}/)`);
execSync(cmd, { cwd: dir, stdio: "inherit", shell: true });
