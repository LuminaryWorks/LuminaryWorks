/**
 * Register abuse controls for Auth Gateway (email domain + IP quotas).
 * Policy file: identity/register-email-policy.json (editable without code changes).
 * In-memory counters — fine for single-node staging; use Redis for multi-replica prod.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY_FILE = join(HERE, "../../../identity/register-email-policy.json");

const BUILTIN_ALLOWLIST = [
  "gmail.com",
  "googlemail.com",
  "qq.com",
  "foxmail.com",
  "163.com",
  "126.com",
  "yeah.net",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "yahoo.co.jp",
  "proton.me",
  "protonmail.com",
  "sina.com",
  "sina.cn",
  "aliyun.com",
  "139.com",
];

const BUILTIN_BLOCKLIST = [
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
  "maildrop.cc",
  "discard.email",
  "mailnesia.com",
];

function parseList(raw, fallback) {
  if (raw == null || (typeof raw === "string" && !raw.trim())) return [...fallback];
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw
          .map((s) => String(s).trim().toLowerCase().replace(/^@/, ""))
          .filter(Boolean),
      ),
    ];
  }
  return [
    ...new Set(
      String(raw)
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    ),
  ];
}

function normalizeMode(raw) {
  const key = String(raw || "allowlist").trim().toLowerCase();
  if (key === "off" || key === "false" || key === "0" || key === "disabled") return "off";
  if (key === "blocklist" || key === "deny" || key === "blacklist") return "blocklist";
  return "allowlist";
}

export function resolvePolicyFilePath(env = process.env) {
  const fromEnv = env.AUTH_REGISTER_POLICY_FILE?.trim();
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : join(process.cwd(), fromEnv);
  return DEFAULT_POLICY_FILE;
}

function readPolicyFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const mtimeMs = statSync(filePath).mtimeMs;
    return { raw, mtimeMs, filePath };
  } catch {
    return null;
  }
}

let cachedFile = /** @type {null | { raw: object, mtimeMs: number, filePath: string }} */ (null);

export function loadPolicyFile(env = process.env, { force = false } = {}) {
  const filePath = resolvePolicyFilePath(env);
  const hot = env.AUTH_REGISTER_POLICY_HOT_RELOAD !== "0";
  if (!force && cachedFile && cachedFile.filePath === filePath) {
    if (!hot) return cachedFile;
    try {
      if (statSync(filePath).mtimeMs === cachedFile.mtimeMs) return cachedFile;
    } catch {
      return cachedFile;
    }
  }
  cachedFile = readPolicyFile(filePath);
  return cachedFile;
}

/**
 * Merge: file defaults ← env overrides (env wins when set).
 */
export function loadRegisterAbuseConfig(env = process.env) {
  const file = loadPolicyFile(env);
  const f = file?.raw || {};

  const modeFromEnv = env.AUTH_REGISTER_EMAIL_MODE;
  const allowFromEnv = env.AUTH_REGISTER_EMAIL_ALLOWLIST;
  const blockFromEnv = env.AUTH_REGISTER_EMAIL_BLOCKLIST;
  const ipFromEnv = env.AUTH_REGISTER_IP_DAILY_LIMIT;
  const codeFromEnv = env.AUTH_REGISTER_CODE_IP_HOURLY_LIMIT;

  return {
    emailMode: normalizeMode(modeFromEnv ?? f.mode ?? "allowlist"),
    allowlist: parseList(
      allowFromEnv != null && String(allowFromEnv).trim() !== "" ? allowFromEnv : f.allowlist,
      BUILTIN_ALLOWLIST,
    ),
    blocklist: parseList(
      blockFromEnv != null && String(blockFromEnv).trim() !== "" ? blockFromEnv : f.blocklist,
      BUILTIN_BLOCKLIST,
    ),
    ipDailyLimit: Math.max(
      0,
      Number(ipFromEnv ?? f.ipDailyLimit ?? 5),
    ),
    codeHourlyLimit: Math.max(
      0,
      Number(codeFromEnv ?? f.codeHourlyLimit ?? 10),
    ),
    enabled: env.AUTH_REGISTER_ABUSE_GUARD !== "0",
    policyFile: file?.filePath || resolvePolicyFilePath(env),
    policyLoaded: Boolean(file),
  };
}

/** Public payload for SPA / ops (no secrets). */
export function publicRegisterPolicy(config) {
  return {
    mode: config.emailMode,
    allowlist: config.allowlist,
    blocklist: config.blocklist,
    ipDailyLimit: config.ipDailyLimit,
    codeHourlyLimit: config.codeHourlyLimit,
    enabled: config.enabled,
  };
}

