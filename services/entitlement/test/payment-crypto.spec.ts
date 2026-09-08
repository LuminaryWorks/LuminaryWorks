import { randomBytes } from "node:crypto";
import {
  assertGenericCredentials,
  assertPaymentMasterKeyAvailable,
  credentialLastFour,
  decryptPaymentSecrets,
  encryptPaymentSecrets,
  fingerprintPaymentMasterKey,
  parsePaymentMasterKey,
  redactPaymentSecrets,
} from "../src/common/payment-crypto";
import { EntitlementException } from "../src/common/errors";
import {
  assertAlipayF2fCredentials,
  assertBitpayCredentials,
  assertCoinbaseCommerceCredentials,
  assertOkxOnchainCredentials,
  assertPaypalCredentials,
  assertStripeCheckoutCredentials,
  assertUnionpayQuickpassCredentials,
  assertWechatPayV3Credentials,
} from "../src/common/payment-credentials";

const KEY = randomBytes(32);

describe("payment credential envelope", () => {
  it("roundtrips AES-256-GCM secrets", () => {
    const plaintext = JSON.stringify({ webhookSecret: "whsec_test", appId: "app_1234" });
    const envelope = encryptPaymentSecrets(plaintext, KEY);
    expect(envelope.startsWith("lwpay1.")).toBe(true);
    expect(decryptPaymentSecrets(envelope, KEY)).toBe(plaintext);
    expect(fingerprintPaymentMasterKey(KEY)).toHaveLength(16);
  });

  it("rejects a different master key", () => {
    const envelope = encryptPaymentSecrets("secret", KEY);
    expect(() => decryptPaymentSecrets(envelope, randomBytes(32))).toThrow(EntitlementException);
  });

  it("parses 32-byte hex and base64 keys and rejects short keys", () => {
    const hex = KEY.toString("hex");
    expect(parsePaymentMasterKey(hex).equals(KEY)).toBe(true);
    expect(parsePaymentMasterKey(KEY.toString("base64")).equals(KEY)).toBe(true);
    expect(() => parsePaymentMasterKey("tooshort")).toThrow(EntitlementException);
    expect(() => parsePaymentMasterKey("")).toThrow(EntitlementException);
  });

  it("requires a production master key only when provider configs are enabled", () => {
    expect(() =>
      assertPaymentMasterKeyAvailable({
        nodeEnv: "production",
        masterKey: undefined,
        enabledProviderConfigs: 1,
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertPaymentMasterKeyAvailable({
        nodeEnv: "production",
        masterKey: undefined,
        enabledProviderConfigs: 0,
      }),
    ).not.toThrow();
    expect(() =>
      assertPaymentMasterKeyAvailable({
        nodeEnv: "development",
        masterKey: undefined,
        enabledProviderConfigs: 2,
      }),
    ).not.toThrow();
  });

  it("redacts secrets and never keeps plaintext credentials", () => {
    const redacted = redactPaymentSecrets({
      webhookSecret: "abc",
      credentialsCiphertext: "lwpay1....",
      credentials: { webhookSecret: "abc", appId: "app_1234" },
      nested: { privateKey: "pem" },
      providerId: "mock",
    });
    expect(redacted.webhookSecret).toBe("[redacted]");
    expect(redacted.credentialsCiphertext).toBe("[redacted]");
    expect(redacted.credentials).toEqual({ webhookSecret: "[redacted]", appId: "[redacted]" });
    expect(redacted.nested).toEqual({ privateKey: "[redacted]" });
    expect(redacted.providerId).toBe("mock");
    expect(credentialLastFour({ appId: "app_1234" })).toBe("1234");
  });

  it("rejects non-string credential maps", () => {
    expect(() => assertGenericCredentials(["x"])).toThrow(EntitlementException);
    expect(() => assertGenericCredentials({ nested: { a: "b" } })).toThrow(EntitlementException);
    expect(assertGenericCredentials({ webhookSecret: "whsec" })).toEqual({
      webhookSecret: "whsec",
    });
  });

  it("validates Alipay and PayPal credential shapes and redacts diagnostics-related keys", () => {
    expect(() =>
      assertAlipayF2fCredentials({
        appId: "20210001",
        merchantPrivateKey: "not-a-key",
        alipayPublicKey: "not-a-key",
        notifyUrl: "https://entitlement.example.com/notify",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertPaypalCredentials({
        clientId: "short",
        clientSecret: "short",
        webhookId: "bad",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertPaypalCredentials({
        clientId: "client_id_paypal_xx",
        clientSecret: "client_secret_paypal_yy",
        webhookId: "WH-12345678ABCDEFGH",
        gatewayUrl: "https://evil.example",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertWechatPayV3Credentials({
        mchid: "1900000001",
        appid: "wx1234567890abcdef",
        merchantSerial: "AABBCCDD",
        merchantPrivateKey: "not-a-key",
        apiV3Key: "0123456789abcdef0123456789abcdef",
        notifyUrl: "https://entitlement.example.com/notify",
        wechatpayPublicKey: "not-a-key",
        wechatpayPublicKeyId: "PUB_KEY_ID_1",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertStripeCheckoutCredentials({
        secretKey: "sk_test_abc",
        webhookSecret: "whsec_abcdefghijklmnopqrstuv",
        apiBase: "https://evil.example",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertUnionpayQuickpassCredentials({
        merId: "777290058110097",
        certId: "68759663125",
        merchantPrivateKey: "not-a-key",
        unionpayPublicKey: "not-a-key",
        frontUrl: "https://app.example.com/front",
        backUrl: "https://entitlement.example.com/back",
        checkoutMode: "hosted",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertCoinbaseCommerceCredentials({
        apiKeyId: "not-a-uuid",
        apiKeySecret: "short",
        webhookSecret: "tiny",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertCoinbaseCommerceCredentials({
        apiKeyId: "11111111-1111-4111-8111-111111111111",
        apiKeySecret: "A".repeat(80),
        webhookSecret: "hook0_secret_fixture",
        gatewayUrl: "https://api.commerce.coinbase.com",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertOkxOnchainCredentials({
        apiKey: "okx-api-key-fixture",
        secretKey: "okx-secret-key-fixture",
        passphrase: "okx-pass",
        payTo: "0x1111111111111111111111111111111111111111",
        network: "eip155:8453",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertBitpayCredentials({
        posToken: "short",
        notificationUrl: "http://insecure.example/ipn",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertOkxOnchainCredentials({
        apiKey: "okx-api-key-fixture",
        secretKey: "okx-secret-key-fixture",
        passphrase: "okx-pass",
        payTo: "0x1111111111111111111111111111111111111111",
        network: "eip155:196",
        resourceBaseUrl: "https://192.168.0.10",
      }),
    ).toThrow(EntitlementException);
    expect(() =>
      assertBitpayCredentials({
        posToken: "A".repeat(44),
        notificationUrl: "https://entitlement.example.com/ipn",
        merchantToken: "B".repeat(44),
        privateKey: "/tmp/bitpay.key",
      }),
    ).toThrow(EntitlementException);
    expect(
      assertBitpayCredentials({
        posToken: "A".repeat(44),
        notificationUrl: "https://entitlement.example.com/ipn",
        merchantToken: "B".repeat(44),
        privateKey: "11".repeat(32),
      }).privateKey,
    ).toHaveLength(64);
  });
});
