/**
 * Hosted object-storage contract (AIStor Free standalone).
 *
 * Source of truth for buckets, least-privilege identities, 120 GiB watermarks,
 * pack exclusion, and compose/preflight checks. Products consume S3-compatible
 * APIs only; they never receive root credentials.
 *
 * ADR: spec/decisions/2026-09-storage-doris-payment.md (D-STOR-1..3).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

/** D-STOR-3: 120 GiB hard budget. Enforced by AIStor bucket quotas; host df is a second guard. */
export const OBJECT_STORAGE_BUDGET_GIB = 120;
export const OBJECT_STORAGE_BUDGET_BYTES = OBJECT_STORAGE_BUDGET_GIB * 1024 * 1024 * 1024;

export const WATERMARK_RATIOS = {
  trialRecording: 0.7,
  trialObjectWrite: 0.8,
  objectWrite: 0.9,
};

/**
 * Example-file placeholders. Preflight and compose-enablement must fail until
 * the operator replaces these with a Quay tag or digest they have confirmed.
 * Do not treat any RELEASE.* in this repo as a verified published image.
 */
export const AISTOR_IMAGE_PLACEHOLDER_TAG = "REPLACE_WITH_CONFIRMED_QUAY_RELEASE_OR_DIGEST";
export const AISTOR_MINIO_IMAGE_PLACEHOLDER = `quay.io/minio/aistor/minio:${AISTOR_IMAGE_PLACEHOLDER_TAG}`;
export const AISTOR_MC_IMAGE_PLACEHOLDER = `quay.io/minio/aistor/mc:${AISTOR_IMAGE_PLACEHOLDER_TAG}`;

/** Synthetic digest for compose-config unit tests only — not a published image. */
export const AISTOR_MINIO_IMAGE_TEST_DIGEST =
  "quay.io/minio/aistor/minio@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const AISTOR_MC_IMAGE_TEST_DIGEST =
  "quay.io/minio/aistor/mc@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/**
 * Default hard quotas (GiB). Vista recordings take most of the 120 GiB.
 * Sum must stay <= OBJECT_STORAGE_BUDGET_GIB.
 */
export const DEFAULT_BUCKET_QUOTA_GIB = {
  "luminary-media": 8,
  "dataluminary-media": 10,
  "blockyedu-media": 8,
  "vistaremote-recordings": 40,
  "vistacast-recordings": 40,
  "backup-staging": 14,
};

export const QUOTA_ENV_KEYS = {
  "luminary-media": "AISTOR_QUOTA_LUMINARY_MEDIA_GIB",
  "dataluminary-media": "AISTOR_QUOTA_DATALUMINARY_MEDIA_GIB",
  "blockyedu-media": "AISTOR_QUOTA_BLOCKYEDU_MEDIA_GIB",
  "vistaremote-recordings": "AISTOR_QUOTA_VISTAREMOTE_RECORDINGS_GIB",
  "vistacast-recordings": "AISTOR_QUOTA_VISTACAST_RECORDINGS_GIB",
  "backup-staging": "AISTOR_QUOTA_BACKUP_STAGING_GIB",
};

export const AISTOR_OFFICIAL_REPOS = [
  "quay.io/minio/aistor/minio",
  "quay.io/minio/aistor/mc",
];

export const OBJECT_STORAGE_COMPOSE_OVERLAY = "deploy/compose/control-plane.object-storage.yaml";
export const OBJECT_STORAGE_PROFILE = "object-storage";

export const OBJECT_STORAGE_BUCKETS = [
  "luminary-media",
  "dataluminary-media",
  "blockyedu-media",
  "vistaremote-recordings",
  "vistacast-recordings",
  "backup-staging",
];

/** Buckets that may carry a `trial/` prefix (product purge remains authoritative). */
export const TRIAL_LIFECYCLE_BUCKETS = OBJECT_STORAGE_BUCKETS.filter(
  (bucket) => bucket !== "backup-staging",
);

/**
 * One identity per bucket. Access key env is the S3 user name.
 * Root credentials must never be copied into product env files.
 */
