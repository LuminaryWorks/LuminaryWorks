/**
 * FR-GEO-001 / FR-GEO-002 / FR-GEO-003 守卫。
 * 规范：DoerFlow spec/GEO_PORTABILITY.md
 */

import { getMetadataArgsStorage } from "typeorm";
import { GrantEntity } from "../src/database/entities/grant.entity";
import { SubscriptionEntity } from "../src/database/entities/subscription.entity";
import {
  ATTESTATION_MAX_TTL_DAYS,
  type EntitlementAttestationPayload,
  validateAttestationShape,
  verifyEntitlementAttestation,
} from "../src/license/attestation";
import { canonicalize } from "../src/license/canonical-json";
import { generateEd25519KeyPair, loadPrivateKey } from "../src/license/ed25519";
import { sign } from "node:crypto";

function columnNamesOf(target: abstract new (...args: never[]) => unknown): string[] {
  const storage = getMetadataArgsStorage();
  return storage.columns
    .filter((col) => col.target === target)
    .map((col) => col.options.name ?? col.propertyName);
}

/**
 * 权益表一旦带上渠道 / 链上 / 钱包 / 金额字段，境内库就会持有加密支付痕迹，
 * 跨区可携带性的合规前提即失效。此处把列集合钉死。
 */
const FORBIDDEN_ENTITLEMENT_COLUMNS = [
  "provider",
  "provider_id",
  "providerId",
  "tx_hash",
  "txHash",
  "transaction_hash",
  "wallet_address",
  "walletAddress",
  "payer_address",
  "amount_cents",
  "amountCents",
  "amount_minor",
  "currency",
  "payment_attempt_id",
  "charge_id",
  "ledger_op_id",
  "last_order_id",
  "order_id",
];

describe("FR-GEO-001 权益表不承载渠道 / 链上标识", () => {
  for (const [name, entity] of [
    ["subscriptions", SubscriptionEntity],
    ["grants", GrantEntity],
  ] as const) {
    it(`${name} 不含任何支付渠道 / 链上 / 金额列`, () => {
      const columns = columnNamesOf(entity);
      expect(columns.length).toBeGreaterThan(0);
      for (const forbidden of FORBIDDEN_ENTITLEMENT_COLUMNS) {
        expect(columns).not.toContain(forbidden);
      }
    });

    it(`${name} 仍保留 source/source_ref（唯一允许的来源引用）`, () => {
      const columns = columnNamesOf(entity);
      expect(columns).toContain("source");
      expect(columns).toContain("source_ref");
    });
  }
});

function makePayload(
  overrides: Partial<EntitlementAttestationPayload> = {},
): EntitlementAttestationPayload {
  const now = new Date("2026-09-16T00:00:00.000Z");
  return {
    v: 1,
    kind: "entitlement_attestation",
    subject: "logto_sub_abc",
    productCode: "dataluminary",
    plan: "pro",
    features: [{ code: "ai.analysis", type: "bool", value: true }],
    quotas: [{ code: "dashboard.count", limit: 50, mode: "gauge" }],
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + 3 * 86400000).toISOString(),
    issuedAt: now.toISOString(),
    issuerRegion: "global",
    keyId: "lw-att-2026-09",
    ...overrides,
  };
}

describe("FR-GEO-003 断言严格模式拒绝支付字段", () => {
  it("接受规范形状", () => {
    expect(validateAttestationShape(makePayload())).toEqual({ ok: true });
  });

  it.each([
    "orderId",
    "source",
    "sourceRef",
    "providerId",
    "txHash",
    "walletAddress",
    "amountMinor",
    "currency",
  ])("拒绝携带 %s 的断言", (field) => {
    const payload = { ...makePayload(), [field]: "leaked" };
    const result = validateAttestationShape(payload);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(["ATTESTATION_FORBIDDEN_FIELD", "ATTESTATION_UNKNOWN_FIELD"]).toContain(result.code);
    }
  });

  it("拒绝任意未知字段（严格模式，不是忽略）", () => {
    const result = validateAttestationShape({ ...makePayload(), somethingNew: 1 });
    expect(result).toMatchObject({ ok: false, code: "ATTESTATION_UNKNOWN_FIELD" });
  });

  it("拒绝境内回传（issuerRegion 必须为 global，同步是单向的）", () => {
    const result = validateAttestationShape({ ...makePayload(), issuerRegion: "cn" });
    expect(result).toMatchObject({ ok: false, code: "ATTESTATION_MALFORMED" });
  });

  it(`拒绝 TTL 超过 ${ATTESTATION_MAX_TTL_DAYS} 天（退款后须快速失效）`, () => {
    const from = new Date("2026-09-16T00:00:00.000Z");
    const result = validateAttestationShape(
      makePayload({
        validFrom: from.toISOString(),
        validUntil: new Date(from.getTime() + 400 * 86400000).toISOString(),
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "ATTESTATION_TTL_TOO_LONG" });
  });
});

describe("FR-GEO-002 断言验签", () => {
  const keys = generateEd25519KeyPair();
  const ring = { "lw-att-2026-09": keys.publicKeyPem };
  const now = new Date("2026-09-17T00:00:00.000Z");

  function signPayload(payload: EntitlementAttestationPayload): string {
    const bytes = Buffer.from(canonicalize(payload), "utf8");
    return Buffer.from(sign(null, bytes, loadPrivateKey(keys.privateKeyPem))).toString("base64url");
  }

  it("接受有效签名", () => {
    const payload = makePayload();
    const signed = { payload, signature: signPayload(payload) };
    expect(verifyEntitlementAttestation(signed, ring, { now })).toEqual({ ok: true });
  });

  it("拒绝被篡改的 plan（提权）", () => {
    const payload = makePayload();
    const signature = signPayload(payload);
    const tampered = { payload: { ...payload, plan: "ultra" }, signature };
    expect(verifyEntitlementAttestation(tampered, ring, { now })).toMatchObject({
      ok: false,
      code: "ATTESTATION_INVALID_SIGNATURE",
    });
  });

  it("拒绝未知 keyId", () => {
    const payload = makePayload({ keyId: "lw-att-unknown" });
    const signed = { payload, signature: signPayload(payload) };
    expect(verifyEntitlementAttestation(signed, ring, { now })).toMatchObject({
      ok: false,
      code: "ATTESTATION_UNKNOWN_KEY",
    });
  });

  it("过期断言 fail-closed", () => {
    const payload = makePayload();
    const signed = { payload, signature: signPayload(payload) };
    const later = new Date("2026-10-01T00:00:00.000Z");
    expect(verifyEntitlementAttestation(signed, ring, { now: later })).toMatchObject({
      ok: false,
      code: "ATTESTATION_EXPIRED",
    });
  });

  it("subject 不匹配时拒绝", () => {
    const payload = makePayload();
    const signed = { payload, signature: signPayload(payload) };
    expect(
      verifyEntitlementAttestation(signed, ring, { now, requireSubject: "logto_sub_other" }),
    ).toMatchObject({ ok: false });
  });
});
