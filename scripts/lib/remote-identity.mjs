/**
 * Initialize Logto on a remote Compose control plane.
 *
 * Admin Console lives on loopback :3002. Calling it through an SSH tunnel on a
 * different local port fails with oidc.invalid_client (Host ≠ ADMIN_ENDPOINT).
 * This module runs the admin-tenant bootstrap inside the identity container.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = dirname(fileURLToPath(import.meta.url));
const adminInContainer = join(thisDir, "logto-admin-in-container.cjs");

export const DEFAULT_IDENTITY_CONTAINERS = {
  identity: "luminary-control-plane-identity-1",
  identityDb: "luminary-control-plane-identity-db-1",
};

export function parsePsqlScalar(out) {
  return String(out || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && line !== "SET") || "";
}

export function generateM2mAppId() {
  return `lw${Math.random().toString(36).slice(2, 11)}${Math.random().toString(36).slice(2, 12)}`.slice(
    0,
    21,
  );
}

export function generateM2mSecret() {
  return randomBytes(24).toString("base64url").slice(0, 32);
}

export function renderCreateM2mSql({ appId, secret, roleId, roleLinkId }) {
  return `\\set ON_ERROR_STOP on
SET ROLE logto_tenant_logto_default;
INSERT INTO applications (tenant_id, id, name, secret, description, type, oidc_client_metadata)
VALUES (
  'default',
  '${appId}',
  'LuminaryWorks Dev M2M',
  '${secret}',
  'Bootstrap M2M for register-apps',
  'MachineToMachine',
  '{"redirectUris":[],"postLogoutRedirectUris":[]}'
);
INSERT INTO applications_roles (tenant_id, id, application_id, role_id)
VALUES ('default', '${roleLinkId}', '${appId}', '${roleId}');
SELECT id, name, type FROM applications WHERE id='${appId}';
`;
}

function sshBits(options) {
  const args = ["ssh", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new"];
  if (options.key) args.push("-i", options.key);
  args.push(`${options.user}@${options.host}`);
  return args;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: options.stdio || "pipe",
    input: options.input,
    env: options.env,
    cwd: options.cwd,
    shell: false,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim() || `${cmd} exit ${result.status}`;
    throw new Error(err);
  }
  return result.stdout || "";
}

function ssh(options, remote) {
  return run(sshBits(options)[0], [...sshBits(options).slice(1), remote]);
}

function scp(options, local, remote) {
  const args = ["-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes"];
  if (options.key) args.push("-i", options.key);
  args.push(local, `${options.user}@${options.host}:${remote}`);
  run("scp", args);
}

export async function tryManagementToken({ endpoint, appId, secret, resource }) {
  if (!appId || !secret) return false;
  const basic = Buffer.from(`${appId}:${secret}`).toString("base64");
  try {
    const tokenRes = await fetch(`${endpoint.replace(/\/$/, "")}/oidc/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        resource: resource || "https://default.logto.app/api",
        scope: "all",
      }),
    });
    if (!tokenRes.ok) return false;
    const { access_token: accessToken } = await tokenRes.json();
    if (!accessToken) return false;
    const probe = await fetch(`${endpoint.replace(/\/$/, "")}/api/applications?page=1&page_size=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return probe.ok;
  } catch {
    return false;
  }
}

export async function ensureRemoteLogtoAdmin(options) {
  const identity = options.identityContainer || DEFAULT_IDENTITY_CONTAINERS.identity;
  const identityDb = options.identityDbContainer || DEFAULT_IDENTITY_CONTAINERS.identityDb;
  const secretOut = ssh(
    options,
    `docker exec ${identityDb} psql -U logto -d logto -tAc "SET ROLE logto_tenant_logto_admin; SELECT secret FROM applications WHERE id = 'm-admin' LIMIT 1;"`,
  );
  const secret = parsePsqlScalar(secretOut);
  if (!secret) throw new Error("missing admin-tenant application m-admin");

  const tmp = mkdtempSync(join(tmpdir(), "lw-id-admin-"));
  try {
    const secretFile = join(tmp, "m-admin.secret");
    writeFileSync(secretFile, `${secret}\n`, { mode: 0o600 });
    scp(options, secretFile, "/tmp/lw-m-admin.secret");
    scp(options, adminInContainer, "/tmp/logto-admin-in-container.cjs");
    ssh(options, `docker cp /tmp/lw-m-admin.secret ${identity}:/tmp/m-admin.secret`);
    ssh(options, `docker cp /tmp/logto-admin-in-container.cjs ${identity}:/tmp/logto-admin-in-container.cjs`);
    const envFlags = [
      `-e M_ADMIN_SECRET_FILE=/tmp/m-admin.secret`,
      `-e LW_LOGTO_ADMIN_USERNAME=${shellQuote(options.adminUsername)}`,
      `-e LW_LOGTO_ADMIN_PASSWORD=${shellQuote(options.adminPassword)}`,
    ];
    if (options.adminEmail) envFlags.push(`-e LW_LOGTO_ADMIN_EMAIL=${shellQuote(options.adminEmail)}`);
    if (options.resetPassword) envFlags.push("-e LW_LOGTO_ADMIN_RESET_PASSWORD=1");
    const out = ssh(
      options,
      `docker exec ${envFlags.join(" ")} ${identity} node /tmp/logto-admin-in-container.cjs`,
    );
    console.log(out.trimEnd());
    ssh(
      options,
      `rm -f /tmp/lw-m-admin.secret /tmp/logto-admin-in-container.cjs; docker exec ${identity} rm -f /tmp/m-admin.secret /tmp/logto-admin-in-container.cjs`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export async function ensureRemoteManagementM2m(options) {
  const endpoint = String(options.identityEndpoint || "").replace(/\/$/, "");
  if (!endpoint) throw new Error("identityEndpoint required");
  const resource = options.resource || "https://default.logto.app/api";
  const identityDb = options.identityDbContainer || DEFAULT_IDENTITY_CONTAINERS.identityDb;

  if (options.appId && options.appSecret) {
    if (await tryManagementToken({ endpoint, appId: options.appId, secret: options.appSecret, resource })) {
      console.log(`[remote-identity] M2M credentials OK: ${options.appId}`);
      return { appId: options.appId, appSecret: options.appSecret, created: false };
    }
    console.warn(`[remote-identity] existing M2M invalid; creating a new app`);
  }

  const roleOut = ssh(
    options,
    `docker exec ${identityDb} psql -U logto -d logto -tAc "SET ROLE logto_tenant_logto_default; SELECT id FROM roles WHERE name = 'Logto Management API access' AND type = 'MachineToMachine' LIMIT 1;"`,
  );
  const roleId = parsePsqlScalar(roleOut);
  if (!roleId) {
    throw new Error('Missing Logto role "Logto Management API access"');
  }
  const appId = generateM2mAppId();
  const secret = generateM2mSecret();
  const roleLinkId = `${appId}r`.slice(0, 21);
  const sql = renderCreateM2mSql({ appId, secret, roleId, roleLinkId });
  const tmp = mkdtempSync(join(tmpdir(), "lw-id-m2m-"));
  try {
    const sqlFile = join(tmp, "create-m2m.sql");
    writeFileSync(sqlFile, sql);
    scp(options, sqlFile, "/tmp/lw-create-m2m.sql");
    ssh(
      options,
      `docker cp /tmp/lw-create-m2m.sql ${identityDb}:/tmp/create-m2m.sql && docker exec ${identityDb} psql -U logto -d logto -f /tmp/create-m2m.sql && docker exec ${identityDb} rm -f /tmp/create-m2m.sql && rm -f /tmp/lw-create-m2m.sql`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (!(await tryManagementToken({ endpoint, appId, secret, resource }))) {
    throw new Error("Token failed after M2M create");
  }
  console.log(`[remote-identity] created Management API M2M: ${appId}`);
  return { appId, appSecret: secret, created: true };
}

export function loadIdentityFileEnv(identityRoot) {
  const map = {};
  const path = join(identityRoot, ".env");
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map[m[1]] = v;
  }
  return map;
}

export async function initRemoteIdentity(options) {
  const fileEnv = loadIdentityFileEnv(options.identityRoot || "");
  const adminUsername =
    process.env.LW_LOGTO_ADMIN_USERNAME || fileEnv.LW_LOGTO_ADMIN_USERNAME || "logto_admin";
  const adminPassword = process.env.LW_LOGTO_ADMIN_PASSWORD || fileEnv.LW_LOGTO_ADMIN_PASSWORD || "";
  const adminEmail = process.env.LW_LOGTO_ADMIN_EMAIL || fileEnv.LW_LOGTO_ADMIN_EMAIL || "";
  if (!adminPassword) {
    throw new Error("LW_LOGTO_ADMIN_PASSWORD missing (identity/.env or process env)");
  }

  console.log("[remote-identity] ensuring Logto Admin Console operator (inside identity container)");
  await ensureRemoteLogtoAdmin({
    ...options,
    adminUsername,
    adminPassword,
    adminEmail,
    resetPassword: process.env.LW_LOGTO_ADMIN_RESET_PASSWORD === "1",
  });

  const identityEndpoint = (
    options.identityEndpoint ||
    process.env.IDENTITY_ENDPOINT ||
    `http://${options.publicHost || options.host}:3001`
  ).replace(/\/$/, "");

  const m2m = await ensureRemoteManagementM2m({
    ...options,
    identityEndpoint,
    appId: process.env.LOGTO_M2M_APP_ID,
    appSecret: process.env.LOGTO_M2M_APP_SECRET,
  });

  const labOutDir =
    options.labOutDir ||
    join(options.identityRoot || ".", "..", "dist", "identity-lab");
  mkdirSync(labOutDir, { recursive: true });
  writeFileSync(
    join(labOutDir, "m2m.env"),
    [
      `IDENTITY_ENDPOINT=${identityEndpoint}`,
      `IDP_ISSUER=${identityEndpoint}/oidc`,
      `LOGTO_M2M_APP_ID=${m2m.appId}`,
      `LOGTO_M2M_APP_SECRET=${m2m.appSecret}`,
      `LOGTO_MANAGEMENT_API_RESOURCE=https://default.logto.app/api`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const identityRoot = options.identityRoot;
  if (options.seed !== false && identityRoot && existsSync(join(identityRoot, "scripts", "seed-accounts.mjs"))) {
    const env = {
      ...process.env,
      IDENTITY_ENDPOINT: identityEndpoint,
      IDP_ISSUER: `${identityEndpoint}/oidc`,
      LOGTO_M2M_APP_ID: m2m.appId,
      LOGTO_M2M_APP_SECRET: m2m.appSecret,
      LOGTO_MANAGEMENT_API_RESOURCE: "https://default.logto.app/api",
      IDENTITY_ACCOUNTS_PROFILE: process.env.IDENTITY_ACCOUNTS_PROFILE || "dev",
      IDENTITY_REGISTERED_APPS_PATH:
        process.env.IDENTITY_REGISTERED_APPS_PATH || join(labOutDir, "registered-apps.json"),
      IDENTITY_SEED_STATE_PATH:
        process.env.IDENTITY_SEED_STATE_PATH || join(labOutDir, "ACCOUNTS.dev.seeded.json"),
    };
    if (existsSync(join(identityRoot, "scripts", "register-apps.mjs"))) {
      console.log("[remote-identity] register-apps.mjs");
      run("node", [join(identityRoot, "scripts", "register-apps.mjs")], {
        cwd: identityRoot,
        env,
        stdio: "inherit",
      });
    }
    console.log("[remote-identity] seed-accounts.mjs");
    run("node", [join(identityRoot, "scripts", "seed-accounts.mjs")], {
      cwd: identityRoot,
      env,
      stdio: "inherit",
    });
  }

  return { identityEndpoint, m2m };
}
