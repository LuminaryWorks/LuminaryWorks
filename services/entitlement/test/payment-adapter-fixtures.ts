import { generateKeyPairSync } from "node:crypto";
import { loadPrivateKey } from "../src/common/payment-credentials";
import { defaultCapabilities } from "../src/common/payment-providers";
import {
  canonicalAlipayParams,
  rsa2Sign,
  signedAlipayGatewayEnvelope,
} from "../src/modules/payments/alipay-protocol";
import type { ProviderConfig } from "../src/modules/payments/payment-adapter";

export function rsaPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
}

export function makeAlipayBundle() {
  const merchant = rsaPair();
  const platform = rsaPair();
  const config: ProviderConfig = {
    id: "cfg-alipay",
    providerId: "alipay_f2f",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["CN"],
    currencies: ["CNY"],
    priority: 10,
    capabilities: defaultCapabilities("alipay_f2f"),
    merchantId: "2088000000000001",
    credentials: {
      appId: "2021000000000001",
      merchantPrivateKey: merchant.privateKey,
      alipayPublicKey: platform.publicKey,
      notifyUrl: "https://entitlement.example.com/v1/payments/webhooks/alipay_f2f/cfg-alipay",
      sellerId: "2088000000000001",
    },
    metadata: {},
  };
  return { config, merchant, platform };
}

export function signAlipayNotify(
  params: Record<string, string>,
  alipayPrivateKeyPem: string,
): string {
  const canonical = canonicalAlipayParams(params, new Set(["sign", "sign_type"]));
  return rsa2Sign(canonical, loadPrivateKey(alipayPrivateKeyPem));
}

export function alipayNotifyBody(
  params: Record<string, string>,
  alipayPrivateKeyPem: string,
): Buffer {
  const sign = signAlipayNotify(params, alipayPrivateKeyPem);
  const encoded = new URLSearchParams({ ...params, sign_type: "RSA2", sign });
  return Buffer.from(encoded.toString());
}

export function signedGatewayJson(
  method: string,
  payload: Record<string, unknown>,
  alipayPrivateKeyPem: string,
): string {
  const key = `${method.replaceAll(".", "_")}_response`;
  return signedAlipayGatewayEnvelope(key, payload, alipayPrivateKeyPem);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function paypalConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "cfg-paypal",
    providerId: "paypal",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["GLOBAL"],
    currencies: ["USD"],
    priority: 20,
    capabilities: defaultCapabilities("paypal"),
    merchantId: "paypal-merchant",
    credentials: {
      clientId: "client_id_paypal_xx",
      clientSecret: "client_secret_paypal_yy",
      webhookId: "WH-12345678ABCDEFGH",
      returnUrl: "https://app.example.com/billing/return",
      cancelUrl: "https://app.example.com/billing/cancel",
    },
    metadata: {},
    ...overrides,
  };
}

export function makeWechatBundle() {
  const merchant = rsaPair();
  const platform = rsaPair();
  const apiV3Key = "0123456789abcdef0123456789abcdef";
  const config: ProviderConfig = {
    id: "cfg-wechat",
    providerId: "wechat_pay_v3",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["CN"],
    currencies: ["CNY"],
    priority: 10,
    capabilities: defaultCapabilities("wechat_pay_v3"),
    merchantId: "1900000001",
    credentials: {
      mchid: "1900000001",
      appid: "wx1234567890abcdef",
      merchantSerial: "1DDE7A5B5A5A5A5A",
      merchantPrivateKey: merchant.privateKey,
      apiV3Key,
      notifyUrl: "https://entitlement.example.com/v1/payments/webhooks/wechat_pay_v3/cfg-wechat",
      wechatpayPublicKey: platform.publicKey,
      wechatpayPublicKeyId: "PUB_KEY_ID_TEST001",
      platformCertPemPrevious: platform.publicKey,
      platformCertSerialPrevious: "AAAABBBBCCCCDDDD",
    },
    metadata: {},
  };
  return { config, merchant, platform, apiV3Key };
}

export function makeUnionpayBundle() {
  const merchant = rsaPair();
  const platform = rsaPair();
  const config: ProviderConfig = {
    id: "cfg-unionpay",
    providerId: "unionpay_quickpass",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["CN"],
    currencies: ["CNY"],
    priority: 10,
    capabilities: defaultCapabilities("unionpay_quickpass"),
    merchantId: "777290058110097",
    credentials: {
      merId: "777290058110097",
      certId: "68759663125",
      merchantPrivateKey: merchant.privateKey,
      unionpayPublicKey: platform.publicKey,
      frontUrl: "https://app.example.com/billing/unionpay/return",
      backUrl:
        "https://entitlement.example.com/v1/payments/webhooks/unionpay_quickpass/cfg-unionpay",
      checkoutMode: "hosted",
    },
    metadata: {},
  };
  return { config, merchant, platform };
}

export function stripeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "cfg-stripe",
    providerId: "stripe_checkout",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["GLOBAL"],
    currencies: ["USD"],
    priority: 20,
    capabilities: defaultCapabilities("stripe_checkout"),
    merchantId: "acct_test",
    credentials: {
      secretKey: "sk_test_51FixtureKeyForUnitTestsOnly",
      webhookSecret: "whsec_fixturesecretkeyvalue",
      successUrl: "https://app.example.com/billing/return",
      cancelUrl: "https://app.example.com/billing/cancel",
    },
    metadata: {},
    ...overrides,
  };
}

export function coinbaseConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "cfg-coinbase",
    providerId: "coinbase_commerce",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["GLOBAL"],
    currencies: ["USDC"],
    priority: 30,
    capabilities: defaultCapabilities("coinbase_commerce"),
    merchantId: "cb-merchant",
    credentials: {
      apiKeyId: "11111111-1111-4111-8111-111111111111",
      apiKeySecret: "A".repeat(80) + "==",
      webhookSecret: "hook0_secret_fixture_value",
      successRedirectUrl: "https://app.example.com/billing/return",
      failRedirectUrl: "https://app.example.com/billing/fail",
    },
    metadata: {},
    ...overrides,
  };
}

export function okxConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "cfg-okx",
    providerId: "okx_onchain",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["GLOBAL"],
    currencies: ["USD"],
    priority: 40,
    capabilities: defaultCapabilities("okx_onchain"),
    merchantId: "0x1111111111111111111111111111111111111111",
    credentials: {
      apiKey: "okx-api-key-fixture",
      secretKey: "okx-secret-key-fixture",
      passphrase: "okx-pass",
      payTo: "0x1111111111111111111111111111111111111111",
      network: "eip155:196",
      resourceBaseUrl: "https://entitlement.example.com",
    },
    metadata: {},
    ...overrides,
  };
}

export function bitpayConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "cfg-bitpay",
    providerId: "bitpay",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["GLOBAL"],
    currencies: ["USD"],
    priority: 50,
    capabilities: defaultCapabilities("bitpay"),
    merchantId: "bitpay-merchant",
    credentials: {
      posToken: "A".repeat(44),
      notificationUrl: "https://entitlement.example.com/v1/payments/webhooks/bitpay/cfg-bitpay",
      redirectUrl: "https://app.example.com/billing/return",
    },
    metadata: {},
    ...overrides,
  };
}
