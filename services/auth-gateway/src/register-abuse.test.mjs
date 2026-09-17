import assert from "node:assert/strict";
import test from "node:test";
import {
  createIpQuotaStore,
  evaluateRegisterEmail,
  inspectRegisterAbuse,
  loadRegisterAbuseConfig,
} from "./register-abuse.mjs";

test("loadRegisterAbuseConfig defaults to allowlist and finite IP quotas", () => {
  const cfg = loadRegisterAbuseConfig({});
  assert.equal(cfg.emailMode, "allowlist");
  assert.equal(cfg.ipDailyLimit, 5);
  assert.equal(cfg.codeHourlyLimit, 10);
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

test("inspectRegisterAbuse rejects non-allowlisted email on verification-code", () => {
  const config = loadRegisterAbuseConfig({});
  const quotas = createIpQuotaStore();
  const blocked = inspectRegisterAbuse({
    method: "POST",
    pathname: "/api/experience/verification/verification-code",
    bodyText: JSON.stringify({
      identifier: { type: "email", value: "bot@temp-game.mail" },
      interactionEvent: "Register",
    }),
    ip: "1.2.3.4",
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

test("evaluateRegisterEmail allowlist", () => {
  const config = loadRegisterAbuseConfig({});
  assert.equal(evaluateRegisterEmail("u@gmail.com", config).ok, true);
  assert.equal(evaluateRegisterEmail("u@not-allowed.example", config).ok, false);
});
