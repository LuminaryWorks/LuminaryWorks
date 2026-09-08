import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collectRequiredComposeVars } from "./docker-registry.mjs";
import { CONTROL_PLANE_PACK_IMAGES } from "./pack-release.mjs";
import {
  AISTOR_IMAGE_PLACEHOLDER_TAG,
  AISTOR_MC_IMAGE_TEST_DIGEST,
  AISTOR_MINIO_IMAGE_PLACEHOLDER,
  AISTOR_MINIO_IMAGE_TEST_DIGEST,
  DEFAULT_BUCKET_QUOTA_GIB,
  OBJECT_STORAGE_BUCKETS,
  OBJECT_STORAGE_BUDGET_BYTES,
  OBJECT_STORAGE_BUDGET_GIB,
  OBJECT_STORAGE_COMPOSE_OVERLAY,
  OBJECT_STORAGE_DOC_PATHS,
  OBJECT_STORAGE_IDENTITIES,
  assertPackExcludesObjectStorage,
  assertQuotaSumWithinBudget,
  attachPolicyAttempts,
  bucketPolicyDocument,
  buildAdmissionStatus,
  buildBootstrapPlan,
  checkObjectStorageCompose,
  evaluateWatermarks,
  isFloatingImageTag,
  isMinioCommunityImage,
  isPinnedAistorImage,
  isUnconfirmedImageRef,
  loadPolicyFile,
  migrationDocHasRequiredLinks,
  objectStoragePackManifestNote,
  objectStorageRequiredEnvKeys,
  overlaySecurityProperties,
  overlayUsesRequiredVars,
  packImageForbiddenReason,
  policyFileName,
  preflightObjectStorageEnv,
  requireSuccess,
  resolveBucketQuotas,
  runFirstSupported,
  setQuotaAttempts,
  shouldCopyObjectStoragePackFile,
  updatePolicyAttempts,
} from "./object-storage.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const overlayPath = join(repoRoot, OBJECT_STORAGE_COMPOSE_OVERLAY);
const overlayText = readFileSync(overlayPath, "utf8");
const coreText = readFileSync(join(repoRoot, "deploy", "compose", "control-plane.yaml"), "utf8");
const readme = readFileSync(join(repoRoot, OBJECT_STORAGE_DOC_PATHS.readme), "utf8");
const caddy = readFileSync(join(repoRoot, OBJECT_STORAGE_DOC_PATHS.caddy), "utf8");
const bootstrap = readFileSync(join(repoRoot, OBJECT_STORAGE_DOC_PATHS.bootstrap), "utf8");
const admission = JSON.parse(readFileSync(join(repoRoot, OBJECT_STORAGE_DOC_PATHS.admission), "utf8"));
const exampleEnv = readFileSync(join(repoRoot, "deploy", "env", "control-plane.env.example"), "utf8");
const packReleaseSrc = readFileSync(join(repoRoot, "scripts", "pack-release.mjs"), "utf8");
const policiesDir = join(repoRoot, "deploy", "object-storage", "policies");

