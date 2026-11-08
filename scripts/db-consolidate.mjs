#!/usr/bin/env node
/**
 * Move stray control-plane Postgres containers onto control-plane-db.
 *
 *   node scripts/db-consolidate.mjs plan
 *   node scripts/db-consolidate.mjs backup
 *   node scripts/db-consolidate.mjs restore --backup .db-backups/<timestamp>
 *   node scripts/db-consolidate.mjs verify --backup .db-backups/<timestamp>
 *
 * Dumps are custom-format pg_dump via `docker exec` (no host psql).
 * Credentials are read from deploy/env/control-plane.env and never printed.
 * Restore loads logto + notification only. A dump whose volume is the target
 * volume (the ad-hoc entitlement container on control-plane-db-data) is kept
 * for rollback and is not restored over itself.
 * Refuses a non-empty target database unless --force.
 * Does not delete Docker volumes.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertIdent,
  containerEnv,
  containerPublishedPorts,
  containerVolumeName,
  diffCounts,
  dockerOk,
  findComposeContainer,
  inspectContainer,
  listDatabases,
  logtoTenantGrantSql,
  logtoTenantStatements,
  parseEnvFile,
  pgDumpGlobals,
  pgDumpToFile,
  pgRestoreFromFile,
  psqlAdmin,
  psqlText,
  reassignOwnerSql,
  redact,
  resetPublicSchemaSql,
  restoreDecision,
  tableCounts,
} from "./lib/pg-docker.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_SOURCES = [
  {
    key: "logto",
    container: "luminary-identity-db",
    database: "logto",
    restore: true,
    targetDbEnv: "IDENTITY_DB_NAME",
    targetRoleEnv: "IDENTITY_DB_USER",
    targetDbDefault: "logto",
    targetRoleDefault: "logto",
  },
  {
    key: "notification",
    container: "luminary-notification-db",
    database: "notification",
    restore: true,
    targetDbEnv: "NOTIFICATION_DB_NAME",
    targetRoleEnv: "NOTIFICATION_DB_USER",
    targetDbDefault: "notification",
    targetRoleDefault: "notification",
  },
  {
    key: "entitlement",
    container: "luminary-entitlement-db",
    database: "entitlement",
    restore: false,
    dumpAll: true,
    targetDbEnv: "ENTITLEMENT_DB_NAME",
    targetRoleEnv: "ENTITLEMENT_DB_USER",
    targetDbDefault: "entitlement",
    targetRoleDefault: "entitlement",
  },
];

function fail(message) {
  console.error(redact(message));
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    command: argv[0] || "help",
    envFile: join(root, "deploy", "env", "control-plane.env"),
    out: join(root, ".db-backups"),
    backup: null,
    force: false,
    targetContainer: null,
    containers: {},
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) fail(`missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--env-file":
        options.envFile = resolve(next());
        break;
      case "--out":
        options.out = resolve(next());
        break;
      case "--backup":
        options.backup = resolve(next());
        break;
      case "--force":
        options.force = true;
        break;
      case "--target-container":
        options.targetContainer = next();
        break;
      case "--identity-container":
        options.containers.logto = next();
        break;
      case "--notification-container":
        options.containers.notification = next();
        break;
      case "--entitlement-container":
        options.containers.entitlement = next();
        break;
      case "--help":
      case "-h":
        options.command = "help";
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function loadEnv(path) {
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

function sourcesFrom(options, env) {
  return DEFAULT_SOURCES.map((source) => {
    const container = options.containers[source.key] || source.container;
    return {
      ...source,
      container,
      targetDb: assertIdent(env[source.targetDbEnv] || source.targetDbDefault, source.targetDbEnv),
      targetRole: assertIdent(env[source.targetRoleEnv] || source.targetRoleDefault, source.targetRoleEnv),
    };
  });
}

function ensureGitignore(parent) {
  mkdirSync(parent, { recursive: true });
  chmodSync(parent, 0o700);
  const ignore = join(parent, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n!.gitignore\n", "utf8");
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function latestBackup(parent) {
  if (!existsSync(parent)) return null;
  const dirs = readdirSync(parent)
    .filter((name) => name !== ".gitignore" && name !== "nightly")
    .map((name) => join(parent, name))
    .filter((path) => statSync(path).isDirectory() && existsSync(join(path, "manifest.json")))
    .sort();
  return dirs.at(-1) ?? null;
}

function printSummary(label, summary) {
  console.log(`${label}: tables=${summary.tables} rows=${summary.rows}`);
  const entries = Object.entries(summary.byTable);
  if (entries.length === 0) {
    console.log("  (no user tables)");
    return;
  }
  for (const [table, rows] of entries) {
    if (rows > 0) console.log(`  ${table}  ${rows}`);
  }
  const empty = entries.length - entries.filter(([, rows]) => rows > 0).length;
  if (empty > 0) console.log(`  … ${empty} empty tables omitted`);
}

function dumpUser(info, fallback) {
  const env = containerEnv(info);
  const user = env.POSTGRES_USER || fallback;
  return assertIdent(user, "POSTGRES_USER");
}

async function commandPlan(options) {
  if (!dockerOk()) fail("docker is not available");
  const env = loadEnv(options.envFile);
  const project = env.CONTROL_PLANE_PROJECT || "luminary-works";
  const admin = assertIdent(env.CONTROL_PLANE_DB_ADMIN_USER || "lw_pg", "admin");
  console.log(`env file: ${existsSync(options.envFile) ? options.envFile : "(missing, using defaults)"}`);
  console.log(`compose project: ${project}`);
  const targetName =
    options.targetContainer || findComposeContainer("control-plane-db", project);
  if (targetName && inspectContainer(targetName)?.State?.Running) {
    const info = inspectContainer(targetName);
    console.log(`target container: ${targetName} volume=${containerVolumeName(info) || "?"} ports=${containerPublishedPorts(info).join(",") || "(none)"}`);
  } else {
    console.log("target container: control-plane-db is not running");
  }
  for (const source of sourcesFrom(options, env)) {
    const info = inspectContainer(source.container);
    if (!info) {
      console.log(`source ${source.key}: container ${source.container} not found`);
      continue;
    }
    const volume = containerVolumeName(info);
    const user = dumpUser(info, admin);
    console.log(
      `source ${source.key}: container=${source.container} status=${info.State?.Status} volume=${volume || "?"} ports=${containerPublishedPorts(info).join(",") || "(none)"} restore=${source.restore ? `-> ${source.targetDb} owner ${source.targetRole}` : "backup only"}`,
    );
    if (info.State?.Status !== "running") continue;
    const databases = source.dumpAll ? listDatabases(source.container, user) : [source.database];
    for (const database of databases) {
      const summary = tableCounts(source.container, user, assertIdent(database, "database"));
      printSummary(`  db ${database}`, summary);
    }
  }
  console.log("volumes are not deleted by this script.");
}

async function commandBackup(options) {
  if (!dockerOk()) fail("docker is not available");
  const env = loadEnv(options.envFile);
  ensureGitignore(options.out);
  const dir = join(options.out, stamp());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const manifest = {
    createdAt: new Date().toISOString(),
    kind: "db-consolidate",
    sources: [],
    notes: [
      "Passwords are not stored in this manifest.",
      "Dumps of the control-plane volume are rollback copies and are not restored onto that same volume.",
    ],
  };
  for (const source of sourcesFrom(options, env)) {
    const info = inspectContainer(source.container);
    if (!info) fail(`backup: container ${source.container} not found`);
    if (info.State?.Status !== "running") fail(`backup: container ${source.container} is not running`);
    const user = dumpUser(info, "lw_pg");
    const volume = containerVolumeName(info);
    const databases = source.dumpAll ? listDatabases(source.container, user) : [source.database];
    for (const database of databases) {
      const db = assertIdent(database, "database");
      const primary = db === source.database && source.restore;
      const fileName = primary ? `${source.key}.dump` : `${source.key}__${db}.dump`;
      const file = join(dir, fileName);
      process.stdout.write(`dump ${source.container}/${db} -> ${fileName}\n`);
      await pgDumpToFile(source.container, user, db, file);
      chmodSync(file, 0o600);
      const summary = tableCounts(source.container, user, db);
      const countsFile = fileName.replace(/\.dump$/, ".counts.json");
      writeFileSync(join(dir, countsFile), `${JSON.stringify(summary.byTable, null, 2)}\n`, "utf8");
      manifest.sources.push({
        key: source.key,
        container: source.container,
        volume,
        database: db,
        dump: fileName,
        counts: countsFile,
        tables: summary.tables,
        rows: summary.rows,
        restore: primary,
        targetDb: source.targetDb,
        targetRole: source.targetRole,
      });
      printSummary(`  ${fileName}`, summary);
    }
    if (source.key === "logto") {
      const globals = join(dir, "logto-globals.sql");
      await pgDumpGlobals(source.container, user, globals);
      chmodSync(globals, 0o600);
      manifest.notes.push("logto-globals.sql holds cluster roles (tenant passwords). It is not a database dump.");
      console.log("  logto-globals.sql (tenant roles)");
    }
  }
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`backup directory: ${dir}`);
}

function resolveBackup(options) {
  const dir = options.backup || latestBackup(options.out);
  if (!dir || !existsSync(join(dir, "manifest.json"))) {
    fail("backup manifest not found; pass --backup .db-backups/<timestamp>");
  }
  return dir;
}

function targetContainer(options, env) {
  const project = env.CONTROL_PLANE_PROJECT || "luminary-works";
  const name = options.targetContainer || findComposeContainer("control-plane-db", project);
  if (!name) fail(`control-plane-db container is not running (project ${project})`);
  const info = inspectContainer(name);
  if (!info || info.State?.Status !== "running") fail(`target container ${name} is not running`);
  return { name, info, admin: assertIdent(env.CONTROL_PLANE_DB_ADMIN_USER || "lw_pg", "admin") };
}

function applyLogtoTenants(dir, target, item) {
  if (item.key !== "logto") return;
  const globalsPath = join(dir, "logto-globals.sql");
  if (!existsSync(globalsPath)) {
    console.log("logto-globals.sql missing; tenant roles were not copied");
    return;
  }
  const text = readFileSync(globalsPath, "utf8");
  const existing = new Set(
    psqlText(target.name, target.admin, "postgres", "SELECT rolname FROM pg_roles")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const statements = logtoTenantStatements(text).filter((statement) => {
    const body = statement.trim();
    if (!/^(CREATE|ALTER) ROLE\b/i.test(body)) return false;
    if (/GRANTED BY/i.test(body)) return false;
    if (!/^CREATE ROLE/i.test(body)) return true;
    const role = (body.match(/CREATE ROLE\s+"?([A-Za-z0-9_]+)/) || [])[1];
    return role && !existing.has(role);
  });
  if (statements.length > 0) {
    psqlAdmin(target.name, target.admin, "postgres", statements.join("\n"));
  }
  const memberships = [
    ...text.matchAll(/GRANT\s+(logto_tenant_[A-Za-z0-9_]+)\s+TO\s+(logto_tenant_[A-Za-z0-9_]+)/g),
  ];
  if (memberships.length > 0) {
    const membershipSql = [...new Set(memberships.map((match) => `GRANT ${match[1]} TO ${match[2]} WITH INHERIT TRUE;`))].join(
      "\n",
    );
    psqlAdmin(target.name, target.admin, "postgres", membershipSql);
  }
  const roles = [...new Set([...text.matchAll(/logto_tenant_[A-Za-z0-9_]+/g)].map((match) => match[0]))];
  if (roles.length === 0) return;
  psqlAdmin(target.name, target.admin, item.targetDb, logtoTenantGrantSql(item.targetDb, item.targetRole, roles));
  console.log(`logto tenant roles ensured: ${roles.join(", ")}`);
}

async function commandRestore(options) {
  if (!dockerOk()) fail("docker is not available");
  const env = loadEnv(options.envFile);
  const dir = resolveBackup(options);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const target = targetContainer(options, env);
  const targetVolume = containerVolumeName(target.info);
  console.log(`restore into ${target.name} volume=${targetVolume || "?"}`);
  let restored = 0;
  for (const item of manifest.sources) {
    const live = tableCounts(target.name, target.admin, assertIdent(item.targetDb, "database"));
    const decision = restoreDecision({
      restore: item.restore,
      volume: item.volume,
      targetVolume,
      targetTables: live.tables,
      force: options.force,
    });
    if (decision === "skip") {
      console.log(`skip ${item.dump} (${item.restore ? "same volume as target" : "backup only"})`);
      continue;
    }
    if (decision === "refuse") {
      const saved = JSON.parse(readFileSync(join(dir, item.counts), "utf8"));
      const mismatches = diffCounts(saved, live.byTable);
      if (mismatches.length === 0) {
        console.log(`already loaded ${item.targetDb} (${live.tables} tables, ${live.rows} rows); ensuring owner ${item.targetRole}`);
        psqlAdmin(target.name, target.admin, item.targetDb, reassignOwnerSql(item.targetRole));
        applyLogtoTenants(dir, target, item);
        restored += 1;
        continue;
      }
      fail(
        `refusing to overwrite non-empty ${item.targetDb} on ${target.name} (${live.tables} tables, ${live.rows} rows, ${mismatches.length} tables differ). Re-run with --force only if that data is disposable.`,
      );
    }
    if (decision === "replace") {
      console.log(`--force: resetting schema public on ${item.targetDb}`);
      psqlAdmin(target.name, target.admin, item.targetDb, resetPublicSchemaSql(item.targetRole));
    }
    const dumpPath = join(dir, item.dump);
    if (!existsSync(dumpPath)) fail(`missing dump ${dumpPath}`);
    console.log(`pg_restore ${item.dump} -> ${item.targetDb} (owner ${item.targetRole})`);
    await pgRestoreFromFile(target.name, target.admin, item.targetDb, dumpPath, { clean: false });
    psqlAdmin(target.name, target.admin, item.targetDb, reassignOwnerSql(item.targetRole));
    applyLogtoTenants(dir, target, item);
    restored += 1;
  }
  if (restored === 0) fail("restore did not load any database");
  console.log(`restored ${restored} database(s) from ${dir}`);
}

async function commandVerify(options) {
  if (!dockerOk()) fail("docker is not available");
  const env = loadEnv(options.envFile);
  const dir = resolveBackup(options);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const target = targetContainer(options, env);
  let failed = 0;
  for (const item of manifest.sources) {
    if (!item.counts) continue;
    const saved = JSON.parse(readFileSync(join(dir, item.counts), "utf8"));
    const sourceInfo = inspectContainer(item.container);
    const sourceRunning = sourceInfo?.State?.Status === "running";
    const sameVolume = item.volume && item.volume === containerVolumeName(target.info);
    let sourceCounts = saved;
    let sourceLabel = `backup ${item.counts}`;
    if (sourceRunning && !sameVolume) {
      const user = dumpUser(sourceInfo, target.admin);
      sourceCounts = tableCounts(item.container, user, assertIdent(item.database, "database")).byTable;
      sourceLabel = `live ${item.container}/${item.database}`;
    }
    const targetDb = item.restore ? item.targetDb : item.database;
    let targetCounts;
    try {
      targetCounts = tableCounts(target.name, target.admin, assertIdent(targetDb, "database")).byTable;
    } catch (error) {
      console.log(`verify ${item.key}/${item.database}: target database ${targetDb} not readable (${redact(error.message)})`);
      if (item.restore) failed += 1;
      continue;
    }
    const mismatches = diffCounts(sourceCounts, targetCounts);
    const sourceRows = Object.values(sourceCounts).reduce((sum, n) => sum + n, 0);
    const targetRows = Object.values(targetCounts).reduce((sum, n) => sum + n, 0);
    const comparable = item.restore || item.database === item.targetDb;
    if (!comparable) {
      console.log(
        `note ${item.database}: source ${sourceLabel} rows=${sourceRows}; target ${targetDb} rows=${targetRows} (not a restore pair)`,
      );
      continue;
    }
    if (mismatches.length === 0) {
      console.log(`ok ${item.database}: ${sourceLabel} == ${target.name}/${targetDb} tables=${Object.keys(sourceCounts).length} rows=${sourceRows}`);
    } else {
      failed += 1;
      console.log(`MISMATCH ${item.database}: ${sourceLabel} vs ${target.name}/${targetDb} (${mismatches.length} tables)`);
      for (const row of mismatches.slice(0, 40)) {
        console.log(`  ${row.table} source=${row.source} target=${row.target}`);
      }
    }
  }
  if (failed > 0) fail(`verify failed (${failed} database(s))`);
  console.log("verify ok");
}

function printHelp() {
  console.log(`Usage: node scripts/db-consolidate.mjs <plan|backup|restore|verify> [options]

  plan      Inspect source containers, volumes, and per-table row counts
  backup    pg_dump -Fc each source database into .db-backups/<timestamp>/
  restore   Load logto + notification dumps into control-plane-db
  verify    Compare source row counts (live, else the backup manifest) to the target

Options:
  --env-file <path>     default deploy/env/control-plane.env (values are not printed)
  --out <dir>           backup parent (default ./.db-backups)
  --backup <dir>        timestamp directory (restore/verify; default: newest)
  --force               replace a non-empty target database (drops schema public)
  --target-container    running control-plane-db container name
  --identity-container / --notification-container / --entitlement-container

Does not delete volumes. Does not print passwords.
`);
}

const options = parseArgs(process.argv.slice(2));
const commands = {
  plan: commandPlan,
  backup: commandBackup,
  restore: commandRestore,
  verify: commandVerify,
  help: async () => printHelp(),
};
const command = commands[options.command];
if (!command) fail(`unknown command ${options.command}`);
command(options).catch((error) => fail(error?.stack ? redact(error.stack) : String(error)));
