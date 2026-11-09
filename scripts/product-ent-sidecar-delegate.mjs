/**
 * Thin product-repo delegate → sibling LuminaryWorks `pnpm ent:sidecar*`.
 *
 * Copied into product MetaRepos by `pnpm sync:ent-sidecar` (do not fork logic).
 *
 *   pnpm ent:sidecar
 *   pnpm ent:sidecar:down
 *   pnpm ent:sidecar:ps
 *
 * Override: LUMINARYWORKS_ROOT=/path/to/LuminaryWorks
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const productRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = process.argv[2] ?? "ent:sidecar";
const allowed = new Set(["ent:sidecar", "ent:sidecar:down", "ent:sidecar:ps", "ent:sidecar:ready"]);
if (!allowed.has(script)) {
  console.error(`unknown entitlement sidecar script: ${script}`);
  process.exit(1);
}

const root = process.env.LUMINARYWORKS_ROOT || join(productRoot, "..", "LuminaryWorks");
if (!existsSync(join(root, "package.json"))) {
  console.error(
    [
      `LuminaryWorks MetaRepo not found at ${root}.`,
      "Clone it next to this product (sibling) or set LUMINARYWORKS_ROOT.",
      "Entitlement Docker lives only in LuminaryWorks — products do not vendor a second stack.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`${script} → ${root}`);
const result = spawnSync("pnpm", [script], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
