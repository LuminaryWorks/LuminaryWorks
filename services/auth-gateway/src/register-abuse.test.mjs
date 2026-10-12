import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmailCodeCooldownStore,
  createIpQuotaStore,
  evaluateRegisterEmail,
  inspectRegisterAbuse,
  inspectRegisterFields,
  loadRegisterAbuseConfig,
} from "./register-abuse.mjs";

test("loadRegisterAbuseConfig defaults to open domains and finite IP quotas", () => {
  const cfg = loadRegisterAbuseConfig({});
  assert.equal(cfg.emailMode, "off");
  assert.equal(cfg.ipDailyLimit, 5);
  assert.equal(cfg.codeHourlyLimit, 10);
  assert.equal(cfg.codeCooldownSec, 120);
  assert.ok(cfg.allowlist.includes("gmail.com"));
});

test("loadRegisterAbuseConfig reads identity/register-email-policy.json when present", () => {
  const cfg = loadRegisterAbuseConfig({});
  assert.equal(cfg.policyLoaded, true);
  assert.match(cfg.policyFile, /register-email-policy\.json$/);
});

test("env overrides policy file mode", () => {
  const cfg = loadRegisterAbuseConfig({ AUTH_REGISTER_EMAIL_MODE: "off" });
  assert.equal(cfg.emailMode, "off");
});

test("inspectRegisterAbuse accepts any email shape and rejects a bad address", () => {
  const config = loadRegisterAbuseConfig({});
  const quotas = createIpQuotaStore();
  const allowed = inspectRegisterAbuse({
    method: "POST",
    pathname: "/api/experience/verification/verification-code",
    bodyText: JSON.stringify({
      identifier: { type: "email", value: "bot@mailinator.com" },
      interactionEvent: "Register",
    }),
    ip: "1.2.3.4",
    config,
    quotas,
  });
  assert.equal(allowed, null);
  const blocked = inspectRegisterAbuse({
    method: "POST",
    pathname: "/api/experience/verification/verification-code",
    bodyText: JSON.stringify({
      identifier: { type: "email", value: "not-an-email" },
      interactionEvent: "Register",
    }),
    ip: "1.2.3.5",
    config,
    quotas,
  });
  assert.ok(blocked);
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.field, "email");
});

test("inspectRegisterAbuse still enforces an explicit allowlist", () => {
  const config = loadRegisterAbuseConfig({ AUTH_REGISTER_EMAIL_MODE: "allowlist" });
  const quotas = createIpQuotaStore();
  const blocked = inspectRegisterAbuse({
    method: "POST",
    pathname: "/api/experience/verification/verification-code",
    bodyText: JSON.stringify({
      identifier: { type: "email", value: "bot@temp-game.mail" },
      interactionEvent: "Register",
    }),
    ip: "1.2.3.6",
    config,
    quotas,
  });
  assert.ok(blocked);
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error, "register_email_rejected");
});

test("inspectRegisterAbuse rate-limits register identity creations per IP", () => {
  const config = loadRegisterAbuseConfig({ AUTH_REGISTER_IP_DAILY_LIMIT: "2" });
  const quotas = createIpQuotaStore();
  const hit = () =>
    inspectRegisterAbuse({
      method: "POST",
      pathname: "/api/experience/verification/new-password-identity",
      bodyText: JSON.stringify({
        identifier: { type: "username", value: "alice" },
        password: "password123",
      }),
      ip: "9.9.9.9",
      config,
      quotas,
    });
  assert.equal(hit(), null);
  assert.equal(hit(), null);
  const third = hit();
  assert.ok(third);
  assert.equal(third.status, 429);
});

test("evaluateRegisterEmail open mode accepts custom domains", () => {
  const config = loadRegisterAbuseConfig({});
  assert.equal(evaluateRegisterEmail("u@gmail.com", config).ok, true);
  assert.equal(evaluateRegisterEmail("u@not-allowed.example", config).ok, true);
  assert.equal(evaluateRegisterEmail("u@mailinator.com", config).ok, true);
  assert.equal(evaluateRegisterEmail("nope", config).ok, false);
});

test("register field lengths are enforced on username, password, and code", () => {
  const shortUser = inspectRegisterFields({
    method: "POST",
    pathname: "/api/experience/profile",
    bodyText: JSON.stringify({ type: "username", value: "ab" }),
  });
  assert.equal(shortUser?.body.field, "username");
  const longPassword = inspectRegisterFields({
    method: "POST",
    pathname: "/api/experience/verification/new-password-identity",
    bodyText: JSON.stringify({
      identifier: { type: "username", value: "alice" },
      password: "short",
    }),
  });
  assert.equal(longPassword?.body.field, "password");
  const badCode = inspectRegisterFields({
    method: "POST",
    pathname: "/api/experience/verification/verification-code/verify",
    bodyText: JSON.stringify({
      identifier: { type: "email", value: "a@corp.example" },
      verificationId: "vid",
      code: "12345",
      interactionEvent: "Register",
    }),
  });
  assert.equal(badCode?.body.field, "code");
  assert.equal(
    inspectRegisterFields({
      method: "POST",
      pathname: "/api/experience/verification/new-password-identity",
      bodyText: JSON.stringify({
        identifier: { type: "username", value: "alice" },
        password: "password123",
      }),
    }),
    null,
  );
});

test("register verification code cooldown is 120s per email", () => {
  const config = loadRegisterAbuseConfig({ AUTH_REGISTER_CODE_COOLDOWN_SEC: "120" });
  const quotas = createIpQuotaStore();
  const cooldowns = createEmailCodeCooldownStore();
  const hit = (email) =>
    inspectRegisterAbuse({
      method: "POST",
      pathname: "/api/experience/verification/verification-code",
      bodyText: JSON.stringify({
        identifier: { type: "email", value: email },
        interactionEvent: "Register",
      }),
      ip: "203.0.113.20",
      config,
      quotas,
      cooldowns,
    });
  assert.equal(hit("a@corp.example"), null);
  const again = hit("a@corp.example");
  assert.ok(again);
  assert.equal(again.status, 429);
  assert.equal(again.body.error, "register_code_cooldown");
  assert.ok(again.body.retryAfterSec <= 120 && again.body.retryAfterSec >= 119);
  assert.equal(hit("b@corp.example"), null);
});

test("register verification accepts the inboxes used on the local login page", () => {
  const config = loadRegisterAbuseConfig({});
  const quotas = createIpQuotaStore();
  for (const email of ["634117608@qq.com", "hi.andyzhou@gmail.com", "hi.andyzhou@Outlook.com"]) {
    assert.equal(evaluateRegisterEmail(email, config).ok, true, email);
    const blocked = inspectRegisterAbuse({
      method: "POST",
      pathname: "/api/experience/verification/verification-code",
      bodyText: JSON.stringify({
        identifier: { type: "email", value: email },
        interactionEvent: "Register",
      }),
      ip: "203.0.113.10",
      config,
      quotas,
    });
    assert.equal(blocked, null, email);
  }
});