test("control-plane pack list excludes AIStor and MinIO CE", () => {
  const result = assertPackExcludesObjectStorage(CONTROL_PLANE_PACK_IMAGES);
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(packImageForbiddenReason("quay.io/minio/aistor/minio:RELEASE.2026-08-07T18-34-35Z"), "AIStor binaries must not be redistributed in private/offline packs");
  assert.equal(packImageForbiddenReason("minio/minio:latest") != null, true);
  assert.equal(isMinioCommunityImage("minio/minio:RELEASE.2024-01-01T00-00-00Z"), true);
  assert.equal(isMinioCommunityImage(AISTOR_MINIO_IMAGE_TEST_DIGEST), false);
  assert.equal(isPinnedAistorImage(AISTOR_MINIO_IMAGE_TEST_DIGEST), true);
  assert.equal(isUnconfirmedImageRef(AISTOR_MINIO_IMAGE_PLACEHOLDER), true);
  assert.equal(isPinnedAistorImage(AISTOR_MINIO_IMAGE_PLACEHOLDER), false);
  assert.equal(isFloatingImageTag("quay.io/minio/aistor/minio:latest"), true);
  assert.equal(isFloatingImageTag("quay.io/minio/aistor/minio@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("pack-release does not docker save AIStor and records exclusion", () => {
  assert.match(packReleaseSrc, /objectStoragePackManifestNote/);
  assert.doesNotMatch(packReleaseSrc, /docker save[^\n]*aistor/);
  const note = objectStoragePackManifestNote();
  assert.equal(note.included, false);
  assert.equal(note.redistributed, false);
  assert.ok(note.imagesNotPacked.includes("quay.io/minio/aistor/minio"));
  assert.equal(shouldCopyObjectStoragePackFile("deploy/object-storage/minio.license"), false);
  assert.equal(shouldCopyObjectStoragePackFile("deploy/object-storage/README.md"), true);
});

test("core control-plane compose does not require AISTOR secrets", () => {
  const keys = collectRequiredComposeVars(coreText);
  assert.equal(keys.some((key) => key.startsWith("AISTOR_")), false);
  assert.equal(coreText.includes("quay.io/minio/aistor"), false);
});

test("object-storage overlay requires pinned image, license, root, and product secrets", () => {
  const required = overlayUsesRequiredVars(overlayText);
  assert.deepEqual(required.missing, [], required.missing.join(", "));
  const keys = collectRequiredComposeVars(overlayText);
  for (const key of objectStorageRequiredEnvKeys()) {
    assert.ok(keys.includes(key), `overlay must require ${key}`);
  }
});

test("object-storage overlay security properties", () => {
  const props = overlaySecurityProperties(overlayText);
  const failed = Object.entries(props).filter(([, value]) => value !== true);
  assert.deepEqual(failed, [], failed.map(([key]) => key).join(", "));
  assert.match(overlayText, /profiles:\s*\[\s*"object-storage"\s*\]/);
  assert.match(overlayText, /127\.0\.0\.1:\$\{AISTOR_API_PORT/);
  assert.match(overlayText, /127\.0\.0\.1:\$\{AISTOR_CONSOLE_PORT/);
  assert.doesNotMatch(overlayText, /docker\.sock/);
  assert.doesNotMatch(overlayText, /0\.0\.0\.0:\$\{AISTOR_/);
  assert.match(overlayText, /mem_limit:\s*1536m/);
  assert.match(overlayText, /pids_limit:\s*512/);
  assert.match(overlayText, /cpus:\s*"2\.0"/);
  assert.match(overlayText, /object-storage-data:/);
});

test("bootstrap plan is idempotent, least-privilege, and Free-tier safe", () => {
  const plan = buildBootstrapPlan();
  assert.deepEqual(plan.buckets, OBJECT_STORAGE_BUCKETS);
  assert.equal(OBJECT_STORAGE_BUCKETS.includes("syncrobrain-reports"), false);
  assert.equal(OBJECT_STORAGE_IDENTITIES.length, 6);
  assert.equal(plan.identities.filter((item) => item.kind === "product").length, 4);
  const joined = plan.commands.map((cmd) => cmd.argv.join(" ")).join("\n");
  assert.match(joined, /mc mb --ignore-existing/);
  assert.match(joined, /mc admin user add/);
  assert.match(joined, /mc admin policy attach/);
  assert.match(joined, /mc quota set/);
  assert.equal(plan.quotaBudget.ok, true);
  assert.ok(plan.quotaBudget.sum <= OBJECT_STORAGE_BUDGET_GIB);
  assert.match(joined, /--expire-days 7/);
  assert.match(joined, /--prefix trial\//);
  assert.doesNotMatch(joined, /--transition/);
  assert.doesNotMatch(joined, /\breplicate\b/);
  assert.match(bootstrap, /mc mb --ignore-existing/);
  assert.match(bootstrap, /--expire-days 7/);
  assert.match(bootstrap, /--prefix "trial\/"/);
  assert.doesNotMatch(bootstrap, /ilm rule add[^\n]*--transition/);
  assert.doesNotMatch(bootstrap, /\bmc replicate\b/);
  const bootstrapCode = bootstrap.replace(/^[ \t]*#.*$/gm, "");
  assert.doesNotMatch(bootstrapCode, /\|\|\s*true/);
  assert.match(bootstrap, /FATAL: could not attach policy/);
  assert.match(bootstrap, /FATAL: hard quota is required/);
  assert.match(bootstrap, /mc quota set/);
  for (const bucket of OBJECT_STORAGE_BUCKETS) {
    assert.match(bootstrap, new RegExp(bucket));
  }
});

test("attach, policy-update, and quota failures are not swallowed", () => {
  const fail = () => ({ ok: false, error: "unsupported" });
  assert.throws(
    () => requireSuccess(runFirstSupported(attachPolicyAttempts("local", "p", "u"), fail), "attach_policy"),
    /attach_policy failed: no supported command succeeded/,
  );
  assert.throws(
    () => requireSuccess(runFirstSupported(updatePolicyAttempts("local", "p", "f.json"), fail), "policy-update"),
    /policy-update failed/,
  );
  assert.throws(
    () => requireSuccess(runFirstSupported(setQuotaAttempts("local", "bucket", 10), fail), "quota"),
    /quota failed/,
  );

  let n = 0;
  const secondOk = () => {
    n += 1;
    return n === 2 ? { ok: true } : { ok: false, error: "syntax" };
  };
  assert.equal(
    requireSuccess(runFirstSupported(attachPolicyAttempts("local", "p", "u"), secondOk), "attach_policy").ok,
    true,
  );

  const already = runFirstSupported(setQuotaAttempts("local", "b", 8), () => ({ alreadyApplied: true }));
  assert.equal(already.ok, true);
  assert.equal(already.alreadyApplied, true);
});

test("default bucket quotas sum to at most 120 GiB and preflight rejects overflow", () => {
  const defaults = resolveBucketQuotas({});
  assert.deepEqual(defaults, DEFAULT_BUCKET_QUOTA_GIB);
  const budget = assertQuotaSumWithinBudget(defaults);
  assert.equal(budget.ok, true);
  assert.ok(budget.sum <= OBJECT_STORAGE_BUDGET_GIB);
  assert.equal(budget.sum, 120);
  assert.ok(defaults["vistaremote-recordings"] >= 36);
  assert.ok(defaults["vistacast-recordings"] >= 36);
  assert.ok(defaults["vistaremote-recordings"] + defaults["vistacast-recordings"] > 60);

  const over = resolveBucketQuotas({
    AISTOR_QUOTA_VISTAREMOTE_RECORDINGS_GIB: "80",
    AISTOR_QUOTA_VISTACAST_RECORDINGS_GIB: "80",
  });
  assert.equal(assertQuotaSumWithinBudget(over).ok, false);

  const pf = preflightObjectStorageEnv(
    {
      AISTOR_MINIO_IMAGE: AISTOR_MINIO_IMAGE_TEST_DIGEST,
      AISTOR_MC_IMAGE: AISTOR_MC_IMAGE_TEST_DIGEST,
      AISTOR_LICENSE_FILE: "/tmp/missing.license",
      AISTOR_ROOT_USER: "aistorroot",
      AISTOR_ROOT_PASSWORD: "supersecret",
      AISTOR_LUMINARY_ACCESS_KEY: "lumkey",
      AISTOR_LUMINARY_SECRET_KEY: "lumsecret1",
      AISTOR_DATALUMINARY_ACCESS_KEY: "dlkey",
      AISTOR_DATALUMINARY_SECRET_KEY: "dlsecret1",
      AISTOR_BLOCKYEDU_ACCESS_KEY: "bekey",
      AISTOR_BLOCKYEDU_SECRET_KEY: "besecret1",
      AISTOR_VISTAREMOTE_ACCESS_KEY: "vrkey",
      AISTOR_VISTAREMOTE_SECRET_KEY: "vrsecret1",
      AISTOR_VISTACAST_ACCESS_KEY: "vckey",
      AISTOR_VISTACAST_SECRET_KEY: "vcsecret1",
      AISTOR_BACKUP_ACCESS_KEY: "bakkey",
      AISTOR_BACKUP_SECRET_KEY: "baksecret1",
      AISTOR_QUOTA_VISTAREMOTE_RECORDINGS_GIB: "80",
      AISTOR_QUOTA_VISTACAST_RECORDINGS_GIB: "80",
    },
    { skipLicenseStat: true },
  );
  assert.ok(pf.issues.some((item) => item.code === "object_storage_quota_over_budget"));
});

test("policy files match least-privilege bucket documents", () => {
  for (const identity of OBJECT_STORAGE_IDENTITIES) {
    const path = join(policiesDir, policyFileName(identity));
    const file = loadPolicyFile(path);
    assert.deepEqual(file, bucketPolicyDocument(identity.bucket));
    const actions = JSON.stringify(file);
    assert.doesNotMatch(actions, /s3:\*/);
  }
});

test("120GiB watermarks gate Trial recording, Trial writes, then all writes", () => {
  const budget = OBJECT_STORAGE_BUDGET_BYTES;
  const ok = evaluateWatermarks(0, budget);
  assert.equal(ok.watermark, "ok");
  assert.equal(ok.admit.trialRecording, true);
  assert.equal(ok.admit.objectDelete, true);
  assert.equal(ok.cdnDoesNotReduceDisk, true);

  const at70 = evaluateWatermarks(Math.ceil(budget * 0.7), budget);
  assert.equal(at70.watermark, "70");
  assert.equal(at70.admit.trialRecording, false);
  assert.equal(at70.admit.trialObjectWrite, true);
  assert.equal(at70.admit.objectWrite, true);

  const at80 = evaluateWatermarks(Math.ceil(budget * 0.8), budget);
  assert.equal(at80.watermark, "80");
  assert.equal(at80.admit.trialObjectWrite, false);
  assert.equal(at80.admit.objectWrite, true);

  const at90 = evaluateWatermarks(Math.ceil(budget * 0.9), budget);
  assert.equal(at90.watermark, "90");
  assert.equal(at90.admit.objectWrite, false);
  assert.equal(at90.admit.objectDelete, true);

  const status = buildAdmissionStatus(0);
  assert.equal(status.budgetBytes, 128849018880);
  assert.equal(status.hardEnforcement, "aistor-bucket-quota");
  assert.match(status.hostDfNote, /backing filesystem/);
  assert.equal(admission.budgetBytes, OBJECT_STORAGE_BUDGET_BYTES);
  assert.equal(admission.hardEnforcement, "aistor-bucket-quota");
  assert.equal(admission.entitlementHttpEndpoint, false);
  assert.equal(admission.cdnDoesNotReduceDisk, true);
});

test("preflight fails clearly without license, images, root, or product secrets", () => {
  const empty = preflightObjectStorageEnv({}, { skipLicenseStat: true });
  assert.equal(empty.ok, false);
  const codes = new Set(empty.issues.map((item) => item.code));
  assert.ok(codes.has("object_storage_env_missing"));

  const latest = preflightObjectStorageEnv(
    {
      AISTOR_MINIO_IMAGE: "quay.io/minio/aistor/minio:latest",
      AISTOR_MC_IMAGE: AISTOR_MC_IMAGE_TEST_DIGEST,
      AISTOR_LICENSE_FILE: "/tmp/missing.license",
      AISTOR_ROOT_USER: "aistorroot",
      AISTOR_ROOT_PASSWORD: "supersecret",
      AISTOR_LUMINARY_ACCESS_KEY: "lumkey",
      AISTOR_LUMINARY_SECRET_KEY: "lumsecret1",
      AISTOR_DATALUMINARY_ACCESS_KEY: "dlkey",
      AISTOR_DATALUMINARY_SECRET_KEY: "dlsecret1",
      AISTOR_BLOCKYEDU_ACCESS_KEY: "bekey",
      AISTOR_BLOCKYEDU_SECRET_KEY: "besecret1",
      AISTOR_VISTAREMOTE_ACCESS_KEY: "vrkey",
      AISTOR_VISTAREMOTE_SECRET_KEY: "vrsecret1",
      AISTOR_VISTACAST_ACCESS_KEY: "vckey",
      AISTOR_VISTACAST_SECRET_KEY: "vcsecret1",
      AISTOR_BACKUP_ACCESS_KEY: "bakkey",
      AISTOR_BACKUP_SECRET_KEY: "baksecret1",
    },
    { skipLicenseStat: true },
  );
  assert.ok(latest.issues.some((item) => item.code === "aistor_image_unpinned"));

  const placeholder = preflightObjectStorageEnv(
    {
      AISTOR_MINIO_IMAGE: AISTOR_MINIO_IMAGE_PLACEHOLDER,
      AISTOR_MC_IMAGE: AISTOR_MC_IMAGE_TEST_DIGEST,
      AISTOR_LICENSE_FILE: "/tmp/missing.license",
      AISTOR_ROOT_USER: "aistorroot",
      AISTOR_ROOT_PASSWORD: "supersecret",
      AISTOR_LUMINARY_ACCESS_KEY: "lumkey",
      AISTOR_LUMINARY_SECRET_KEY: "lumsecret1",
      AISTOR_DATALUMINARY_ACCESS_KEY: "dlkey",
      AISTOR_DATALUMINARY_SECRET_KEY: "dlsecret1",
      AISTOR_BLOCKYEDU_ACCESS_KEY: "bekey",
      AISTOR_BLOCKYEDU_SECRET_KEY: "besecret1",
      AISTOR_VISTAREMOTE_ACCESS_KEY: "vrkey",
      AISTOR_VISTAREMOTE_SECRET_KEY: "vrsecret1",
      AISTOR_VISTACAST_ACCESS_KEY: "vckey",
      AISTOR_VISTACAST_SECRET_KEY: "vcsecret1",
      AISTOR_BACKUP_ACCESS_KEY: "bakkey",
      AISTOR_BACKUP_SECRET_KEY: "baksecret1",
    },
    { skipLicenseStat: true },
  );
  assert.ok(placeholder.issues.some((item) => item.code === "aistor_image_unconfirmed"));

  const ce = preflightObjectStorageEnv(
    { AISTOR_MINIO_IMAGE: "minio/minio:RELEASE.2024-01-01T00-00-00Z" },
    { skipLicenseStat: true },
  );
  assert.ok(ce.issues.some((item) => item.code === "forbidden_minio_ce"));
});

test("checkObjectStorageCompose rejects public ports, CE, and docker.sock", () => {
  const { issues } = checkObjectStorageCompose({
    services: {
      "object-storage": {
        image: "minio/minio:latest",
        environment: { MINIO_ROOT_USER: "", MINIO_ROOT_PASSWORD: "" },
        ports: [{ host_ip: "0.0.0.0", published: "9000", target: 9000 }],
        volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
        networks: { "control-edge": {} },
      },
    },
  });
  const codes = issues.map((item) => item.code);
  assert.ok(codes.includes("forbidden_minio_ce"));
  assert.ok(codes.includes("object_storage_public_port"));
  assert.ok(codes.includes("docker_socket_mounted"));
  assert.ok(codes.includes("aistor_license_unmounted"));
  assert.ok(codes.includes("object_storage_init_missing"));
});

test("CDN / origin docs and Caddy example cover private origin and migration", () => {
  const docs = migrationDocHasRequiredLinks(readme);
  assert.equal(docs.ok, true, docs.missing.join(", "));
  assert.match(readme, /Caddyfile\.example/);
  assert.match(readme, /admission-contract\.json/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:9000/);
  assert.match(caddy, /does not reduce origin disk/i);
  assert.doesNotMatch(caddy, /file_server browse/);
  assert.match(caddy, /thumbs\.example\.com/);
  assert.match(readme, /freeze/i);
  assert.match(readme, /checksum/i);
  assert.match(readme, /rollback/i);
});

test("HANDBOOK and OPERATOR document pack exclusion in UTF-8", () => {
  const handbook = readFileSync(join(repoRoot, "deploy", "HANDBOOK.md"), "utf8");
  const operator = readFileSync(join(repoRoot, "deploy", "OPERATOR.md"), "utf8");
  for (const text of [handbook, operator, readme]) {
    assert.equal(text.includes("\uFFFD"), false);
    assert.equal(text.charCodeAt(0) !== 0xfeff, true);
  }
  assert.match(handbook, /不得.*再分发|禁止.*再分发/);
  assert.match(handbook, /120/);
  assert.match(operator, /不要打进离线包/);
  assert.match(operator, /不要.*编造许可证/);
});

test("env example uses an unconfirmed image placeholder and empty secrets", () => {
  assert.match(exampleEnv, new RegExp(`AISTOR_MINIO_IMAGE=.*${AISTOR_IMAGE_PLACEHOLDER_TAG}`));
  assert.doesNotMatch(exampleEnv, /AISTOR_MINIO_IMAGE=.*:latest/);
  assert.doesNotMatch(exampleEnv, /AISTOR_MINIO_IMAGE=.*RELEASE\.\d{4}/);
  assert.match(exampleEnv, /AISTOR_LICENSE_FILE=/);
  assert.match(exampleEnv, /AISTOR_ROOT_PASSWORD=/);
  assert.match(exampleEnv, /AISTOR_DATALUMINARY_ACCESS_KEY=/);
  assert.match(exampleEnv, /OBJECT_STORAGE_ENABLED=0/);
  assert.match(exampleEnv, /AISTOR_QUOTA_VISTAREMOTE_RECORDINGS_GIB=40/);
});

test("docker compose config for object-storage overlay (no up, no pull)", () => {
  const docker = spawnSync("docker", ["compose", "version"], { encoding: "utf8", shell: false });
  if (docker.status !== 0) {
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "lw-aistor-"));
  const license = join(dir, "minio.license");
  const envFile = join(dir, "control-plane.env");
  try {
    writeFileSync(license, "placeholder-not-a-real-aistor-license\n");
    writeFileSync(
      envFile,
      [
        "IDENTITY_DB_PASSWORD=compose-config-test-secret-1",
        "ENTITLEMENT_DB_PASSWORD=compose-config-test-secret-2",
        "ENTITLEMENT_SERVICE_API_KEY=compose-config-test-secret-3",
        "ENTITLEMENT_PARTNER_SECRET_PEPPER=compose-config-test-secret-4",
        "ENTITLEMENT_PARTNER_TOKEN_SECRET=compose-config-test-secret-5",
        "AI_VAULT_MASTER_KEY=compose-config-test-secret-6",
        "IDENTITY_ENDPOINT=http://127.0.0.1:3001",
        "IDENTITY_ADMIN_ENDPOINT=http://127.0.0.1:3002",
        "AUTH_GATEWAY_PUBLIC_URL=http://127.0.0.1:3010",
        "ENTITLEMENT_OIDC_ISSUER=http://identity:3001/oidc",
        `AISTOR_MINIO_IMAGE=${AISTOR_MINIO_IMAGE_TEST_DIGEST}`,
        `AISTOR_MC_IMAGE=${AISTOR_MC_IMAGE_TEST_DIGEST}`,
        `AISTOR_LICENSE_FILE=${license}`,
        "AISTOR_ROOT_USER=aistorroot",
        "AISTOR_ROOT_PASSWORD=compose-config-root-secret",
        "AISTOR_LUMINARY_ACCESS_KEY=luminarykey",
        "AISTOR_LUMINARY_SECRET_KEY=luminarysecret12",
        "AISTOR_DATALUMINARY_ACCESS_KEY=dlkey",
        "AISTOR_DATALUMINARY_SECRET_KEY=dlsecret12",
        "AISTOR_BLOCKYEDU_ACCESS_KEY=bekey",
        "AISTOR_BLOCKYEDU_SECRET_KEY=besecret12",
        "AISTOR_VISTAREMOTE_ACCESS_KEY=vrkey",
        "AISTOR_VISTAREMOTE_SECRET_KEY=vrsecret12",
        "AISTOR_VISTACAST_ACCESS_KEY=vckey",
        "AISTOR_VISTACAST_SECRET_KEY=vcsecret12",
        "AISTOR_BACKUP_ACCESS_KEY=bakkey",
        "AISTOR_BACKUP_SECRET_KEY=baksecret12",
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--env-file",
        envFile,
        "-f",
        "deploy/compose/control-plane.yaml",
        "-f",
        OBJECT_STORAGE_COMPOSE_OVERLAY,
        "--profile",
        "object-storage",
        "config",
        "--format",
        "json",
      ],
      { cwd: repoRoot, encoding: "utf8", shell: false },
    );
    assert.equal(result.status, 0, (result.stderr || result.stdout || "").trim());
    const config = JSON.parse(result.stdout);
    assert.ok(config.services["object-storage"]);
    assert.ok(config.services["object-storage-init"]);
    assert.equal(config.services["object-storage"].image, AISTOR_MINIO_IMAGE_TEST_DIGEST);
    const extra = checkObjectStorageCompose(config).issues.filter((item) => item.severity === "error");
    assert.deepEqual(extra, [], extra.map((item) => item.message).join("; "));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docker compose config with object-storage overlay fails without AISTOR secrets", () => {
  const docker = spawnSync("docker", ["compose", "version"], { encoding: "utf8", shell: false });
  if (docker.status !== 0) {
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "lw-cp-aistor-miss-"));
  const envFile = join(dir, "control-plane.env");
  try {
    writeFileSync(
      envFile,
      [
        "IDENTITY_DB_PASSWORD=compose-config-test-secret-1",
        "ENTITLEMENT_DB_PASSWORD=compose-config-test-secret-2",
        "ENTITLEMENT_SERVICE_API_KEY=compose-config-test-secret-3",
        "ENTITLEMENT_PARTNER_SECRET_PEPPER=compose-config-test-secret-4",
        "ENTITLEMENT_PARTNER_TOKEN_SECRET=compose-config-test-secret-5",
        "AI_VAULT_MASTER_KEY=compose-config-test-secret-6",
        "IDENTITY_ENDPOINT=http://127.0.0.1:3001",
        "IDENTITY_ADMIN_ENDPOINT=http://127.0.0.1:3002",
        "AUTH_GATEWAY_PUBLIC_URL=http://127.0.0.1:3010",
        "ENTITLEMENT_OIDC_ISSUER=http://identity:3001/oidc",
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--env-file",
        envFile,
        "-f",
        "deploy/compose/control-plane.yaml",
        "-f",
        OBJECT_STORAGE_COMPOSE_OVERLAY,
        "--profile",
        "object-storage",
        "config",
      ],
      { cwd: repoRoot, encoding: "utf8", shell: false },
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr || ""}\n${result.stdout || ""}`, /AISTOR_/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compose config without overlay does not interpolate AISTOR required vars", () => {
  const docker = spawnSync("docker", ["compose", "version"], { encoding: "utf8", shell: false });
  if (docker.status !== 0) {
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "lw-cp-"));
  const envFile = join(dir, "control-plane.env");
  try {
    writeFileSync(
      envFile,
      [
        "IDENTITY_DB_PASSWORD=compose-config-test-secret-1",
        "ENTITLEMENT_DB_PASSWORD=compose-config-test-secret-2",
        "ENTITLEMENT_SERVICE_API_KEY=compose-config-test-secret-3",
        "ENTITLEMENT_PARTNER_SECRET_PEPPER=compose-config-test-secret-4",
        "ENTITLEMENT_PARTNER_TOKEN_SECRET=compose-config-test-secret-5",
        "AI_VAULT_MASTER_KEY=compose-config-test-secret-6",
        "IDENTITY_ENDPOINT=http://127.0.0.1:3001",
        "IDENTITY_ADMIN_ENDPOINT=http://127.0.0.1:3002",
        "AUTH_GATEWAY_PUBLIC_URL=http://127.0.0.1:3010",
        "ENTITLEMENT_OIDC_ISSUER=http://identity:3001/oidc",
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      "docker",
      [
        "compose",
        "--env-file",
        envFile,
        "-f",
        "deploy/compose/control-plane.yaml",
        "config",
        "--format",
        "json",
      ],
      { cwd: repoRoot, encoding: "utf8", shell: false },
    );
    assert.equal(result.status, 0, (result.stderr || result.stdout || "").trim());
    const config = JSON.parse(result.stdout);
    assert.equal(config.services["object-storage"], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
