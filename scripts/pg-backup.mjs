#!/usr/bin/env node
/**
 * Nightly logical backup of each control-plane database.
 *
 *   node scripts/pg-backup.mjs
 *   PG_BACKUP_RETENTION_DAYS=14 node scripts/pg-backup.mjs
 *
 * Writes .db-backups/nightly/<timestamp>/<db>.dump plus <db>.counts.json.
 * Deletes nightly directories older than the retention window (default 14 days).
 * Never deletes sibling consolidate backups or Docker volumes.
 *
 * Upload is optional. If PG_BACKUP_UPLOAD_COMMAND is set, it is run with
 * PG_BACKUP_DIR set. If PG_BACKUP_S3_ENDPOINT plus AISTOR_BACKUP_ACCESS_KEY and
 * AISTOR_BACKUP_SECRET_KEY are set and `mc` is on PATH, the directory is copied
 * to the backup-staging bucket. Missing upload config is not an error.
 * Passwords are not printed.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertIdent,
  dockerOk,
  findComposeContainer,
  parseEnvFile,
  pgDumpToFile,
  redact,
  tableCounts,
} from "./lib/pg-docker.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(redact(message));
  process.exit(1);
}

function loadEnv(path) {
  if (!existsSync(path)) fail(`missing env file ${path}`);
  return parseEnvFile(readFileSync(path, "utf8"));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function prune(nightly, days) {
  if (!existsSync(nightly)) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(nightly)) {
    const path = join(nightly, name);
    if (!statSync(path).isDirectory()) continue;
    if (statSync(path).mtimeMs >= cutoff) continue;
    rmSync(path, { recursive: true, force: true });
    console.log(`pruned ${name}`);
  }
}

function upload(dir, env) {
  const hook = env.PG_BACKUP_UPLOAD_COMMAND || "";
  if (hook) {
    const result = spawnSync("sh", ["-c", hook], {
      env: { ...process.env, PG_BACKUP_DIR: dir },
      encoding: "utf8",
    });
    if (result.status !== 0) {
      console.error(`upload hook failed (dumps kept): ${redact(result.stderr || result.stdout || "")}`);
    } else {
      console.log("upload hook finished");
    }
  }
  const endpoint = env.PG_BACKUP_S3_ENDPOINT || "";
  const access = env.AISTOR_BACKUP_ACCESS_KEY || "";
  const secret = env.AISTOR_BACKUP_SECRET_KEY || "";
  if (!endpoint || !access || !secret) {
    console.log("object-storage upload not configured (skipped)");
    return;
  }
  const mc = spawnSync("mc", ["--version"], { encoding: "utf8" });
  if (mc.error?.code === "ENOENT" || mc.status !== 0) {
    console.log("object-storage credentials present but mc is not installed (skipped)");
    return;
  }
  const bucket = env.PG_BACKUP_S3_BUCKET || "backup-staging";
  const scheme = endpoint.startsWith("http://") ? "http" : "https";
  const host = endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const alias = `lwbackup/${bucket}/pg/${dir.split("/").at(-1)}`;
  const result = spawnSync("mc", ["cp", "--recursive", dir, alias], {
    env: { ...process.env, MC_HOST_lwbackup: `${scheme}://${access}:${secret}@${host}` },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`mc upload failed (dumps kept): ${redact(result.stderr || result.stdout || "")}`);
    return;
  }
  console.log(`uploaded to ${bucket}`);
}

async function main() {
  if (!dockerOk()) fail("docker is not available");
  const envPath = process.argv.includes("--env-file")
    ? process.argv[process.argv.indexOf("--env-file") + 1]
    : join(root, "deploy", "env", "control-plane.env");
  const env = loadEnv(envPath);
  const project = env.CONTROL_PLANE_PROJECT || "luminary-works";
  const admin = assertIdent(env.CONTROL_PLANE_DB_ADMIN_USER || "lw_pg", "admin");
  const databases = [
    env.IDENTITY_DB_NAME || "logto",
    env.ENTITLEMENT_DB_NAME || "entitlement",
    env.NOTIFICATION_DB_NAME || "notification",
    env.AI_PLATFORM_DB_NAME || "ai_platform",
  ].map((name) => assertIdent(name, "database"));
  const container = findComposeContainer("control-plane-db", project);
  if (!container) fail(`control-plane-db is not running (project ${project})`);
  const parent = join(root, ".db-backups");
  const nightly = join(parent, "nightly");
  mkdirSync(nightly, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  const ignore = join(parent, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n!.gitignore\n", "utf8");
  const days = Number(env.PG_BACKUP_RETENTION_DAYS || process.env.PG_BACKUP_RETENTION_DAYS || 14);
  if (!Number.isFinite(days) || days < 1) fail("PG_BACKUP_RETENTION_DAYS must be a positive number");
  const dir = join(nightly, stamp());
  mkdirSync(dir, { mode: 0o700 });
  for (const database of databases) {
    const dump = join(dir, `${database}.dump`);
    process.stdout.write(`dump ${database}\n`);
    await pgDumpToFile(container, admin, database, dump);
    chmodSync(dump, 0o600);
    const summary = tableCounts(container, admin, database);
    writeFileSync(join(dir, `${database}.counts.json`), `${JSON.stringify(summary.byTable, null, 2)}\n`, "utf8");
    console.log(`  ${database}: tables=${summary.tables} rows=${summary.rows}`);
  }
  writeFileSync(
    join(dir, "manifest.json"),
    `${JSON.stringify({ createdAt: new Date().toISOString(), kind: "nightly", databases }, null, 2)}\n`,
    "utf8",
  );
  prune(nightly, days);
  upload(dir, { ...env, ...process.env });
  console.log(`nightly backup: ${dir}`);
}

main().catch((error) => fail(redact(error?.stack || error)));
