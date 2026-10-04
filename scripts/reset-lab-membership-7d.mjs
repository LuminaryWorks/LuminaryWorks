#!/usr/bin/env node
/**
 * Lab-only: reset demo users' membership window to N days (default 7).
 *
 * Why: VistaRemote (and other products in ENTITLEMENT_MODE=off/shadow) read local
 * `users.plan` / `trialEndsAt`. Free + expired trial → concurrent remote sessions = 0
 * → Client shows「已达会话上限（0 台）」. Central Entitlement (when up) also needs a
 * fresh `pro` subscription / cleared `trial_redemptions` so enforce/shadow stay aligned.
 *
 * Usage (from LuminaryWorks root):
 *   pnpm lab:reset-membership
 *   pnpm lab:reset-membership -- --users user01,user03 --days 7 --plan pro
 *   pnpm lab:reset-membership -- --dry-run
 *
 * Requires local Docker: luminary-identity-db :5433, luminary-entitlement-db :5434,
 * optional vistaremote-postgres :5437.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const daysIdx = argv.indexOf("--days");
const days = Math.max(
  1,
  Number(daysIdx >= 0 ? argv[daysIdx + 1] : process.env.LAB_MEMBERSHIP_DAYS || 7) || 7,
);
const planIdx = argv.indexOf("--plan");
const planCode = String(
  planIdx >= 0 ? argv[planIdx + 1] : process.env.LAB_MEMBERSHIP_PLAN || "pro",
).toLowerCase();
if (!["pro", "trial", "ultra"].includes(planCode)) {
  console.error(`--plan must be pro|trial|ultra (got ${planCode})`);
  process.exit(1);
}
const usersIdx = argv.indexOf("--users");
const userFilter = (
  usersIdx >= 0
    ? argv[usersIdx + 1]
    : process.env.LAB_MEMBERSHIP_USERS ||
      "user01,user02,user03,user04,user05,user06,user07,user08,user09,user10"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MS_DAY = 24 * 60 * 60 * 1000;
const endsAtMs = Date.now() + days * MS_DAY;
const endsAtIso = new Date(endsAtMs).toISOString();

/** Trial-capable Hosted products (standard_7d). Always include these. */
const TRIAL_PRODUCTS = ["vistaremote", "dataluminary", "blockyedu"];
/** Lab also refreshes sellable paid seats on trial-disabled products. */
const EXTRA_PRODUCTS = ["doerflow"];
const PRODUCT_CODES =
  planCode === "trial" ? TRIAL_PRODUCTS : [...TRIAL_PRODUCTS, ...EXTRA_PRODUCTS];

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

function dockerPsql(container, user, database, sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-t", "-A"],
    {
      input: sql,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  ).trim();
}

function containerRunning(name) {
  try {
    const out = execFileSync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", name],
      { encoding: "utf8" },
    ).trim();
    return out === "true";
  } catch {
    return false;
  }
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function loadLabUsers() {
  if (!containerRunning("luminary-identity-db")) {
    throw new Error("luminary-identity-db is not running (need Logto users)");
  }
  const list = userFilter.map(sqlString).join(",");
  const raw = dockerPsql(
    "luminary-identity-db",
    "logto",
    "logto",
    `SELECT id || E'\\t' || coalesce(username,'') || E'\\t' || coalesce(primary_email,'')
     FROM users
     WHERE username IN (${list})
     ORDER BY username;`,
  );
  const rows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, username, email] = line.split("\t");
      return { id, username, email };
    });
  const missing = userFilter.filter((u) => !rows.some((r) => r.username === u));
  if (missing.length) {
    console.warn(`WARN  Logto missing usernames: ${missing.join(", ")}`);
  }
  return rows;
}

