/**
 * LuminaryWorks one-shot local bootstrap.
 *
 *   node scripts/bootstrap.mjs
 *
 * 1) brings up the identity service (Logto + PG + Redis)
 * 2) installs + builds the shared workspace (@luminary/*)
 *
 * Sub-repos (identity, shared, docs) are independent git repos cloned
 * as siblings under this MetaRepo. Missing ones are reported, not fatal.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}  (in ${cwd})`);
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

function step(name, dir, fn) {
  const full = join(root, dir);
  if (!existsSync(full)) {
    console.warn(`⚠ skip ${name}: ${dir}/ not found (clone LuminaryWorks/${dir})`);
    return;
  }
  console.log(`\n▶ ${name}`);
  fn(full);
}

console.log("=== LuminaryWorks bootstrap ===");

step("Identity service", "identity", (dir) => {
  run(isWin ? "powershell -ExecutionPolicy Bypass -File ./bootstrap.ps1" : "bash ./bootstrap.sh", dir);
});

step("Shared libraries", "shared", (dir) => {
  run("pnpm install", dir);
  run("pnpm build", dir);
});

console.log("\n✓ Bootstrap complete. Docs: pnpm docs:dev");
