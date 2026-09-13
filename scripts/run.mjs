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
    // stop 保留容器 → Docker Desktop 下次启动仍会 unless-stopped 自启
    down: "docker compose stop",
    stop: "docker compose stop",
    // 真正拆掉栈（需再次 id:up 才恢复自启）
    destroy: "docker compose down",
    register: "node scripts/register-apps.mjs",
    sync: "node scripts/sync-client-ids.mjs",
    "seed-user": "node scripts/seed-dev-user.mjs",
    ps: "docker compose ps",
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
