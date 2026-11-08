/**
 * Docker-exec Postgres helpers for control-plane backup / restore.
 * Passwords are never written to logs. Callers must not print env values.
 */
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertIdent(value, label = "identifier") {
  const text = String(value ?? "");
  if (!IDENT.test(text)) {
    throw new Error(`refusing unsafe ${label}`);
  }
  return text;
}

export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function redact(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgres://***")
    .replace(/\b(?:PG)?PASSWORD=[^\s]+/gi, "PASSWORD=***")
    .replace(/\bMC_HOST_[A-Za-z0-9_]+=\S+/g, "MC_HOST_***=***");
}

export function quoteIdent(value) {
  return `"${assertIdent(value)}"`;
}

export function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** @returns {"skip"|"refuse"|"replace"|"restore"} */
export function restoreDecision({ restore, volume, targetVolume, targetTables, force }) {
  if (!restore) return "skip";
  if (volume && targetVolume && volume === targetVolume) return "skip";
  if (targetTables > 0 && !force) return "refuse";
  if (targetTables > 0 && force) return "replace";
  return "restore";
}

/** Keep Logto tenant role statements. Never returns the parent `logto` role password. */
export function logtoTenantStatements(globalsSql) {
  const statements = String(globalsSql)
    .split(/;\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = [];
  for (const statement of statements) {
    if (!/logto_tenant_[A-Za-z0-9_]+/.test(statement)) continue;
    if (/\bDROP\b/i.test(statement)) continue;
    if (/^GRANT\b/i.test(statement)) {
      kept.push(`${statement.replace(/\s+GRANTED BY\s+[A-Za-z0-9_]+/i, "")};`);
      continue;
    }
    kept.push(statement.endsWith(";") ? statement : `${statement};`);
  }
  return kept;
}

export function logtoTenantGrantSql(database, ownerRole, tenantRoles) {
  const db = quoteIdent(assertIdent(database, "database"));
  const owner = quoteIdent(assertIdent(ownerRole, "role"));
  const list = tenantRoles.map((role) => quoteIdent(assertIdent(role, "role"))).join(", ");
  if (!list) return "";
  return `
GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${list};
GRANT ALL ON SCHEMA public TO ${list};
GRANT ALL ON ALL TABLES IN SCHEMA public TO ${list};
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${list};
ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT ALL ON TABLES TO ${list};
ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT ALL ON SEQUENCES TO ${list};
`;
}

export function summarizeCounts(byTable) {
  const entries = Object.entries(byTable);
  let rows = 0;
  for (const [, count] of entries) rows += count;
  return { tables: entries.length, rows, byTable };
}

export function diffCounts(source, target) {
  const keys = new Set([...Object.keys(source), ...Object.keys(target)]);
  const mismatches = [];
  for (const key of [...keys].sort()) {
    const left = source[key];
    const right = target[key];
    if (left !== right) mismatches.push({ table: key, source: left ?? null, target: right ?? null });
  }
  return mismatches;
}

function dockerBin() {
  return "docker";
}

export function dockerOk() {
  const result = spawnSync(dockerBin(), ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
  });
  return result.status === 0;
}

export function inspectContainer(name) {
  const result = spawnSync(dockerBin(), ["inspect", name], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) return null;
  const parsed = JSON.parse(result.stdout);
  return parsed[0] ?? null;
}

