import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  BLOCKYEDU_PACK_IDS,
  DEFAULT_BLOCKYEDU_SEED,
  enabledPackTargets,
  parseSiteIntent,
  seedEnvPatches,
} from "./site-intent.mjs";

const examplePath = join(dirname(fileURLToPath(import.meta.url)), "../../deploy/site.example.json");

test("example site intent has no secrets and names amd64", () => {
  const raw = JSON.parse(readFileSync(examplePath, "utf8"));
  const intent = parseSiteIntent(raw);
  assert.equal(intent.ok, true, JSON.stringify(intent.issues));
  assert.equal(intent.platform, "linux/amd64");
  assert.equal(intent.identity.accountsProfile, "product");
  assert.deepEqual(enabledPackTargets(intent), ["control-plane"]);
});

test("HK test site intent is http amd64 control-plane without secrets", () => {
  const hkPath = join(dirname(fileURLToPath(import.meta.url)), "../../deploy/site.hk-test.example.json");
  const raw = JSON.parse(readFileSync(hkPath, "utf8"));
  const intent = parseSiteIntent(raw);
  assert.equal(intent.ok, true, JSON.stringify(intent.issues));
  assert.equal(intent.protocol, "http");
  assert.equal(intent.platform, "linux/amd64");
  assert.ok(intent.publicHost.includes("HK") || intent.publicHost.includes("REPLACE"));
});

test("BlockyEdu seed patches course packs without passwords", () => {
  const intent = parseSiteIntent({
    publicHost: "app.example.com",
    platform: "linux/amd64",
    protocol: "https",
    profile: "standalone",
    identity: { accountsProfile: "product" },
    products: {
      blockyedu: { enabled: true, seed: { profile: "none", packs: ["syncrobrain", "dataluminary"] } },
    },
  });
  assert.equal(intent.ok, true, JSON.stringify(intent.issues));
  assert.deepEqual(seedEnvPatches(intent).blockyedu, {
    EDU_SEED_PROFILE: "none",
    EDU_SEED_PACKS: "syncrobrain,dataluminary",
    ALLOW_LOCAL_LOGIN: "false",
  });
});

test("enabled BlockyEdu without seed follows AI demo plus all course packs", () => {
  const intent = parseSiteIntent({
    publicHost: "app.example.com",
    platform: "linux/amd64",
    protocol: "https",
    products: { blockyedu: { enabled: true } },
  });
  assert.equal(intent.ok, true, JSON.stringify(intent.issues));
  assert.deepEqual(intent.products.blockyedu.seed, DEFAULT_BLOCKYEDU_SEED);
  assert.deepEqual(seedEnvPatches(intent).blockyedu, {
    EDU_SEED_PROFILE: "full-demo",
    EDU_SEED_PACKS: BLOCKYEDU_PACK_IDS.join(","),
    ALLOW_LOCAL_LOGIN: "false",
  });
});

test("explicit empty BlockyEdu packs means no platform packs", () => {
  const intent = parseSiteIntent({
    publicHost: "app.example.com",
    platform: "linux/amd64",
    protocol: "https",
    products: { blockyedu: { enabled: true, seed: { profile: "full-demo", packs: [] } } },
  });
  assert.equal(intent.ok, true, JSON.stringify(intent.issues));
  assert.deepEqual(intent.products.blockyedu.seed.packs, []);
  assert.equal(seedEnvPatches(intent).blockyedu.EDU_SEED_PACKS, "");
});

test("cleared product host is IP access and is not restored to the brand default", () => {
  const intent = parseSiteIntent({
    publicHost: "203.0.113.10",
    protocol: "http",
    platform: "linux/amd64",
    hosts: { dataluminary: "", "control-plane": "" },
    products: { dataluminary: { enabled: true } },
  });
  assert.equal(intent.hosts.dataluminary, "203.0.113.10");
  assert.equal(intent.hosts["control-plane"], "203.0.113.10");
  assert.ok(intent.issues.some((item) => item.code === "ip_access"));
});

test("VistaRemote host defaults under vistacast.dev", () => {
  const intent = parseSiteIntent({
    publicHost: "43.154.60.121",
    protocol: "http",
    platform: "linux/amd64",
    products: { vistaremote: { enabled: true } },
  });
  assert.equal(intent.hosts.vistaremote, "vistaremote.vistacast.dev");
  assert.ok(intent.issues.some((item) => item.code === "vistaremote_host_not_under_vistacast") === false);
});

test("VistaRemote host outside vistacast.dev is a warning", () => {
  const intent = parseSiteIntent({
    publicHost: "43.154.60.121",
    protocol: "https",
    platform: "linux/amd64",
    hosts: { vistaremote: "vistaremote.dev" },
    products: { vistaremote: { enabled: true } },
  });
  assert.equal(intent.ok, true);
  assert.ok(intent.issues.some((item) => item.code === "vistaremote_host_not_under_vistacast"));
});

test("site intent rejects passwords", () => {
  const intent = parseSiteIntent({
    publicHost: "app.example.com",
    products: { blockyedu: { enabled: true, POSTGRES_PASSWORD: "nope" } },
  });
  assert.equal(intent.ok, false);
  assert.ok(intent.issues.some((item) => item.code === "secret_in_site_intent"));
});
