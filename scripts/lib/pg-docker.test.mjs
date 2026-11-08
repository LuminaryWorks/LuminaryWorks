import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertIdent,
  diffCounts,
  logtoTenantGrantSql,
  logtoTenantStatements,
  parseEnvFile,
  redact,
  restoreDecision,
  summarizeCounts,
} from "./pg-docker.mjs";

test("parseEnvFile keeps values and skips comments", () => {
  const env = parseEnvFile(`
# comment
export FOO=bar
BAZ="qux"
EMPTY=
PASSWORD=super-secret
`);
  assert.equal(env.FOO, "bar");
  assert.equal(env.BAZ, "qux");
  assert.equal(env.EMPTY, "");
  assert.equal(env.PASSWORD, "super-secret");
});

test("redact hides urls and passwords", () => {
  const text = redact("postgres://logto:s3cret@127.0.0.1:5433/logto PGPASSWORD=s3cret");
  assert.equal(text.includes("s3cret"), false);
  assert.match(text, /postgres:\/\/\*\*\*/);
});

test("assertIdent rejects injection", () => {
  assert.equal(assertIdent("logto"), "logto");
  assert.throws(() => assertIdent("logto;drop"));
  assert.throws(() => assertIdent(""));
});

test("restoreDecision refuses a non-empty target unless forced", () => {
  assert.equal(restoreDecision({ restore: true, volume: "a", targetVolume: "b", targetTables: 0, force: false }), "restore");
  assert.equal(restoreDecision({ restore: true, volume: "a", targetVolume: "b", targetTables: 3, force: false }), "refuse");
  assert.equal(restoreDecision({ restore: true, volume: "a", targetVolume: "b", targetTables: 3, force: true }), "replace");
  assert.equal(restoreDecision({ restore: true, volume: "same", targetVolume: "same", targetTables: 0, force: true }), "skip");
  assert.equal(restoreDecision({ restore: false, volume: "a", targetVolume: "b", targetTables: 0, force: true }), "skip");
});

test("logto tenant SQL keeps tenant roles and drops GRANTED BY", () => {
  const kept = logtoTenantStatements(`
CREATE ROLE logto;
ALTER ROLE logto WITH LOGIN PASSWORD 'secret';
CREATE ROLE logto_tenant_logto_default;
ALTER ROLE logto_tenant_logto_default WITH LOGIN PASSWORD 'secret2';
GRANT logto_tenant_logto TO logto_tenant_logto_default WITH INHERIT TRUE GRANTED BY logto;
`);
  assert.equal(kept.some((statement) => statement.includes("GRANTED BY")), false);
  assert.equal(kept.some((statement) => /ROLE logto WITH/.test(statement)), false);
  assert.equal(kept.filter((statement) => statement.includes("logto_tenant_logto_default")).length, 3);
  const grant = logtoTenantGrantSql("logto", "logto", ["logto_tenant_logto_default"]);
  assert.match(grant, /GRANT CONNECT, TEMPORARY ON DATABASE "logto"/);
  assert.match(grant, /FOR ROLE "logto"/);
});

test("diffCounts reports missing and changed tables", () => {
  const summary = summarizeCounts({ "public.users": 2, "public.logs": 5 });
  assert.equal(summary.tables, 2);
  assert.equal(summary.rows, 7);
  const mismatches = diffCounts({ "public.users": 2 }, { "public.users": 2, "public.logs": 1 });
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].table, "public.logs");
});
