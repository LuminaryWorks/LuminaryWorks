#!/usr/bin/env node
/**
 * Restore the latest nightly (or --backup) dumps into throwaway databases,
 * compare row counts, then drop those databases.
 *
 *   node scripts/pg-restore-drill.mjs
 *   node scripts/pg-restore-drill.mjs --backup .db-backups/nightly/<timestamp>
 *
 * Throwaway names are zz_drill_<database>_<suffix> and are the only databases
 * this script drops. It does not delete Docker volumes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertIdent,
  diffCounts,
  dockerOk,
  findComposeContainer,
  parseEnvFile,
  pgRestoreFromFile,
  psqlAdmin,
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

function latestNightly() {
  const nightly = join(root, ".db-backups", "nightly");
  if (!existsSync(nightly)) return null;
  const dirs = readdirSync(nightly)
    .map((name) => join(nightly, name))
    .filter((path) => statSync(path).isDirectory() && existsSync(join(path, "manifest.json")))
    .sort();
  return dirs.at(-1) ?? null;
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] || null;
}

async function main() {
  if (!dockerOk()) fail("docker is not available");
  const env = loadEnv(argValue("--env-file") || join(root, "deploy", "env", "control-plane.env"));
  const project = env.CONTROL_PLANE_PROJECT || "luminary-works";
  const admin = assertIdent(env.CONTROL_PLANE_DB_ADMIN_USER || "lw_pg", "admin");
  const container = findComposeContainer("control-plane-db", project);
  if (!container) fail(`control-plane-db is not running (project ${project})`);
  const dir = argValue("--backup") || latestNightly();
  if (!dir) fail("no nightly backup found; pass --backup");
  const dumps = readdirSync(dir).filter((name) => name.endsWith(".dump")).sort();
  if (dumps.length === 0) fail(`no dumps in ${dir}`);
  const suffix = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  let failed = 0;
  for (const dump of dumps) {
    const database = assertIdent(dump.replace(/\.dump$/, ""), "database");
    const drill = assertIdent(`zz_drill_${database}_${suffix}`.slice(0, 63), "drill database");
    if (!drill.startsWith("zz_drill_")) fail(`refusing to create ${drill}`);
    const countsPath = join(dir, `${database}.counts.json`);
    console.log(`drill ${dump} -> ${drill}`);
    psqlAdmin(
      container,
      admin,
      "postgres",
      `CREATE DATABASE ${drill}`,
    );
    try {
      await pgRestoreFromFile(container, admin, drill, join(dir, dump));
      const live = tableCounts(container, admin, drill);
      if (!existsSync(countsPath)) {
        console.log(`  restored tables=${live.tables} rows=${live.rows} (no counts file to compare)`);
        continue;
      }
      const expected = JSON.parse(readFileSync(countsPath, "utf8"));
      const mismatches = diffCounts(expected, live.byTable);
      if (mismatches.length === 0) {
        console.log(`  ok tables=${live.tables} rows=${live.rows}`);
      } else {
        failed += 1;
        console.log(`  MISMATCH ${mismatches.length} tables`);
        for (const row of mismatches.slice(0, 20)) {
          console.log(`  ${row.table} expected=${row.source} got=${row.target}`);
        }
      }
    } finally {
      psqlAdmin(container, admin, "postgres", `DROP DATABASE IF EXISTS ${drill} WITH (FORCE)`);
      console.log(`  dropped ${drill}`);
    }
  }
  if (failed > 0) fail(`restore drill failed (${failed} database(s))`);
  console.log(`restore drill ok (${dir})`);
}

main().catch((error) => fail(redact(error?.stack || error)));