function resetEntitlement(users) {
  if (!containerRunning("luminary-entitlement-db")) {
    console.warn("WARN  luminary-entitlement-db not running — skip central grants");
    return;
  }
  const subs = users.map((u) => sqlString(u.id)).join(",");
  if (!subs) return;

  const productList = PRODUCT_CODES.map(sqlString).join(",");
  const grantPlan = planCode === "trial" ? "trial" : planCode;

  const sql = `
BEGIN;

-- Lab replay: allow trials/ensure again after this window.
DELETE FROM trial_cleanup_jobs
 WHERE trial_redemption_id IN (
   SELECT id FROM trial_redemptions WHERE logto_sub IN (${subs})
 );
DELETE FROM trial_redemptions WHERE logto_sub IN (${subs});

-- Drop pending trial notify/purge for these subjects (lab only).
DELETE FROM outbox_events
 WHERE event_type LIKE 'trial.%'
   AND (
     ${users.map((u) => `payload::text LIKE ${sqlString(`%${u.id}%`)}`).join("\n     OR ")}
   );

-- End prior USER subscriptions/grants for targeted products.
UPDATE subscriptions
   SET status = 'canceled', canceled_at = now(), updated_at = now()
 WHERE subject_kind = 'USER'
   AND subject_id IN (${subs})
   AND product_code IN (${productList})
   AND status = 'active';

UPDATE grants
   SET revoked = true, revoked_at = now(), updated_at = now()
 WHERE subject_kind = 'USER'
   AND subject_id IN (${subs})
   AND product_code IN (${productList})
   AND revoked = false;

${users
  .flatMap((u) =>
    PRODUCT_CODES.map((product) => {
      const source = grantPlan === "trial" ? "lab_trial_reset" : "lab_membership_reset";
      return `
WITH sub AS (
  INSERT INTO subscriptions (
    subject_kind, subject_id, product_code, plan_code, status,
    starts_at, ends_at, source, source_ref, organization_id
  ) VALUES (
    'USER', ${sqlString(u.id)}, ${sqlString(product)}, ${sqlString(grantPlan)}, 'active',
    now(), ${sqlString(endsAtIso)}::timestamptz, ${sqlString(source)},
    ${sqlString(`lab-reset:${u.username}`)}, NULL
  )
  RETURNING id
)
INSERT INTO grants (
  subject_kind, subject_id, product_code, plan_code, features,
  starts_at, ends_at, source, source_ref, revoked, organization_id
)
SELECT
  'USER', ${sqlString(u.id)}, ${sqlString(product)}, ${sqlString(grantPlan)}, '{}'::jsonb,
  now(), ${sqlString(endsAtIso)}::timestamptz, ${sqlString(source)},
  sub.id::text, false, NULL
FROM sub;
`;
    }),
  )
  .join("\n")}

COMMIT;
`;

  if (dryRun) {
    console.log("[dry-run] entitlement SQL chars=", sql.length);
    return;
  }
  dockerPsql("luminary-entitlement-db", "entitlement", "entitlement", sql);
  console.log(
    `OK  entitlement: ${users.length} users × ${PRODUCT_CODES.length} products → ${grantPlan} until ${endsAtIso}`,
  );
}

function resetVistaRemote(users) {
  if (!containerRunning("vistaremote-postgres")) {
    console.warn("WARN  vistaremote-postgres not running — skip VR local users");
    return;
  }
  const subs = users.map((u) => sqlString(u.id)).join(",");
  if (!subs) return;

  const vrPlan = planCode === "trial" ? "free" : planCode === "ultra" ? "pro" : planCode;
  // VR BillingPlan is free|pro|enterprise (no ultra/trial column). Trial = free + trialEndsAt.
  const billingKind = vrPlan === "free" ? "none" : "subscription";
  const sql = `
UPDATE users
   SET plan = ${sqlString(vrPlan)},
       "billingKind" = ${sqlString(billingKind)},
       "trialEndsAt" = ${sqlString(String(endsAtMs))},
       "planExpiresAt" = ${sqlString(String(endsAtMs))}
 WHERE "logtoSub" IN (${subs});
`;
  if (dryRun) {
    console.log("[dry-run] vistaremote SQL:", sql.trim());
    return;
  }
  const updated = dockerPsql(
    "vistaremote-postgres",
    "vistaremote",
    "vistaremote",
    `${sql} SELECT count(*) FROM users WHERE "logtoSub" IN (${subs});`,
  );
  const lines = updated.split("\n").filter(Boolean);
  const count = lines[lines.length - 1] ?? "?";
  console.log(
    `OK  vistaremote: matched ${count} row(s) → plan=${vrPlan} trialEndsAt/planExpiresAt=${endsAtIso}`,
  );
}

function main() {
  const entEnv = parseEnvFile(join(ROOT, "services/entitlement/.env"));
  if (entEnv.ENTITLEMENT_DATABASE_URL) {
    /* reserved for future direct-pg path */
  }

  console.log(
    `==> lab membership reset  users=${userFilter.join(",")}  plan=${planCode}  days=${days}  endsAt=${endsAtIso}${dryRun ? "  (dry-run)" : ""}`,
  );

  const users = loadLabUsers();
  if (!users.length) {
    console.error("No Logto users matched. Abort.");
    process.exit(1);
  }
  for (const u of users) {
    console.log(`  · ${u.username}  sub=${u.id}  ${u.email}`);
  }

  resetEntitlement(users);
  resetVistaRemote(users);

  console.log(`
Done. Relogin as user0x (or refresh Client entitlements).
VistaRemote「会话上限 0 台」was free + expired trial — should be ${planCode === "trial" ? 4 : 4}+ concurrent seats again.
Black screen: disconnect/rejoin after relogin; if still black, check Agent capture (not membership).
`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