export function containerEnv(info) {
  const out = {};
  for (const item of info?.Config?.Env ?? []) {
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    out[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return out;
}

export function containerVolumeName(info) {
  const mount = (info?.Mounts ?? []).find((item) => item.Destination === "/var/lib/postgresql/data");
  return mount?.Name || mount?.Source || "";
}

export function containerPublishedPorts(info) {
  const bindings = info?.HostConfig?.PortBindings ?? {};
  const ports = [];
  for (const [containerPort, hosts] of Object.entries(bindings)) {
    for (const host of hosts ?? []) {
      ports.push(`${host.HostIp || "0.0.0.0"}:${host.HostPort}->${containerPort}`);
    }
  }
  return ports;
}

export function findComposeContainer(service, project) {
  const filters = ["ps", "-aq", "--filter", `label=com.docker.compose.service=${service}`];
  if (project) filters.push("--filter", `label=com.docker.compose.project=${project}`);
  const result = spawnSync(dockerBin(), filters, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(redact(result.stderr || "docker ps failed"));
  }
  const ids = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (ids.length === 0) return null;
  const inspect = spawnSync(dockerBin(), ["inspect", ...ids], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (inspect.status !== 0) throw new Error(redact(inspect.stderr || "docker inspect failed"));
  const rows = JSON.parse(inspect.stdout);
  const running = rows.find((row) => row.State?.Status === "running");
  return (running ?? rows[0])?.Name?.replace(/^\//, "") ?? null;
}

function runPsql(container, user, database, sql) {
  assertIdent(user, "role");
  assertIdent(database, "database");
  const result = spawnSync(
    dockerBin(),
    ["exec", "-i", container, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-At", "-F", "|", "-c", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(redact(result.stderr || result.stdout || `psql failed on ${database}`));
  }
  return result.stdout;
}

export function listDatabases(container, user) {
  const sql =
    "SELECT datname FROM pg_database WHERE datistemplate = false AND datname <> 'postgres' ORDER BY 1";
  return runPsql(container, user, "postgres", sql)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function tableCounts(container, user, database) {
  const listSql = `
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY 1, 2
  `;
  const lines = runPsql(container, user, database, listSql)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const tables = [];
  for (const line of lines) {
    const [schema, table] = line.split("|");
    if (!schema || !table) continue;
    tables.push({ schema: assertIdent(schema, "schema"), table: assertIdent(table, "table") });
  }
  if (tables.length === 0) return summarizeCounts({});
  const union = tables
    .map(
      (item) =>
        `SELECT ${sqlLiteral(`${item.schema}.${item.table}`)} AS t, count(*)::bigint AS c FROM ${quoteIdent(item.schema)}.${quoteIdent(item.table)}`,
    )
    .join(" UNION ALL ");
  const counted = runPsql(container, user, database, union);
  const byTable = {};
  for (const line of counted.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.lastIndexOf("|");
    if (sep < 0) continue;
    const key = trimmed.slice(0, sep);
    const rows = Number(trimmed.slice(sep + 1));
    if (!Number.isFinite(rows)) continue;
    byTable[key] = rows;
  }
  return summarizeCounts(byTable);
}

export function reassignOwnerSql(role) {
  const safe = assertIdent(role, "role");
  return `
DO $$
DECLARE r record;
BEGIN
  EXECUTE format('ALTER SCHEMA public OWNER TO %I', '${safe}');
  EXECUTE format('GRANT ALL ON SCHEMA public TO %I', '${safe}');
  FOR r IN
    SELECT n.nspname AS ns
    FROM pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
      AND n.nspname NOT LIKE 'pg_%'
  LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', r.ns, '${safe}');
    EXECUTE format('GRANT ALL ON SCHEMA %I TO %I', r.ns, '${safe}');
  END LOOP;
  FOR r IN
    SELECT n.nspname AS ns, c.relname AS name, c.relkind AS kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  LOOP
    IF r.kind = 'S' THEN
      EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', r.ns, r.name, '${safe}');
    ELSIF r.kind IN ('v', 'm') THEN
      EXECUTE format('ALTER VIEW %I.%I OWNER TO %I', r.ns, r.name, '${safe}');
    ELSE
      EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', r.ns, r.name, '${safe}');
    END IF;
  END LOOP;
  FOR r IN
    SELECT n.nspname AS ns, t.typname AS name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND t.typtype IN ('e', 'd')
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO %I', r.ns, r.name, '${safe}');
  END LOOP;
END
$$;
`;
}

export function psqlAdmin(container, user, database, sql) {
  runPsql(container, user, database, sql);
}

export function psqlText(container, user, database, sql) {
  return runPsql(container, user, database, sql);
}

export function pgDumpGlobals(container, user, file) {
  assertIdent(user, "role");
  return spawnDocker(["exec", "-i", container, "pg_dumpall", "-U", user, "--globals-only"], { stdoutPath: file });
}

export function resetPublicSchemaSql(role) {
  const safe = assertIdent(role, "role");
  return `
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
ALTER SCHEMA public OWNER TO ${quoteIdent(safe)};
GRANT ALL ON SCHEMA public TO ${quoteIdent(safe)};
REVOKE ALL ON SCHEMA public FROM PUBLIC;
`;
}

function spawnDocker(args, { stdinPath, stdoutPath } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBin(), args, { stdio: ["pipe", "pipe", "pipe"] });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    let stdoutDone = Promise.resolve();
    if (stdoutPath) {
      stdoutDone = new Promise((res, rej) => {
        const file = createWriteStream(stdoutPath, { mode: 0o600 });
        child.stdout.pipe(file);
        file.on("finish", res);
        file.on("error", rej);
      });
    } else {
      child.stdout.resume();
    }
    child.stdin.on("error", (error) => {
      if (error?.code !== "EPIPE") reject(error);
    });
    if (stdinPath) {
      const input = createReadStream(stdinPath);
      input.on("error", (error) => {
        if (error?.code !== "EPIPE") reject(error);
      });
      input.pipe(child.stdin);
    } else {
      child.stdin.end();
    }
    child.on("error", reject);
    child.on("close", (code) => {
      const errText = redact(Buffer.concat(stderr).toString("utf8"));
      stdoutDone.then(
        () => {
          if (code !== 0) reject(new Error(errText || `docker exited ${code}`));
          else resolve({ stderr: errText });
        },
        reject,
      );
    });
  });
}

export function pgDumpToFile(container, user, database, file) {
  assertIdent(user, "role");
  assertIdent(database, "database");
  return spawnDocker(
    ["exec", "-i", container, "pg_dump", "-U", user, "-d", database, "-Fc", "--no-password"],
    { stdoutPath: file },
  );
}

export function pgRestoreFromFile(container, user, database, file, { clean = false } = {}) {
  assertIdent(user, "role");
  assertIdent(database, "database");
  const args = [
    "exec",
    "-i",
    container,
    "pg_restore",
    "-U",
    user,
    "-d",
    database,
    "--no-owner",
    "--no-acl",
    "--exit-on-error",
    "--single-transaction",
    "--no-password",
  ];
  if (clean) args.push("--clean", "--if-exists");
  return spawnDocker(args, { stdinPath: file });
}