export const OBJECT_STORAGE_IDENTITIES = [
  {
    id: "luminary",
    bucket: "luminary-media",
    accessKeyVar: "AISTOR_LUMINARY_ACCESS_KEY",
    secretKeyVar: "AISTOR_LUMINARY_SECRET_KEY",
    policy: "luminary-media-rw",
    kind: "platform",
  },
  {
    id: "dataluminary",
    bucket: "dataluminary-media",
    accessKeyVar: "AISTOR_DATALUMINARY_ACCESS_KEY",
    secretKeyVar: "AISTOR_DATALUMINARY_SECRET_KEY",
    policy: "dataluminary-media-rw",
    kind: "product",
  },
  {
    id: "blockyedu",
    bucket: "blockyedu-media",
    accessKeyVar: "AISTOR_BLOCKYEDU_ACCESS_KEY",
    secretKeyVar: "AISTOR_BLOCKYEDU_SECRET_KEY",
    policy: "blockyedu-media-rw",
    kind: "product",
  },
  {
    id: "vistaremote",
    bucket: "vistaremote-recordings",
    accessKeyVar: "AISTOR_VISTAREMOTE_ACCESS_KEY",
    secretKeyVar: "AISTOR_VISTAREMOTE_SECRET_KEY",
    policy: "vistaremote-recordings-rw",
    kind: "product",
  },
  {
    id: "vistacast",
    bucket: "vistacast-recordings",
    accessKeyVar: "AISTOR_VISTACAST_ACCESS_KEY",
    secretKeyVar: "AISTOR_VISTACAST_SECRET_KEY",
    policy: "vistacast-recordings-rw",
    kind: "product",
  },
  {
    id: "backup",
    bucket: "backup-staging",
    accessKeyVar: "AISTOR_BACKUP_ACCESS_KEY",
    secretKeyVar: "AISTOR_BACKUP_SECRET_KEY",
    policy: "backup-staging-rw",
    kind: "operator",
  },
];

export const OBJECT_STORAGE_ROOT_SECRET_KEYS = ["AISTOR_ROOT_USER", "AISTOR_ROOT_PASSWORD"];

export const OBJECT_STORAGE_REQUIRED_IMAGE_KEYS = ["AISTOR_MINIO_IMAGE", "AISTOR_MC_IMAGE"];

export const OBJECT_STORAGE_LICENSE_KEY = "AISTOR_LICENSE_FILE";

export function objectStorageProductSecretKeys() {
  return OBJECT_STORAGE_IDENTITIES.flatMap((item) => [item.accessKeyVar, item.secretKeyVar]);
}

export function objectStorageRequiredSecretKeys() {
  return [
    ...OBJECT_STORAGE_ROOT_SECRET_KEYS,
    ...objectStorageProductSecretKeys(),
  ];
}

export function objectStorageRequiredEnvKeys() {
  return [
    ...OBJECT_STORAGE_REQUIRED_IMAGE_KEYS,
    OBJECT_STORAGE_LICENSE_KEY,
    ...objectStorageRequiredSecretKeys(),
  ];
}

export function bucketPolicyDocument(bucket) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:ListBucket", "s3:GetBucketLocation"],
        Resource: [`arn:aws:s3:::${bucket}`],
      },
      {
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  };
}

