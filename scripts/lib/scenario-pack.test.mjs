import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runHelmTemplateDryRun } from "../helm-template-dry-run.mjs";
import {
  assertIndependentProjects,
  checkAiCentralStage,
  parseProductRoots,
  preflightScenario,
  resolveScenarioProjects,
} from "./scenario-pack.mjs";
import { metaRoot } from "./workspace.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function codes(issues) {
  return issues.map((issue) => issue.code);
}

function format(result) {
  return result.issues.map((item) => `${item.code}:${item.message}`).join("; ");
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "lw-scen-"));
}

function writeRel(root, rel, contents = "name: test\nservices: {}\n") {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

const PRODUCT_FILES = {
  vistacast: ["deploy/docker-compose.core.yml", "deploy/docker-compose.dev.yml"],
  syncrobrain: ["deploy/docker-compose.core.yml", "deploy/docker-compose.dev.yml"],
  doerflow: ["deploy/docker-compose.core.yml", "deploy/docker-compose.dev.yml"],
  vistaremote: ["deploy/docker-compose.core.yml", "deploy/docker-compose.dev.yml"],
  dataluminary: [
    "deploy/standalone/compose.core.yml",
    "deploy/standalone/compose.db.yml",
    "deploy/standalone/compose.dev.yml",
  ],
  blockyedu: ["deploy/edu/docker-compose.yml", "deploy/edu/docker-compose.dev.yml"],
};

function fakeProducts(keys) {
  const productRoots = {};
  const dirs = [];
  for (const key of keys) {
    const dir = tempDir();
    dirs.push(dir);
    for (const file of PRODUCT_FILES[key]) writeRel(dir, file);
    productRoots[key] = dir;
  }
  return {
    productRoots,
    cleanup: () => {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    },
  };
}

function walkJson(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walkJson(path));
    else if (name.endsWith(".json")) out.push(path);
  }
  return out;
}

const labManifest = {
  manifestVersion: 1,
  profile: "agent-commerce",
  stage: "dev",
  capabilities: {
    identity: "central",
    entitlement: "shadow_read",
    ai: "off",
    notification: "none",
  },
  services: {
    identity: {
      url: "http://identity:3001/oidc",
      required: true,
      apiVersion: "v1",
      schemaVersion: "1",
    },
  },
  products: {
    vistacast: { url: "http://vistacast-api:18080", required: true },
    syncrobrain: { url: "http://syncrobrain-api:8080", required: true },
    doerflow: { url: "http://doerflow-api:3000", required: true },
  },
  degradation: { identity: "fail_closed" },
};

test("parseProductRoots accepts CSV and JSON", () => {
  assert.equal(parseProductRoots("vistacast=/tmp/vc,doerflow=/tmp/df").vistacast, "/tmp/vc");
  assert.equal(parseProductRoots('{"syncrobrain":"/tmp/sb"}').syncrobrain, "/tmp/sb");
});

