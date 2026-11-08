/**
 * Dispatcher for identity sub-repo commands (shell/docker, not plain pnpm).
 * Plain package scripts use `pnpm --dir <path>` in package.json instead.
 *
 *   node scripts/run.mjs identity <action>
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
    // Prefer shared luminary-works stack when control-plane.env exists.
    down: "bash ../scripts/identity-compose.sh stop",
    stop: "bash ../scripts/identity-compose.sh stop",
    destroy: "bash ../scripts/identity-compose.sh down",
    register: "node scripts/register-apps.mjs",
    sync: "node scripts/sync-client-ids.mjs",
    "seed-user": "node scripts/seed-dev-user.mjs",
    ps: "bash ../scripts/identity-compose.sh ps",
  },
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