export function resolveBucketQuotas(env = {}) {
  const quotas = {};
  for (const bucket of OBJECT_STORAGE_BUCKETS) {
    const key = QUOTA_ENV_KEYS[bucket];
    const raw = env?.[key];
    const value =
      raw === undefined || raw === null || String(raw).trim() === ""
        ? DEFAULT_BUCKET_QUOTA_GIB[bucket]
        : Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${key} must be a positive integer GiB (got ${raw})`);
    }
    quotas[bucket] = value;
  }
  return quotas;
}

export function quotaSumGiB(quotas) {
  return Object.values(quotas).reduce((sum, value) => sum + Number(value), 0);
}

export function assertQuotaSumWithinBudget(quotas, budgetGib = OBJECT_STORAGE_BUDGET_GIB) {
  const sum = quotaSumGiB(quotas);
  if (sum > budgetGib) {
    return {
      ok: false,
      sum,
      budgetGib,
      message: `Configured bucket quotas sum to ${sum} GiB, which exceeds the ${budgetGib} GiB hard budget.`,
    };
  }
  return { ok: true, sum, budgetGib };
}

export function attachPolicyAttempts(alias, policy, user) {
  return [
    { argv: ["mc", "admin", "policy", "attach", alias, policy, "--user", user] },
    { argv: ["mc", "admin", "policy", "attach", alias, "--user", user, policy] },
  ];
}

export function updatePolicyAttempts(alias, policy, file) {
  return [
    { argv: ["mc", "admin", "policy", "put", alias, policy, file] },
    { argv: ["mc", "admin", "policy", "create", alias, policy, file] },
    { argv: ["mc", "admin", "policy", "update", alias, policy, file] },
  ];
}

export function createPolicyAttempts(alias, policy, file) {
  return [{ argv: ["mc", "admin", "policy", "create", alias, policy, file] }];
}

export function setQuotaAttempts(alias, bucket, gib) {
  const size = `${gib}Gi`;
  return [
    { argv: ["mc", "quota", "set", `${alias}/${bucket}`, "--hard", size] },
    { argv: ["mc", "quota", "set", `${alias}/${bucket}`, size] },
    { argv: ["mc", "admin", "bucket", "quota", `${alias}/${bucket}`, "--hard", size] },
  ];
}

/**
 * Try supported command variants in order. Never succeeds if every variant fails.
 * `alreadyApplied` lets a runner treat an idempotent "already set" as success
 * without swallowing unknown errors.
 */
export function runFirstSupported(attempts, runner) {
  const errors = [];
  for (const attempt of attempts) {
    const result = runner(attempt);
    if (result?.ok || result?.alreadyApplied) {
      return { ok: true, used: attempt, alreadyApplied: Boolean(result.alreadyApplied) };
    }
    errors.push({ attempt, error: result?.error || "failed" });
  }
  return { ok: false, errors };
}

export function requireSuccess(result, label) {
  if (!result?.ok) {
    const detail = (result?.errors || []).map((item) => item.error).join("; ");
    throw new Error(`${label} failed: no supported command succeeded${detail ? ` (${detail})` : ""}`);
  }
  return result;
}

/**
 * Dry-run bootstrap plan. Live `mc` flags match AIStor Client docs:
 * `mb --ignore-existing`, `admin user add`, `admin policy create|put`,
 * `admin policy attach --user`, `quota set --hard`, `ilm rule add --expire-days`.
 * Attach/quota/policy-update must fail closed (no `|| true`).
 */
export function buildBootstrapPlan(env = {}) {
  const alias = "local";
  const endpoint = "http://object-storage:9000";
  const quotas = resolveBucketQuotas(env);
  const quotaBudget = assertQuotaSumWithinBudget(quotas);
  const commands = [
    {
      id: "alias",
      argv: ["mc", "alias", "set", alias, endpoint, "${AISTOR_ROOT_USER}", "${AISTOR_ROOT_PASSWORD}"],
    },
  ];

  for (const bucket of OBJECT_STORAGE_BUCKETS) {
    commands.push({
      id: `mb:${bucket}`,
      argv: ["mc", "mb", "--ignore-existing", `${alias}/${bucket}`],
    });
    commands.push({
      id: `quota:${bucket}`,
      argv: setQuotaAttempts(alias, bucket, quotas[bucket])[0].argv,
      required: true,
      variants: setQuotaAttempts(alias, bucket, quotas[bucket]),
    });
  }

  for (const identity of OBJECT_STORAGE_IDENTITIES) {
    commands.push({
      id: `policy:${identity.policy}`,
      argv: [
        "mc",
        "admin",
        "policy",
        "create",
        alias,
        identity.policy,
        `/bootstrap/policies/${identity.policy}.json`,
      ],
      optionalRetry: "create-or-replace",
    });
    commands.push({
      id: `user:${identity.id}`,
      argv: [
        "mc",
        "admin",
        "user",
        "add",
        alias,
        `\${${identity.accessKeyVar}}`,
        `\${${identity.secretKeyVar}}`,
      ],
      optionalRetry: "exists-ok",
    });
    commands.push({
      id: `attach:${identity.id}`,
      argv: attachPolicyAttempts(alias, identity.policy, `\${${identity.accessKeyVar}}`)[0].argv,
      required: true,
      variants: attachPolicyAttempts(alias, identity.policy, `\${${identity.accessKeyVar}}`),
    });
  }

  for (const bucket of TRIAL_LIFECYCLE_BUCKETS) {
    commands.push({
      id: `ilm:${bucket}`,
      argv: [
        "mc",
        "ilm",
        "rule",
        "add",
        `${alias}/${bucket}`,
        "--expire-days",
        "7",
        "--prefix",
        "trial/",
      ],
      optional: true,
      note: "AIStor Free may omit lifecycle; product trial.purge remains authoritative. Never --transition or replicate.",
    });
  }

  return {
    alias,
    endpoint,
    buckets: [...OBJECT_STORAGE_BUCKETS],
    identities: OBJECT_STORAGE_IDENTITIES.map((item) => ({
      id: item.id,
      bucket: item.bucket,
      policy: item.policy,
      kind: item.kind,
    })),
    quotas,
    quotaBudget,
    commands,
    forbiddenFlags: ["--transition", "--transition-days", "replicate"],
    failClosed: ["attach", "quota", "policy-update"],
  };
}

export function evaluateWatermarks(usedBytes, budgetBytes = OBJECT_STORAGE_BUDGET_BYTES) {
  const used = Number(usedBytes);
  const budget = Number(budgetBytes);
  if (!Number.isFinite(used) || used < 0) {
    throw new Error("usedBytes must be a non-negative number");
  }
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("budgetBytes must be a positive number");
  }
  const usedRatio = used / budget;
  const trialRecording = usedRatio < WATERMARK_RATIOS.trialRecording;
  const trialObjectWrite = usedRatio < WATERMARK_RATIOS.trialObjectWrite;
  const objectWrite = usedRatio < WATERMARK_RATIOS.objectWrite;
  let watermark = "ok";
  if (usedRatio >= WATERMARK_RATIOS.objectWrite) watermark = "90";
  else if (usedRatio >= WATERMARK_RATIOS.trialObjectWrite) watermark = "80";
  else if (usedRatio >= WATERMARK_RATIOS.trialRecording) watermark = "70";

  return {
    budgetBytes: budget,
    usedBytes: used,
    usedRatio,
    watermark,
    admit: {
      trialRecording,
      trialObjectWrite,
      objectWrite,
      objectDelete: true,
    },
    actions: {
      "70": "stop_new_trial_recording",
      "80": "stop_all_trial_object_writes",
      "90": "stop_all_non_delete_object_writes",
    },
    cdnDoesNotReduceDisk: true,
  };
}

export function buildAdmissionStatus(usedBytes, options = {}) {
  const evaluated = evaluateWatermarks(usedBytes, options.budgetBytes);
  return {
    ok: true,
    ...evaluated,
    source: options.source || "manual",
    contract: "deploy/object-storage/admission-contract.json",
    enforcement: "aistor-bucket-quota is the hard cap; host watermarks are a second guard",
    hardEnforcement: "aistor-bucket-quota",
    hostDfNote:
      "df on a Docker named volume often reports the backing filesystem (e.g. all of /var/lib/docker), not isolated object-bytes. Prefer --used-bytes from mc du / quota info.",
  };
}

const FLOATING_TAGS = new Set(["latest", "main", "master", "edge", "stable"]);

export function splitImageRef(image) {
  const raw = String(image || "").trim();
  const at = raw.indexOf("@");
  if (at > 0) {
    return { name: raw.slice(0, at), tag: "", digest: raw.slice(at + 1) };
  }
  const slash = raw.lastIndexOf("/");
  const colon = raw.lastIndexOf(":");
  if (colon > slash) {
    return { name: raw.slice(0, colon), tag: raw.slice(colon + 1), digest: "" };
  }
  return { name: raw, tag: "", digest: "" };
}

export function isMinioCommunityImage(image) {
  const { name } = splitImageRef(image);
  if (!name) return false;
  if (/aistor\/minio(?:$|\/)/.test(name) || /aistor\/mc(?:$|\/)/.test(name)) return false;
  return /(?:^|\/)minio\/minio$/.test(name);
}

export function isAistorOfficialImage(image) {
  const { name } = splitImageRef(image);
  return AISTOR_OFFICIAL_REPOS.some((repo) => name === repo);
}

export function isFloatingImageTag(image) {
  const { tag, digest } = splitImageRef(image);
  if (digest) return false;
  if (!tag) return true;
  return FLOATING_TAGS.has(tag.toLowerCase());
}

export function isUnconfirmedImageRef(image) {
  return /REPLACE_WITH|CHANGE[_-]?ME|TODO_PIN|UNVERIFIED|PLACEHOLDER|EXAMPLE_RELEASE/i.test(
    String(image || ""),
  );
}

export function isPinnedAistorImage(image) {
  if (isUnconfirmedImageRef(image)) return false;
  if (!isAistorOfficialImage(image)) return false;
  if (isFloatingImageTag(image)) return false;
  const { tag, digest } = splitImageRef(image);
  if (digest && /^sha256:[a-f0-9]{64}$/i.test(digest)) return true;
  return /^RELEASE\.\d{4}-\d{2}-\d{2}T/.test(tag);
}

export function packImageForbiddenReason(image) {
  const raw = String(image || "").trim();
  if (!raw) return null;
  if (isMinioCommunityImage(raw)) {
    return "old minio/minio Community Edition is unmaintained and forbidden";
  }
  const { name } = splitImageRef(raw);
  if (name.includes("aistor") || name.includes("minio/aistor")) {
    return "AIStor binaries must not be redistributed in private/offline packs";
  }
  return null;
}

export function assertPackExcludesObjectStorage(images) {
  const list = Array.isArray(images) ? images : [];
  const violations = [];
  for (const image of list) {
    const reason = packImageForbiddenReason(image);
    if (reason) violations.push({ image, reason });
  }
  return { ok: violations.length === 0, violations };
}

function issue(severity, code, target, message) {
  return { severity, code, target, message };
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function envMap(service) {
  const raw = service?.environment;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = value === null || value === undefined ? "" : String(value);
  }
  return out;
}

function normalizePorts(ports) {
  if (!Array.isArray(ports)) return [];
  return ports.map((port) => {
    if (typeof port === "string") {
      const [spec, protocol = "tcp"] = port.split("/");
      const parts = spec.split(":");
      const target = parts.pop();
      const published = parts.pop();
      const hostIp = parts.length ? parts.join(":") : "";
      return { hostIp, published: published ?? "", target: target ?? "", protocol };
    }
    return {
      hostIp: port.host_ip ?? "",
      published: port.published === undefined ? "" : String(port.published),
      target: port.target === undefined ? "" : String(port.target),
      protocol: port.protocol ?? "tcp",
    };
  });
}

function networkNames(service) {
  const nets = service?.networks;
  if (Array.isArray(nets)) return nets.map((item) => (typeof item === "string" ? item : String(item?.name || item)));
  if (nets && typeof nets === "object") return Object.keys(nets);
  return [];
}

function volumeStrings(service) {
  const volumes = service?.volumes;
  if (!Array.isArray(volumes)) return [];
  return volumes.map((item) => {
    if (typeof item === "string") return item;
    const source = item?.source ?? item?.Source ?? "";
    const target = item?.target ?? item?.Target ?? "";
    return `${source}:${target}`;
  });
}

/**
 * Checks a resolved `docker compose config --format json` object for the
 * object-storage profile. Call only when that profile is enabled.
 */
export function checkObjectStorageCompose(config) {
  const issues = [];
  const services = config?.services ?? {};
  const storage = services["object-storage"];
  const init = services["object-storage-init"];

  if (!storage) {
    issues.push(
      issue(
        "error",
        "object_storage_service_missing",
        "object-storage",
        "Profile object-storage is enabled but service object-storage is missing.",
      ),
    );
    return { issues };
  }

  if (storage.container_name) {
    issues.push(
      issue("error", "fixed_container_name", "object-storage", "Do not set container_name."),
    );
  }

  const image = String(storage.image ?? "");
  if (isMinioCommunityImage(image)) {
    issues.push(
      issue(
        "error",
        "forbidden_minio_ce",
        "object-storage",
        `Image "${image}" is unmaintained MinIO CE; use quay.io/minio/aistor/minio with a digest or RELEASE pin.`,
      ),
    );
  } else if (!isAistorOfficialImage(image)) {
    issues.push(
      issue(
        "error",
        "aistor_image_unofficial",
        "object-storage",
        `Image "${image}" is not quay.io/minio/aistor/minio.`,
      ),
    );
  } else if (isFloatingImageTag(image)) {
    issues.push(
      issue(
        "error",
        "aistor_image_unpinned",
        "object-storage",
        `Image "${image}" uses a floating tag; pin RELEASE.* or @sha256:… — never latest.`,
      ),
    );
  }

  const env = envMap(storage);
  for (const key of ["MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD"]) {
    if (!env[key]) {
      issues.push(
        issue("error", "object_storage_secret_missing", `object-storage.${key}`, `${key} must come from env.`),
      );
    }
  }

  const volumes = volumeStrings(storage);
  const hasLicense = volumes.some((item) => item.includes("minio.license") || item.endsWith(":/minio.license:ro") || item.includes("/minio.license"));
  if (!hasLicense) {
    issues.push(
      issue(
        "error",
        "aistor_license_unmounted",
        "object-storage",
        "AIStor license file must be bind-mounted read-only at /minio.license.",
      ),
    );
  }

  const allText = collectStrings(storage);
  if (allText.some((text) => text.includes("docker.sock"))) {
    issues.push(
      issue(
        "error",
        "docker_socket_mounted",
        "object-storage",
        "Do not mount the Docker socket into object-storage containers.",
      ),
    );
  }

  const networks = networkNames(storage);
  if (!networks.some((name) => name.includes("edge"))) {
    issues.push(
      issue(
        "error",
        "object_storage_missing_edge",
        "object-storage",
        "object-storage must join the control-plane edge network so products can use Compose DNS.",
      ),
    );
  }

  const ports = normalizePorts(storage.ports);
  const apiPorts = ports.filter((port) => port.target === "9000");
  const consolePorts = ports.filter((port) => port.target === "9001");
  if (apiPorts.length === 0) {
    issues.push(
      issue(
        "warning",
        "object_storage_api_unpublished",
        "object-storage",
        "API has no host port; loopback publish is required for host-side mc/status.",
      ),
    );
  }
  for (const port of [...apiPorts, ...consolePorts]) {
    if (!port.published) continue;
    if (port.hostIp === "" || port.hostIp === "0.0.0.0" || port.hostIp === "::") {
      issues.push(
        issue(
          "error",
          "object_storage_public_port",
          `object-storage:${port.published}`,
          `Port ${port.published} must bind loopback (127.0.0.1), not all interfaces.`,
        ),
      );
    }
  }

  const restart = storage.restart || storage.deploy?.restart_policy?.condition;
  if (restart && restart !== "unless-stopped" && restart !== "always") {
    issues.push(
      issue(
        "warning",
        "object_storage_restart",
        "object-storage",
        `Unexpected restart policy "${restart}"; prefer unless-stopped.`,
      ),
    );
  }

  const memLimit = storage.mem_limit ?? storage.deploy?.resources?.limits?.memory;
  const pidsLimit = storage.pids_limit ?? storage.deploy?.resources?.limits?.pids;
  if (!memLimit) {
    issues.push(
      issue("warning", "object_storage_no_mem_limit", "object-storage", "Set a memory limit for the 24 GiB host."),
    );
  }
  if (!pidsLimit) {
    issues.push(
      issue("warning", "object_storage_no_pids_limit", "object-storage", "Set pids_limit for the 24 GiB host."),
    );
  }

  if (init) {
    const initImage = String(init.image ?? "");
    if (isMinioCommunityImage(initImage)) {
      issues.push(
        issue("error", "forbidden_minio_ce", "object-storage-init", `Init image "${initImage}" is MinIO CE.`),
      );
    } else if (isFloatingImageTag(initImage)) {
      issues.push(
        issue(
          "error",
          "aistor_image_unpinned",
          "object-storage-init",
          `Init image "${initImage}" must be digest- or RELEASE-pinned.`,
        ),
      );
    }
    if (init.ports && normalizePorts(init.ports).some((port) => port.published)) {
      issues.push(
        issue("error", "object_storage_init_published", "object-storage-init", "Init must not publish host ports."),
      );
    }
    const initText = collectStrings(init);
    if (initText.some((text) => text.includes("docker.sock"))) {
      issues.push(
        issue("error", "docker_socket_mounted", "object-storage-init", "Do not mount the Docker socket."),
      );
    }
  } else {
    issues.push(
      issue(
        "error",
        "object_storage_init_missing",
        "object-storage-init",
        "Idempotent bootstrap service object-storage-init is required.",
      ),
    );
  }

  return { issues };
}

function readEnvValue(env, key) {
  if (!env || typeof env !== "object") return "";
  const value = env[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * Fail clearly when the object-storage profile is requested without license,
 * pinned images, root credentials, or per-product secrets.
 */
export function preflightObjectStorageEnv(env, options = {}) {
  const issues = [];
  const get = (key) => readEnvValue(env, key);

  for (const key of objectStorageRequiredEnvKeys()) {
    if (!get(key)) {
      issues.push(
        issue(
          "error",
          "object_storage_env_missing",
          key,
          `${key} is required to enable --profile object-storage (not shipped in offline packs).`,
        ),
      );
    }
  }

  for (const key of OBJECT_STORAGE_REQUIRED_IMAGE_KEYS) {
    const image = get(key);
    if (!image) continue;
    if (isMinioCommunityImage(image)) {
      issues.push(
        issue("error", "forbidden_minio_ce", key, `${key}=${image} is unmaintained MinIO CE.`),
      );
    } else if (isUnconfirmedImageRef(image)) {
      issues.push(
        issue(
          "error",
          "aistor_image_unconfirmed",
          key,
          `${key} is still a placeholder. Look up a current tag or digest on Quay and replace ${AISTOR_IMAGE_PLACEHOLDER_TAG}.`,
        ),
      );
    } else if (isFloatingImageTag(image)) {
      issues.push(
        issue("error", "aistor_image_unpinned", key, `${key} must be digest- or RELEASE-pinned; never latest.`),
      );
    } else if (key === "AISTOR_MINIO_IMAGE" && !isAistorOfficialImage(image)) {
      issues.push(
        issue("error", "aistor_image_unofficial", key, `${key} must be quay.io/minio/aistor/minio.`),
      );
    } else if (!isPinnedAistorImage(image) && isAistorOfficialImage(image)) {
      issues.push(
        issue("error", "aistor_image_unpinned", key, `${key} must be a confirmed @sha256: digest or RELEASE.* tag.`),
      );
    }
  }

  const license = get(OBJECT_STORAGE_LICENSE_KEY);
  if (license) {
    if (options.skipLicenseStat) {
      // compose-config tests may point at a temp path
    } else if (!existsSync(license)) {
      issues.push(
        issue(
          "error",
          "aistor_license_missing",
          OBJECT_STORAGE_LICENSE_KEY,
          `License file not found: ${license}. Obtain an AIStor Free license from MinIO; packs do not include it.`,
        ),
      );
    } else {
      try {
        const st = statSync(license);
        if (!st.isFile() || st.size < 32) {
          issues.push(
            issue(
              "error",
              "aistor_license_invalid",
              OBJECT_STORAGE_LICENSE_KEY,
              "License path exists but does not look like a license file (empty or directory).",
            ),
          );
        }
      } catch (err) {
        issues.push(
          issue("error", "aistor_license_unreadable", OBJECT_STORAGE_LICENSE_KEY, String(err.message || err)),
        );
      }
    }
  }

  const rootUser = get("AISTOR_ROOT_USER");
  const rootPassword = get("AISTOR_ROOT_PASSWORD");
  if (rootUser && rootUser.length < 3) {
    issues.push(issue("error", "aistor_root_user_short", "AISTOR_ROOT_USER", "MINIO root user must be at least 3 characters."));
  }
  if (rootPassword && rootPassword.length < 8) {
    issues.push(
      issue("error", "aistor_root_password_short", "AISTOR_ROOT_PASSWORD", "MINIO root password must be at least 8 characters."),
    );
  }

  const productKeys = new Set(objectStorageProductSecretKeys());
  if (rootUser && [...productKeys].some((key) => get(key) === rootUser)) {
    issues.push(
      issue(
        "error",
        "object_storage_shared_root",
        "AISTOR_ROOT_USER",
        "Product access keys must not reuse the root user.",
      ),
    );
  }

  try {
    const quotas = resolveBucketQuotas(env);
    const budget = assertQuotaSumWithinBudget(quotas);
    if (!budget.ok) {
      issues.push(issue("error", "object_storage_quota_over_budget", "AISTOR_QUOTA_*", budget.message));
    }
  } catch (err) {
    issues.push(
      issue("error", "object_storage_quota_invalid", "AISTOR_QUOTA_*", String(err.message || err)),
    );
  }

  return { ok: issues.length === 0, issues };
}

export function overlayUsesRequiredVars(overlayText) {
  const text = String(overlayText || "");
  const missing = [];
  for (const key of objectStorageRequiredEnvKeys()) {
    const required = new RegExp(String.raw`\$\{${key}:\?`);
    if (!required.test(text)) missing.push(key);
  }
  return { ok: missing.length === 0, missing };
}

export function overlaySecurityProperties(overlayText) {
  const text = String(overlayText || "");
  return {
    hasOfficialImage: /quay\.io\/minio\/aistor\/minio/.test(text),
    hasOfficialMc: /quay\.io\/minio\/aistor\/mc/.test(text) || /AISTOR_MC_IMAGE/.test(text),
    forbidsLatestDefault: !/:latest/.test(text),
    noMinioCe:
      !/image:\s*["']?minio\/minio/.test(text) &&
      !/quay\.io\/minio\/minio(?!\/aistor)/.test(text),
    hasProfile: /profiles:\s*\[\s*"object-storage"\s*\]/.test(text) || /-\s*object-storage/.test(text),
    apiLoopback: /127\.0\.0\.1:\$\{AISTOR_API_PORT/.test(text) || /127\.0\.0\.1:\$\{AISTOR_API_BIND/.test(text),
    consoleLoopback: /127\.0\.0\.1:\$\{AISTOR_CONSOLE_PORT/.test(text),
    noDockerSock: !/docker\.sock/.test(text),
    hasLicenseMount: /\/minio\.license/.test(text),
    hasHealthcheck: /healthcheck:/.test(text),
    hasRestart: /restart:\s*unless-stopped/.test(text),
    hasMemLimit: /mem_limit:/.test(text),
    hasPidsLimit: /pids_limit:/.test(text),
    hasCpus: /\bcpus:/.test(text),
    hasLogging: /max-size:/.test(text),
    standaloneData: /object-storage-data:/.test(text),
  };
}

export function migrationDocHasRequiredLinks(markdown) {
  const text = String(markdown || "");
  const needles = [
    "spec/decisions/2026-09-storage-doris-payment.md",
    "freeze",
    "checksum",
    "endpoint",
    "rollback",
    "CDN",
    "presign",
    "trial/",
    "120",
  ];
  const missing = needles.filter((item) => !text.toLowerCase().includes(item.toLowerCase()));
  return { ok: missing.length === 0, missing };
}

export function loadPolicyFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function policyFileName(identity) {
  return `${identity.policy}.json`;
}

export function objectStoragePackManifestNote() {
  return {
    included: false,
    redistributed: false,
    reason:
      "AIStor Free forbids redistribution of the software (in whole or part). Offline packs ship overlay YAML and docs only; the customer obtains the quay.io/minio/aistor image and license separately, or supplies a MinIO-compatible endpoint.",
    overlay: OBJECT_STORAGE_COMPOSE_OVERLAY,
    profile: OBJECT_STORAGE_PROFILE,
    docs: "deploy/object-storage/README.md",
    imagesNotPacked: [...AISTOR_OFFICIAL_REPOS],
  };
}

export function shouldCopyObjectStoragePackFile(relPath) {
  const base = basename(relPath);
  if (base.endsWith(".license") || base === "minio.license") return false;
  if (base.endsWith(".key") || base.endsWith(".pem")) return false;
  return true;
}

export const OBJECT_STORAGE_DOC_PATHS = {
  readme: "deploy/object-storage/README.md",
  caddy: "deploy/object-storage/Caddyfile.example",
  admission: "deploy/object-storage/admission-contract.json",
  overlay: OBJECT_STORAGE_COMPOSE_OVERLAY,
  bootstrap: "deploy/object-storage/bootstrap.sh",
};