test("missing required product compose fails and names the product", () => {
  const empty = tempDir();
  const others = fakeProducts(["syncrobrain", "doerflow"]);
  try {
    const result = preflightScenario("agent-commerce", {
      productRoots: { vistacast: empty, ...others.productRoots },
      manifest: labManifest,
      cwd: repoRoot,
    });
    assert.equal(result.ok, false);
    const missing = result.errors.filter((issue) => issue.code === "missing_product_compose");
    assert.equal(missing.length, 1);
    assert.equal(missing[0].target, "vistacast");
    assert.match(missing[0].message, /vistacast/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
    others.cleanup();
  }
});

test("smart-site depends on agent-commerce", () => {
  const isolated = tempDir();
  writeRel(
    isolated,
    "smart-site/projects.json",
    `${JSON.stringify({ scenario: "smart-site", projects: [{ product: "vistaremote", required: true }] }, null, 2)}\n`,
  );
  try {
    const resolved = resolveScenarioProjects("smart-site", { scenariosRoot: isolated });
    assert.ok(codes(resolved.issues).includes("smart_site_requires_agent_commerce"));
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("smart-site plan is incremental on agent-commerce project names", () => {
  const products = fakeProducts([
    "vistacast",
    "syncrobrain",
    "doerflow",
    "vistaremote",
    "dataluminary",
    "blockyedu",
  ]);
  try {
    const result = preflightScenario("smart-site", {
      productRoots: products.productRoots,
      manifest: { ...labManifest, profile: "smart-site" },
      cwd: repoRoot,
    });
    assert.equal(result.ok, true, format(result));
    assert.equal(result.extendsFrom, "agent-commerce");
    assert.deepEqual(
      result.plan.map((item) => item.project),
      [
        "lw-vistacast",
        "lw-syncrobrain",
        "lw-doerflow",
        "lw-vistaremote",
        "lw-dataluminary",
        "lw-blockyedu",
      ],
    );
    assertIndependentProjects(result.plan);
    assert.ok(result.plan.every((item) => item.kind === "product"));
  } finally {
    products.cleanup();
  }
});

test("ai=central is refused for production", () => {
  assert.equal(checkAiCentralStage({ capabilities: { ai: "off" }, stage: "production" }), null);
  const issue = checkAiCentralStage({ capabilities: { ai: "central" }, stage: "production" });
  assert.equal(issue.code, "capability_not_ready_for_stage");

  const products = fakeProducts(["vistacast", "syncrobrain", "doerflow"]);
  try {
    const result = preflightScenario("agent-commerce", {
      productRoots: products.productRoots,
      manifest: {
        ...labManifest,
        stage: "production",
        capabilities: { ...labManifest.capabilities, ai: "central" },
      },
      cwd: repoRoot,
    });
    assert.equal(result.ok, false);
    assert.ok(codes(result.errors).includes("capability_not_ready_for_stage"));
  } finally {
    products.cleanup();
  }
});

test("optional control plane is a separate project and is not merged", () => {
  const products = fakeProducts(["vistacast", "syncrobrain", "doerflow"]);
  try {
    const result = preflightScenario("agent-commerce", {
      productRoots: products.productRoots,
      manifest: labManifest,
      withControlPlane: true,
      cwd: repoRoot,
    });
    assert.equal(result.ok, true, format(result));
    assert.equal(result.plan[0].project, "lw-control");
    assert.equal(result.plan[0].kind, "control-plane");
    assertIndependentProjects(result.plan);
    assert.ok(result.plan[0].files.every((file) => file.includes("control-plane.yaml")));
    assert.ok(
      result.plan
        .filter((item) => item.kind === "product")
        .every((item) => item.files.every((file) => !file.endsWith("compose/control-plane.yaml"))),
    );
  } finally {
    products.cleanup();
  }
});

test("scenario preflight never concatenates two products into one compose project", () => {
  const products = fakeProducts(["vistacast", "syncrobrain", "doerflow"]);
  try {
    const result = preflightScenario("agent-commerce", {
      productRoots: products.productRoots,
      manifest: labManifest,
      cwd: repoRoot,
    });
    const fileOwners = new Map();
    for (const item of result.plan) {
      for (const file of item.files) {
        if (fileOwners.has(file)) {
          assert.fail(`file ${file} attached to both ${fileOwners.get(file)} and ${item.project}`);
        }
        fileOwners.set(file, item.project);
      }
    }
    assert.equal(result.plan.length, 3);
  } finally {
    products.cleanup();
  }
});

test("scenario peer examples use Docker DNS and never host.docker.internal", () => {
  const files = [
    join(repoRoot, "deploy/scenarios/agent-commerce/peers.env.example"),
    join(repoRoot, "deploy/scenarios/smart-site/peers.env.example"),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (line.trim().startsWith("#")) continue;
      assert.equal(line.includes("host.docker.internal"), false, `${file}: ${line}`);
    }
    assert.match(text, /luminary-control-edge/);
  }
});

test("contract fixtures are UTF-8 without BOM and parse as JSON", () => {
  const root = join(repoRoot, "deploy", "scenarios", "contracts");
  const files = walkJson(root);
  assert.ok(files.length >= 8, `expected contract JSON files, got ${files.length}`);
  for (const file of files) {
    const buf = readFileSync(file);
    assert.notEqual(buf[0], 0xef, `${file} has UTF-8 BOM`);
    const parsed = JSON.parse(buf.toString("utf8"));
    assert.ok(parsed && typeof parsed === "object");
  }
});

test("docker compose config is only for this repo's control-plane (skip if Docker missing)", () => {
  const env = {
    ...process.env,
    IDENTITY_DB_PASSWORD: "8f2c1d9e77a4b0c3aa11bb22cc33dd44",
    IDENTITY_ENDPOINT: "http://localhost:3001",
    IDENTITY_ADMIN_ENDPOINT: "http://localhost:3002",
    AUTH_GATEWAY_PUBLIC_URL: "http://localhost:3010",
    ENTITLEMENT_DB_PASSWORD: "8f2c1d9e77a4b0c3aa11bb22cc33dd45",
    ENTITLEMENT_OIDC_ISSUER: "http://identity:3001/oidc",
    ENTITLEMENT_SERVICE_API_KEY: "8f2c1d9e77a4b0c3aa11bb22cc33dd46",
    ENTITLEMENT_PARTNER_SECRET_PEPPER: "8f2c1d9e77a4b0c3aa11bb22cc33dd47",
    ENTITLEMENT_PARTNER_TOKEN_SECRET: "8f2c1d9e77a4b0c3aa11bb22cc33dd48",
    AI_VAULT_MASTER_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };
  const result = spawnSync(
    "docker",
    ["compose", "-f", "deploy/compose/control-plane.yaml", "config", "--format", "json"],
    { cwd: repoRoot, encoding: "utf8", env, shell: false },
  );
  if (result.error?.code === "ENOENT") {
    console.log("[test] docker compose config skipped: docker CLI not found");
    return;
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const config = JSON.parse(result.stdout);
  assert.ok(config.services.identity);
  assert.ok(config.services.entitlement);
  assert.equal(config.services.api, undefined);
});

test("helm template --dry-run runs when helm exists, otherwise skip is recorded", () => {
  const result = runHelmTemplateDryRun({ helmRoot: join(metaRoot, "deploy", "helm") });
  if (result.skipped) {
    assert.ok(result.reason.length > 0, "skip reason must be recorded");
    console.log(`[test] helm dry-run skipped: ${result.reason}`);
    return;
  }
  assert.equal(
    result.ok,
    true,
    result.charts.map((item) => `${item.name}:${item.reason}`).join("\n"),
  );
  assert.ok(result.charts.length >= 7);
});
