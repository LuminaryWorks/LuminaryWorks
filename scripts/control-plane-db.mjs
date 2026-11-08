#!/usr/bin/env node
/**
 * Bring up / stop the shared control-plane Postgres (one instance, four DBs).
 *
 *   node scripts/control-plane-db.mjs up
 *   node scripts/control-plane-db.mjs down   # stops only control-plane-db
 *   node scripts/control-plane-db.mjs stop   # alias of down
 *
 * Requires deploy/env/control-plane.env (copy from control-plane.env.example and
 * fill CONTROL_PLANE_DB_ADMIN_PASSWORD + the three *_DB_PASSWORD values).
 * Publishes 127.0.0.1:5433 via control-plane.dev-ports.yaml for host processes.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, "deploy", "env", "control-plane.env");
const example = join(root, "deploy", "env", "control-plane.env.example");
const compose = join(root, "deploy", "compose", "control-plane.yaml");
const ports = join(root, "deploy", "compose", "control-plane.dev-ports.yaml");

const action = String(process.argv[2] || "up").toLowerCase();

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(envFile)) {
  fail(
    [
      "Missing deploy/env/control-plane.env",
      `  cp ${example} ${envFile}`,
      "  Fill CONTROL_PLANE_DB_ADMIN_PASSWORD, IDENTITY_DB_PASSWORD,",
      "  ENTITLEMENT_DB_PASSWORD, NOTIFICATION_DB_PASSWORD (and other required keys).",
      "  Then re-run: pnpm ent:up   # or: node scripts/control-plane-db.mjs up",
    ].join("\n"),
  );
}

// Prefer project name from env file so shell leftovers cannot override.
let project = "luminary-works";
const projectMatch = readFileSync(envFile, "utf8").match(
  /^CONTROL_PLANE_PROJECT=(.+)$/m,
);
if (projectMatch?.[1]?.trim()) project = projectMatch[1].trim();

const base = [
  "compose",
  "--env-file",
  envFile,
  "-p",
  project,
  "-f",
  compose,
  "-f",
  ports,
];

let args;
if (action === "up") {
  args = [...base, "up", "-d", "control-plane-db"];
} else if (action === "down" || action === "stop") {
  // Stop only the shared DB — do not tear down the whole control plane.
  args = [...base, "stop", "control-plane-db"];
} else {
  fail(`Usage: node scripts/control-plane-db.mjs <up|down|stop> (got ${action})`);
}

if (action === "up") {
  for (const volume of ["luminary_works_pg", "luminary_works_ai_platform_data"]) {
    const ensure = spawnSync("docker", ["volume", "create", volume], {
      cwd: root,
      stdio: "ignore",
      shell: false,
    });
    // create is idempotent; ignore non-zero when volume already exists
    void ensure;
  }
}

const result = spawnSync("docker", args, { cwd: root, stdio: "inherit", shell: false });
if (result.status !== 0) {
  process.exit(result.status || 1);
}

if (action === "up") {
  console.log(
    [
      "",
      "control-plane-db is up (host 127.0.0.1:5433).",
      "  entitlement  → postgres://entitlement:<ENTITLEMENT_DB_PASSWORD>@127.0.0.1:5433/entitlement",
      "  notification → postgres://notification:<NOTIFICATION_DB_PASSWORD>@127.0.0.1:5433/notification",
      "  logto        → postgres://logto:<IDENTITY_DB_PASSWORD>@127.0.0.1:5433/logto",
      "  ai_platform  → postgres://ai_platform:<AI_PLATFORM_DB_PASSWORD>@127.0.0.1:5433/ai_platform",
      "Copy those passwords into services/*/ .env DATABASE_URL values.",
    ].join("\n"),
  );
}
