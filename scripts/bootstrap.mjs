/**
 * LuminaryWorks one-shot local environment setup.
 *
 *   node scripts/bootstrap.mjs
 *   pnpm bootstrap
 *
 * 1) Identity (Logto + PG + Redis)
 * 2) shared: pnpm install + build (@luminaryworks/*)
 * 3) docs: pnpm install
 * 4) entitlement: .env → install → DB → migrate → seed
 * 5) auth-gateway: .env from example (no npm deps)
 *
 * Sibling clones (identity / shared / docs) missing → warn & skip, not fatal.
 * Product repos (DataLuminary 等) 不在 MetaRepo 内，需各自目录安装。
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

function run(cmd, cwd, { soft = false } = {}) {
  console.log(`\n$ ${cmd}  (in ${cwd})`);
  try {
    execSync(cmd, { cwd, stdio: "inherit", shell: true });
    return true;
  } catch (err) {
    if (soft) {
      console.warn(`⚠ soft-fail: ${cmd}`);
      return false;
    }
    throw err;
  }
}

function step(name, dir, fn) {
  const full = join(root, dir);
  if (!existsSync(full)) {
    console.warn(`⚠ skip ${name}: ${dir}/ not found (clone LuminaryWorks/${dir.split("/").pop()})`);
    return false;
  }
  console.log(`\n▶ ${name}`);
  fn(full);
  return true;
}

function ensureEnv(dir, exampleName = "env.example", targetName = ".env") {
  const example = join(dir, exampleName);
  const target = join(dir, targetName);
  if (existsSync(target)) {
    console.log(`  · ${targetName} already present`);
    return;
  }
  if (!existsSync(example)) {
    console.warn(`  · no ${exampleName}; skip ${targetName}`);
    return;
  }
  copyFileSync(example, target);
  console.log(`  · created ${targetName} from ${exampleName}`);
}

function assertNode24() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) {
    console.error(`✗ Node.js >= 24 required (found ${process.versions.node}). Use nvm/fnm or .nvmrc.`);
    process.exit(1);
  }
  console.log(`Node ${process.versions.node}`);
}

function assertDockerReady() {
  try {
    execSync("docker info", { stdio: "pipe", shell: true });
  } catch {
    console.error(
      "✗ Docker daemon is not running.\n" +
        "  Start Docker Desktop, wait until it is healthy, then re-run: npm run bootstrap",
    );
    process.exit(1);
  }
}

async function waitPgReady(container, { attempts = 36, intervalMs = 2500 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      execSync(`docker exec ${container} pg_isready -U entitlement -d entitlement`, {
        stdio: "pipe",
        shell: true,
      });
      console.log(`  · ${container} ready`);
      return true;
    } catch {
      process.stdout.write(`  · waiting for Postgres (${i}/${attempts})\r`);
      await sleep(intervalMs);
    }
  }
  console.warn(`\n⚠ ${container} not ready after wait; skip migrate/seed`);
  return false;
}

console.log("=== LuminaryWorks bootstrap ===");
assertNode24();
assertDockerReady();

step("Identity service", "identity", (dir) => {
  run(isWin ? "powershell -ExecutionPolicy Bypass -File ./bootstrap.ps1" : "bash ./bootstrap.sh", dir);
});

step("Shared libraries", "shared", (dir) => {
  run("pnpm install", dir);
  run("pnpm build", dir);
});

step("Docs portal", "docs", (dir) => {
  run("pnpm install", dir);
});

step("Auth gateway", "services/auth-gateway", (dir) => {
  ensureEnv(dir);
});

{
  const dir = join(root, "services/entitlement");
  if (!existsSync(dir)) {
    console.warn("⚠ skip Entitlement service: services/entitlement/ not found");
  } else {
    console.log("\n▶ Entitlement service");
    ensureEnv(dir);
    run("pnpm install", dir);
    run("docker compose up -d entitlement-db", dir);
    const ready = await waitPgReady("luminary-entitlement-db");
    if (ready) {
      run("pnpm migration:run", dir, { soft: true });
      run("pnpm seed", dir, { soft: true });
    }
  }
}

console.log(`
✓ Bootstrap complete.

Ready:
  · identity          → Logto (see identity/LOCAL_DEV_DOCKER.md)
  · shared            → @luminaryworks/* built
  · docs              → pnpm docs:dev
  · entitlement DB    → localhost:5434
  · auth-gateway env  → pnpm auth:gateway  (needs identity up)

Next (optional, long-running):
  pnpm docs:dev
  pnpm ent:dev
  pnpm auth:gateway

Product apps (DataLuminary / BlockyEdu / …) live outside this MetaRepo —
install inside each product directory separately.
`);
