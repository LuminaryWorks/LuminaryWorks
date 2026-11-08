import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../partner-onboard.mjs";
import {
  buildPlan,
  catalogSeed,
  defaultPaths,
  prepareManifest,
  readJson,
} from "./partner-manifest.mjs";
import { assertPartnerOrAdmin, partnerScope } from "./partner-scopes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const paths = defaultPaths(root);
const fixturePath = join(root, "scripts/fixtures/partner-seventh.manifest.json");
const schema = readJson(paths.schema);

function capture() {
  let out = "";
  let err = "";
  return {
    stdout: { write(chunk) { out += chunk; } },
    stderr: { write(chunk) { err += chunk; } },
    text: () => out,
    err: () => err,
  };
}

test("schema and the six-partner manifest agree with identity/apps.json", () => {
  const manifest = readJson(paths.manifest);
  const prepared = prepareManifest(manifest, schema);
  assert.equal(prepared.ok, true, prepared.errors.join("\n"));
  assert.deepEqual(
    prepared.manifest.partners.map((partner) => partner.code),
    ["dataluminary", "blockyedu", "doerflow", "vistacast", "vistaremote", "syncrobrain"],
  );
  const sellable = Object.fromEntries(prepared.manifest.partners.map((partner) => [partner.code, partner.sellable]));
  assert.deepEqual(sellable, {
    dataluminary: true,
    blockyedu: true,
    doerflow: true,
    vistacast: false,
    vistaremote: true,
    syncrobrain: false,
  });
  const apps = readJson(paths.apps);
  const io = capture();
  assert.equal(main(["--check", "dataluminary", "--manifest", paths.manifest, "--apps", paths.apps], io), 0, io.err());
  for (const partner of prepared.manifest.partners) {
    assert.equal(partner.operatorLabel, partner.displayName);
    assert.equal(partner.supportEmail, null);
    assert.equal(partner.statusPageUrl, null);
    assert.equal(partner.status, "active");
    assert.deepEqual(partner.entitlementProductCodes, [partner.code]);
    assert.deepEqual(partner.aiServiceCredentialHint.productCodes, [partner.code]);
    assert.equal(partner.aiServiceCredentialHint.internal, false);
    assert.equal(main(["--check", partner.code], io), 0, io.err() + io.text());
  }
  const listed = capture();
  assert.equal(main(["--", "--list", "--json"], listed), 0, listed.err());
  assert.equal(JSON.parse(listed.text()).length, 6);
  const blob = JSON.stringify(manifest);
  assert.equal(blob.includes("LuminaryWorks Control Console"), false);
  assert.equal(blob.includes("LuminaryWorks Portal"), false);
  assert.equal(blob.includes("client_secret"), false);
  assert.equal(apps.spaApplications.some((app) => app.name === "DataView (DataLuminary)"), true);
});

test("seventh-partner fixture validates, plans, and does not invent prices", () => {
  const fixture = readJson(fixturePath);
  const prepared = prepareManifest(fixture, schema);
  assert.equal(prepared.ok, true, prepared.errors.join("\n"));
  const partner = prepared.manifest.partners[0];
  const emptyApps = { spaApplications: [], apiResources: [], m2mApplications: [] };
  const plan = buildPlan(partner, emptyApps, { products: {} });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.identity.ok, false);
  assert.equal(plan.identity.proposals[0].bucket, "spaApplications");
  assert.equal(Object.hasOwn(plan.identity.proposals[0].entry, "clientId"), false);
  assert.equal(plan.entitlementCatalog.readyToPost, false);
  assert.deepEqual(plan.entitlementCatalog.body.offerings, []);
  assert.deepEqual(plan.aiPlatform.credentialsEntry.productCodes, ["northwind"]);
  assert.equal(plan.aiPlatform.credentialsEntry.key, "<set outside git>");
  assert.deepEqual(plan.accountCenter, [{
    code: "northwind",
    name: "Northwind",
    url: "https://northwind.example",
    description: "Northwind",
  }]);
  assert.equal(plan.website.code, "northwind");
  assert.equal(plan.website.sellable, false);
  assert.deepEqual(plan.logtoScopes.entitlementScopes, [
    "partner:northwind:orders:read",
    "partner:northwind:catalog:read",
  ]);
  assert.deepEqual(plan.logtoScopes.aiScopes, ["partner:northwind:ai:usage:read"]);
  const priced = catalogSeed({ ...partner, sellable: true, status: "active" });
  assert.equal(priced.readyToPost, false);
  assert.equal(priced.body.offerings.length > 0, true);
  const pricedJson = JSON.stringify(priced.body.offerings);
  assert.equal(priced.body.offerings.some((row) => Object.hasOwn(row, "amountMinor")), false);
  assert.equal(pricedJson.includes("9900"), false);
  assert.equal(pricedJson.includes("19900"), false);
  assert.equal(pricedJson.includes("1200"), false);
  const io = capture();
  assert.equal(main(["--plan", "northwind", "--json", "--manifest", fixturePath, "--apps", paths.apps], io), 0);
  const parsed = JSON.parse(io.text());
  assert.equal(parsed.partner.code, "northwind");
  assert.equal(parsed.entitlementCatalog.readyToPost, false);
  assert.equal(JSON.stringify(parsed).includes("client_secret"), false);
});

