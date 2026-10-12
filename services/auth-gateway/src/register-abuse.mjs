/**
 * Register abuse controls for Auth Gateway (email domain + IP quotas).
 * Policy file: identity/register-email-policy.json (editable without code changes).
 * In-memory counters — fine for single-node staging; use Redis for multi-replica prod.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
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

/** Keep in sync with auth-react `register-field-limits.ts`. */
export const REGISTER_FIELD_LIMITS = {
  emailMin: 6,
  emailMax: 64,
  usernameMin: 3,
  usernameMax: 20,
  passwordMin: 8,
  passwordMax: 32,
  codeLength: 6,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CODE_RE = /^\d{6}$/;

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
  const key = String(raw ?? "").trim().toLowerCase();
  if (key === "allowlist" || key === "allow") return "allowlist";
  if (key === "blocklist" || key === "deny" || key === "blacklist") return "blocklist";
  if (!key || key === "off" || key === "false" || key === "0" || key === "disabled") return "off";
  return "allowlist";
}

function finiteNonNegative(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
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
  const cooldownFromEnv = env.AUTH_REGISTER_CODE_COOLDOWN_SEC;

  return {
    emailMode: normalizeMode(modeFromEnv ?? f.mode ?? "off"),
    allowlist: parseList(
      allowFromEnv != null && String(allowFromEnv).trim() !== "" ? allowFromEnv : f.allowlist,
      BUILTIN_ALLOWLIST,
    ),
    blocklist: parseList(
      blockFromEnv != null && String(blockFromEnv).trim() !== "" ? blockFromEnv : f.blocklist,
      [],
    ),
    ipDailyLimit: Math.max(
      0,
      Number(ipFromEnv ?? f.ipDailyLimit ?? 5),
    ),
    codeHourlyLimit: finiteNonNegative(codeFromEnv ?? f.codeHourlyLimit, 10),
    codeCooldownSec: finiteNonNegative(cooldownFromEnv ?? f.codeCooldownSec, 120),
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
    codeCooldownSec: config.codeCooldownSec,
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
  const value = String(email || "").trim();
  const domain = emailDomain(value);
  if (
    !domain ||
    value.length < REGISTER_FIELD_LIMITS.emailMin ||
    value.length > REGISTER_FIELD_LIMITS.emailMax ||
    !EMAIL_RE.test(value)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (config.emailMode === "off" || config.emailMode === "blocklist") {
    return { ok: true, domain };
  }
  if (!config.allowlist.includes(domain)) {
    return { ok: false, reason: "not_allowed", domain };
  }
  return { ok: true, domain };
}

function fieldInvalid(field, message) {
  return {
    status: 422,
    body: {
      error: "register_field_invalid",
      field,
      message,
    },
  };
}

function checkUsername(value) {
  const username = String(value || "").trim();
  if (
    username.length < REGISTER_FIELD_LIMITS.usernameMin ||
    username.length > REGISTER_FIELD_LIMITS.usernameMax ||
    !USERNAME_RE.test(username)
  ) {
    return fieldInvalid(
      "username",
      "Username must be 3–20 characters and start with a letter or underscore.",
    );
  }
  return null;
}

function checkPassword(value) {
  const password = String(value ?? "");
  if (
    password.length < REGISTER_FIELD_LIMITS.passwordMin ||
    password.length > REGISTER_FIELD_LIMITS.passwordMax
  ) {
    return fieldInvalid("password", "Password must be 8–32 characters.");
  }
  return null;
}

function checkCode(value) {
  if (!CODE_RE.test(String(value || "").trim())) {
    return fieldInvalid("code", "Verification code must be 6 digits.");
  }
  return null;
}

/**
 * Length and shape checks for register Experience writes.
 * @returns {null | { status: number, body: object }}
 */
export function inspectRegisterFields({ method, pathname, bodyText }) {
  if (method !== "POST" || !bodyText) return null;
  const path = String(pathname || "").replace(/\/$/, "") || "/";
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;

  const isCode = path.endsWith("/verification/verification-code");
  const isVerify = path.endsWith("/verification/verification-code/verify");
  const isPasswordIdentity = path.endsWith("/verification/new-password-identity");
  const isProfile = path.endsWith("/profile");

  if (isCode || isVerify) {
    const event = json.interactionEvent;
    if (event && event !== "Register") return null;
    const email = json?.identifier?.value;
    if (!email) return null;
    const decision = evaluateRegisterEmail(email, { emailMode: "off", allowlist: [] });
    if (!decision.ok) {
      return fieldInvalid("email", "Enter a valid email address (6–64 characters).");
    }
    if (isVerify) return checkCode(json.code);
    return null;
  }

  if (isPasswordIdentity) {
    const username = json?.identifier?.value;
    return checkUsername(username) || checkPassword(json.password);
  }

  if (isProfile) {
    if (json.type === "username") return checkUsername(json.value);
    if (json.type === "password") return checkPassword(json.value);
  }

  return null;
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
/**
 * Per-email resend gap for register verification codes.
 * In-memory — single node. Multi-replica deploys should move this to Redis.
 */
/**
 * Connect middleware for local IdP proxies that do not pass through Auth Gateway.
 * Same 120s per-email gap as `inspectRegisterAbuse`.
 * @param {{ cooldownSec?: number }} [options]
 */
export function registerCodeCooldownMiddleware(options = {}) {
  const cooldowns = createEmailCodeCooldownStore();
  const cooldownSec = options.cooldownSec ?? 120;
  return function registerCodeCooldown(req, res, next) {
    const path = String(req.url || "").split("?")[0].replace(/\/$/, "");
    const watchesRegisterBody =
      path.endsWith("/verification/verification-code") ||
      path.endsWith("/verification/verification-code/verify") ||
      path.endsWith("/verification/new-password-identity") ||
      path.endsWith("/profile");
    if (req.method !== "POST" || !watchesRegisterBody) {
      next();
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("error", (err) => next(err));
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      const fields = inspectRegisterFields({
        method: "POST",
        pathname: path,
        bodyText: buf.toString("utf8"),
      });
      if (fields) {
        res.statusCode = fields.status;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify(fields.body));
        return;
      }
      const blocked = cooldownDecision(buf, cooldowns, cooldownSec);
      if (blocked) {
        res.statusCode = 429;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.setHeader("retry-after", String(blocked.retryAfterSec));
        res.end(JSON.stringify(blocked.body));
        return;
      }
      const stream = Readable.from(buf);
      req.pipe = stream.pipe.bind(stream);
      next();
    });
  };
}

function cooldownDecision(buf, cooldowns, cooldownSec) {
  let json = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
  const event = json?.interactionEvent;
  if (event && event !== "Register") return null;
  if (json?.identifier?.type && json.identifier.type !== "email") return null;
  const email = json?.identifier?.value;
  if (!email || cooldownSec <= 0) return null;
  const left = cooldowns.remainingSec(email);
  if (left > 0) {
    return {
      retryAfterSec: left,
      body: {
        error: "register_code_cooldown",
        message: "Wait before requesting another verification code for this email.",
        retryAfterSec: left,
      },
    };
  }
  cooldowns.arm(email, cooldownSec);
  return null;
}

export function createEmailCodeCooldownStore() {
  /** @type {Map<string, number>} */
  const untilByEmail = new Map();
  return {
    /** @param {string} email */
    remainingSec(email, now = Date.now()) {
      const key = String(email || "").trim().toLowerCase();
      const until = untilByEmail.get(key);
      if (!until || until <= now) {
        if (until) untilByEmail.delete(key);
        return 0;
      }
      return Math.max(1, Math.ceil((until - now) / 1000));
    },
    /** @param {string} email @param {number} cooldownSec */
    arm(email, cooldownSec, now = Date.now()) {
      if (cooldownSec <= 0) return;
      const key = String(email || "").trim().toLowerCase();
      if (!key) return;
      untilByEmail.set(key, now + cooldownSec * 1000);
    },
  };
}

export function inspectRegisterAbuse({
  method,
  pathname,
  bodyText,
  ip,
  config,
  quotas,
  cooldowns,
}) {
  const fields = inspectRegisterFields({ method, pathname, bodyText });
  if (fields) return fields;
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
                decision.reason === "invalid"
                  ? "Enter a valid email address (6–64 characters)."
                  : "Email domain is not allowed for self-registration",
              domain: decision.domain,
            },
          };
        }
        const cooldownSec = config.codeCooldownSec ?? 120;
        const left = cooldowns?.remainingSec(email) ?? 0;
        if (cooldownSec > 0 && left > 0) {
          return {
            status: 429,
            headers: { "retry-after": String(left) },
            body: {
              error: "register_code_cooldown",
              message: "Wait before requesting another verification code for this email.",
              retryAfterSec: left,
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
      const cooldownSec = config.codeCooldownSec ?? 120;
      if (email && cooldownSec > 0) cooldowns?.arm(email, cooldownSec);
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
