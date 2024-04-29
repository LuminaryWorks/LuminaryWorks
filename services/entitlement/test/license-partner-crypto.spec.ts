import { createHash, timingSafeEqual } from "node:crypto";
import {
  hashSecret,
  hmacSha256Base64Url,
  safeEqualString,
  verifySecretHash,
} from "../src/common/crypto";
import { canonicalize } from "../src/license/canonical-json";
import {
  generateEd25519KeyPair,
  signLicensePayload,
  verifySignedLicense,
} from "../src/license/ed25519";
import { PartnerWebhookService } from "../src/modules/partner/partner-webhook.service";

describe("safeEqualString", () => {
  it("returns true for equal secrets", () => {
    expect(safeEqualString("abc", "abc")).toBe(true);
  });
  it("returns false for unequal secrets without throwing", () => {
    expect(safeEqualString("abc", "abd")).toBe(false);
    expect(safeEqualString("abc", "ab")).toBe(false);
  });
});

describe("partner secret hashing", () => {
  it("verifies with pepper", () => {
    const hash = hashSecret("sekret", "pepper");
    expect(verifySecretHash("sekret", "pepper", hash)).toBe(true);
    expect(verifySecretHash("wrong", "pepper", hash)).toBe(false);
  });
});

describe("partner webhook HMAC", () => {
  it("signs and verifies constant-time", () => {
    const secret = "whsec_test";
    const ts = "1700000000";
    const nonce = "n1";
    const body = '{"event_type":"partner.redemption.created"}';
    const sig = hmacSha256Base64Url(secret, `${ts}.${nonce}.${body}`);
    const again = hmacSha256Base64Url(secret, `${ts}.${nonce}.${body}`);
    expect(safeEqualString(sig, again)).toBe(true);
    const a = Buffer.from(sig);
    const b = Buffer.from(again);
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it("computeSignature matches PartnerWebhookService", () => {
    const svc = Object.create(PartnerWebhookService.prototype) as PartnerWebhookService;
    const sig = svc.computeSignature("s", "1", "n", "{}");
    expect(sig).toBe(hmacSha256Base64Url("s", "1.n.{}"));
  });
});

describe("Ed25519 license", () => {
  const kp = generateEd25519KeyPair();
  const payload = {
    licenseId: "lic_test_1",
    kid: kp.kid,
    deploymentId: "dep_1",
    products: ["dataluminary"],
    features: {
      dataluminary: { "dashboard.export": true, "dashboard.count": 50 },
    },
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    offlineGraceDays: 14,
    customerName: "Test Corp",
  };

  it("signs and verifies", () => {
    const signed = signLicensePayload(payload, kp.privateKeyPem);
    const ok = verifySignedLicense(signed, { [kp.kid]: kp.publicKeyPem });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.withinGrace).toBe(false);
  });

  it("rejects tampered payload", () => {
    const signed = signLicensePayload(payload, kp.privateKeyPem);
    const tampered = {
      ...signed,
      payload: { ...signed.payload, customerName: "Evil Corp" },
    };
    const bad = verifySignedLicense(tampered, { [kp.kid]: kp.publicKeyPem });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("ENTITLEMENT_LICENSE_INVALID");
  });

  it("rejects unknown kid", () => {
    const signed = signLicensePayload(payload, kp.privateKeyPem);
    const bad = verifySignedLicense(signed, { other: kp.publicKeyPem });
    expect(bad.ok).toBe(false);
  });

  it("enforces expiry and grace", () => {
    const signed = signLicensePayload(payload, kp.privateKeyPem);
    const expired = verifySignedLicense(
      signed,
      { [kp.kid]: kp.publicKeyPem },
      {
        now: new Date("2027-01-10T00:00:00.000Z"),
      },
    );
    expect(expired.ok).toBe(true);
    if (expired.ok) expect(expired.withinGrace).toBe(true);

    const hard = verifySignedLicense(
      signed,
      { [kp.kid]: kp.publicKeyPem },
      {
        now: new Date("2027-01-20T00:00:00.000Z"),
      },
    );
    expect(hard.ok).toBe(false);
    if (!hard.ok) expect(hard.code).toBe("ENTITLEMENT_LICENSE_EXPIRED");
  });

  it("checks product feature limits", () => {
    const signed = signLicensePayload(payload, kp.privateKeyPem);
    const missing = verifySignedLicense(
      signed,
      { [kp.kid]: kp.publicKeyPem },
      {
        requireProduct: "dataluminary",
        requireFeature: "ai.analysis",
      },
    );
    expect(missing.ok).toBe(false);

    const ok = verifySignedLicense(
      signed,
      { [kp.kid]: kp.publicKeyPem },
      {
        requireProduct: "dataluminary",
        requireFeature: "dashboard.export",
      },
    );
    expect(ok.ok).toBe(true);
  });

  it("canonical JSON is stable", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(createHash("sha256").update(canonicalize(payload)).digest("hex")).toHaveLength(64);
  });
});