test("omitted status defaults to active and secret fields fail", () => {
  const fixture = readJson(fixturePath);
  delete fixture.partners[0].status;
  const prepared = prepareManifest(fixture, schema);
  assert.equal(prepared.ok, true, prepared.errors.join("\n"));
  assert.equal(prepared.manifest.partners[0].status, "active");

  fixture.partners[0].client_secret = "nope";
  const rejected = prepareManifest(fixture, schema);
  assert.equal(rejected.ok, false);
});

test("assertPartnerOrAdmin separates platform admin from one partner", () => {
  assert.doesNotThrow(() => assertPartnerOrAdmin({ kind: "admin", scopes: [] }, "dataluminary", "orders:read"));
  assert.doesNotThrow(() => assertPartnerOrAdmin(
    { kind: "user", scopes: ["entitlement:admin"] },
    "dataluminary",
    "catalog:read",
  ));
  assert.throws(
    () => assertPartnerOrAdmin({ kind: "user", scopes: ["entitlement:admin"] }, "dataluminary", "ai:usage:read"),
    (err) => err.code === "FORBIDDEN",
  );
  assert.throws(
    () => assertPartnerOrAdmin({ kind: "user", scopes: ["ai:admin"] }, "dataluminary", "orders:read"),
    (err) => err.code === "FORBIDDEN",
  );
  assert.doesNotThrow(() => assertPartnerOrAdmin(
    { kind: "partner", partnerCode: "dataluminary", scopes: [partnerScope("dataluminary", "orders:read")] },
    "dataluminary",
    "orders:read",
  ));
  assert.throws(
    () => assertPartnerOrAdmin(
      { kind: "partner", partnerCode: "vistacast", scopes: [partnerScope("dataluminary", "orders:read")] },
      "dataluminary",
      "orders:read",
    ),
    (err) => err.code === "FORBIDDEN",
  );
  assert.throws(
    () => assertPartnerOrAdmin({ kind: "partner", scopes: ["partner:redeem"] }, "dataluminary", "orders:read"),
    (err) => err.code === "FORBIDDEN",
  );
});

test("--write-apps appends only a public placeholder template", () => {
  const dir = mkdtempSync(join(tmpdir(), "partner-onboard-"));
  const appsPath = join(dir, "apps.json");
  writeFileSync(appsPath, `${JSON.stringify({
    spaApplications: [],
    apiResources: [],
    m2mApplications: [],
  }, null, 2)}\n`);
  const io = capture();
  assert.equal(main(["--write-apps", "northwind", "--manifest", fixturePath, "--apps", appsPath], io), 0, io.err());
  const written = JSON.parse(readFileSync(appsPath, "utf8"));
  assert.equal(written.spaApplications[0].name, "Northwind Web");
  assert.equal(Object.hasOwn(written.spaApplications[0], "clientId"), false);
  assert.equal(JSON.stringify(written).includes("secret"), false);
  const bytes = readFileSync(appsPath);
  assert.notEqual(bytes[0], 0xef);
  assert.equal(main(["--write-apps", "northwind", "--manifest", fixturePath, "--apps", appsPath], capture()), 0);

  const blockedManifest = readJson(fixturePath);
  blockedManifest.partners[0].oidcApps[0].clientId = null;
  blockedManifest.partners[0].oidcApps[0].name = "Northwind Other";
  const blockedPath = join(dir, "blocked.manifest.json");
  writeFileSync(blockedPath, `${JSON.stringify(blockedManifest, null, 2)}\n`);
  const before = readFileSync(appsPath, "utf8");
  const blocked = capture();
  assert.equal(main(["--write-apps", "northwind", "--manifest", blockedPath, "--apps", appsPath], blocked), 1);
  assert.equal(readFileSync(appsPath, "utf8"), before);
  assert.match(blocked.text(), /Nothing was written/);
  rmSync(dir, { recursive: true, force: true });
});