export function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  return req.socket?.remoteAddress || "unknown";
}

export function emailDomain(email) {
  const trimmed = String(email || "")
    .trim()
    .toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

export function evaluateRegisterEmail(email, config) {
  const domain = emailDomain(email);
  if (!domain || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    return { ok: false, reason: "invalid" };
  }
  if (config.blocklist.includes(domain)) {
    return { ok: false, reason: "disposable", domain };
  }
  if (config.emailMode === "off" || config.emailMode === "blocklist") {
    return { ok: true, domain };
  }
  if (!config.allowlist.includes(domain)) {
    return { ok: false, reason: "not_allowed", domain };
  }
  return { ok: true, domain };
}

function dayKey(ip) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${ip}|${y}-${m}-${day}`;
}

function hourKey(ip) {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `${ip}|${y}-${m}-${day}T${h}`;
}

/**
 * Sliding counters with TTL cleanup on access.
 * @returns {{ checkAndBump: (kind: 'register'|'code', ip: string) => { ok: boolean, retryAfterSec?: number } }}
 */
export function createIpQuotaStore() {
  const registerDay = new Map();
  const codeHour = new Map();

  function bump(map, key, limit) {
    if (limit <= 0) return { ok: true };
    const now = Date.now();
    const row = map.get(key);
    const windowMs = map === codeHour ? 2 * 3600_000 : 48 * 3600_000;
    if (!row || row.expiresAt <= now) {
      map.set(key, { count: 1, expiresAt: now + windowMs });
      return { ok: true };
    }
    if (row.count >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((row.expiresAt - now) / 1000));
      return { ok: false, retryAfterSec };
    }
    row.count += 1;
    return { ok: true };
  }

  return {
    /** @param {'register'|'code'} kind */
    consume(kind, ip, limit) {
      if (kind === "code") return bump(codeHour, hourKey(ip), limit);
      return bump(registerDay, dayKey(ip), limit);
    },
  };
}

/**
 * @returns {null | { status: number, body: object, headers?: Record<string,string> }}
 */
export function inspectRegisterAbuse({
  method,
  pathname,
  bodyText,
  ip,
  config,
  quotas,
}) {
  if (!config.enabled) return null;
  const path = pathname.replace(/\/$/, "") || "/";
  const isExperienceRoot = path === "/api/experience" || path.endsWith("/api/experience");
  const isVerificationCode =
    path.endsWith("/api/experience/verification/verification-code") ||
    path.endsWith("/verification/verification-code");
  const isNewPasswordIdentity =
    path.endsWith("/api/experience/verification/new-password-identity") ||
    path.endsWith("/verification/new-password-identity");

  let json = null;
  if (bodyText) {
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = null;
    }
  }

  if (method === "POST" && isVerificationCode) {
    const event = json?.interactionEvent;
    if (event && event !== "Register") return null;
    if (event === "Register" || json?.identifier?.type === "email") {
      const email = json?.identifier?.value;
      if (email) {
        const decision = evaluateRegisterEmail(email, config);
        if (!decision.ok) {
          return {
            status: 422,
            body: {
              error: "register_email_rejected",
              reason: decision.reason,
              message:
                decision.reason === "disposable"
                  ? "Disposable email addresses are not allowed"
                  : "Email domain is not allowed for self-registration",
              domain: decision.domain,
            },
          };
        }
      }
      const q = quotas.consume("code", ip, config.codeHourlyLimit);
      if (!q.ok) {
        return {
          status: 429,
          headers: { "retry-after": String(q.retryAfterSec || 3600) },
          body: {
            error: "register_code_rate_limited",
            message: "Too many verification codes from this network. Try again later.",
          },
        };
      }
      const r = quotas.consume("register", ip, config.ipDailyLimit);
      if (!r.ok) {
        return {
          status: 429,
          headers: { "retry-after": String(r.retryAfterSec || 86400) },
          body: {
            error: "register_ip_rate_limited",
            message: "Too many registrations from this network today.",
          },
        };
      }
    }
    return null;
  }

  if (method === "POST" && isNewPasswordIdentity) {
    const r = quotas.consume("register", ip, config.ipDailyLimit);
    if (!r.ok) {
      return {
        status: 429,
        headers: { "retry-after": String(r.retryAfterSec || 86400) },
        body: {
          error: "register_ip_rate_limited",
          message: "Too many registrations from this network today.",
        },
      };
    }
    return null;
  }

  if (method === "PUT" && isExperienceRoot && json?.interactionEvent === "Register") {
    // Soft check only — do not consume quota on init (users may abandon).
    return null;
  }

  return null;
}
