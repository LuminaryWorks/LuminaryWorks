/**
 * Hosted SaaS / single-VPS acceptance contracts.
 *
 * Static checks so CI can prove the control plane still has:
 *   - a business Control Console (not Logto Admin)
 *   - public payment webhooks
 *   - geo routing via trusted proxies
 *   - MinIO watermarks
 *   - unsellable VistaCast / SyncroBrain
 *   - legal trial-deletion docs
 *
 * Does not start Docker. Live VPS drills (MinIO disk, Doris OOM, N-1 restore)
 * stay in deploy/HOSTED-SAAS.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function issue(severity, code, target, message) {
  return { severity, code, target, message };
}

function read(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return { path, text: null };
  return { path, text: readFileSync(path, "utf8") };
}

function assertNoMojibake(text, target, issues) {
  if (!text) return;
  if (text.includes("\uFFFD") || text.includes("??")) {
    issues.push(issue("error", "mojibake", target, "File contains U+FFFD or ?? runs"));
  }
}

export function checkHostedSaasAcceptance(root = defaultRepoRoot()) {
  const issues = [];

  const compose = read(root, "deploy/compose/control-plane.yaml");
  if (!compose.text) {
    issues.push(issue("error", "missing_file", "deploy/compose/control-plane.yaml", "Control-plane compose is missing"));
  } else {
    if (!/control-console:/.test(compose.text)) {
      issues.push(issue("error", "missing_control_console", "control-plane.yaml", "control-console service is required"));
    }
    if (!/CONTROL_PLANE_BIND_ADDR:-127\.0\.0\.1/.test(compose.text)) {
      issues.push(
        issue("error", "public_bind_default", "control-plane.yaml", "Host ports must default to loopback"),
      );
    }
    if (!/PAYMENT_TRUSTED_PROXIES/.test(compose.text)) {
      issues.push(issue("error", "missing_trusted_proxies", "control-plane.yaml", "PAYMENT_TRUSTED_PROXIES must be forwarded"));
    }
    if (!/mem_limit:\s*256m/.test(compose.text)) {
      issues.push(issue("error", "missing_resource_limits", "control-console", "control-console must set mem_limit"));
    }
    if (!/pids_limit:\s*256/.test(compose.text)) {
      issues.push(issue("error", "missing_pids_limit", "control-console", "control-console must set pids_limit"));
    }
  }

  const overlay = read(root, "deploy/compose/control-plane.object-storage.yaml");
  if (!overlay.text) {
    issues.push(issue("error", "missing_file", "control-plane.object-storage.yaml", "Object-storage overlay is missing"));
  }

  const envExample = read(root, "deploy/env/control-plane.env.example");
  if (!envExample.text) {
    issues.push(issue("error", "missing_file", "control-plane.env.example", "Env example is missing"));
  } else {
    for (const key of [
      "PAYMENT_TRUSTED_PROXIES",
      "PAYMENT_CONFIG_MASTER_KEY",
      "ENTITLEMENT_TRIAL_PURGE_TARGETS",
      "CONTROL_CONSOLE_IDP_CLIENT_ID",
    ]) {
      if (!envExample.text.includes(`${key}=`)) {
        issues.push(issue("error", "missing_env_key", key, `${key} must appear in the env example`));
      }
    }
  }

  const webhook = read(root, "services/entitlement/src/modules/payments/payment-webhook.controller.ts");
  if (!webhook.text) {
    issues.push(issue("error", "missing_file", "payment-webhook.controller.ts", "Webhook controller is missing"));
  } else if (!/@Public\(\)/.test(webhook.text) || !/:provider/.test(webhook.text) || !/:configId/.test(webhook.text)) {
    issues.push(
      issue("error", "webhook_not_public", "payment-webhook.controller.ts", "Provider webhooks must be a public raw-body route"),
    );
  }

  const seed = read(root, "services/entitlement/src/database/seed-catalog.ts");
  if (!seed.text) {
    issues.push(issue("error", "missing_file", "seed-catalog.ts", "Catalog seed is missing"));
  } else {
    if (!/code:\s*"vistacast"[\s\S]{0,200}sellable:\s*false/.test(seed.text)) {
      issues.push(issue("error", "vistacast_sellable", "seed-catalog.ts", "VistaCast must stay sellable=false"));
    }
    if (!/code:\s*"syncrobrain"[\s\S]{0,200}sellable:\s*false/.test(seed.text)) {
      issues.push(issue("error", "syncrobrain_sellable", "seed-catalog.ts", "SyncroBrain must stay sellable=false"));
    }
  }

  const legalZh = read(root, "spec/legal/zh/trial-data-deletion.md");
  const legalEn = read(root, "spec/legal/en/trial-data-deletion.md");
  if (!legalZh.text || !legalEn.text) {
    issues.push(issue("error", "missing_legal", "spec/legal", "Bilingual trial-deletion policy is required"));
  } else {
    assertNoMojibake(legalZh.text, "spec/legal/zh/trial-data-deletion.md", issues);
    if (!/7/.test(legalZh.text) || !/不可恢复|permanent/i.test(`${legalZh.text}\n${legalEn.text}`)) {
      issues.push(issue("error", "legal_trial_scope", "spec/legal", "Trial deletion policy must state duration and permanence"));
    }
  }

  const handbook = read(root, "deploy/HANDBOOK.md");
  const hosted = read(root, "deploy/HOSTED-SAAS.md");
  if (!hosted.text) {
    issues.push(issue("error", "missing_file", "deploy/HOSTED-SAAS.md", "Single-VPS go-live checklist is missing"));
  } else {
    for (const needle of ["TLS", "MinIO", "Doris", "webhook", "Trial", "回滚", "trusted"]) {
      if (!hosted.text.includes(needle) && !(needle === "trusted" && /可信代理|Trusted/.test(hosted.text))) {
        issues.push(issue("error", "hosted_checklist_gap", "HOSTED-SAAS.md", `Checklist is missing ${needle}`));
      }
    }
    assertNoMojibake(hosted.text, "deploy/HOSTED-SAAS.md", issues);
  }
  if (handbook.text && !/HOSTED-SAAS/.test(handbook.text)) {
    issues.push(issue("warning", "handbook_link", "HANDBOOK.md", "Handbook should link the Hosted SaaS checklist"));
  }

  const watermark = read(root, "scripts/lib/object-storage.mjs");
  if (watermark.text && (!watermark.text.includes("70") || !/80/.test(watermark.text) || !/90/.test(watermark.text))) {
    issues.push(issue("error", "watermark_missing", "object-storage.mjs", "70/80/90 watermarks must remain"));
  }

  return { issues };
}

export function formatHostedSaasIssues(issues) {
  return issues.map((item) => `[${item.severity}] ${item.code} ${item.target}: ${item.message}`).join("\n");
}
