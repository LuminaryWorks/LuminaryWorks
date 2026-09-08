import { createPrivateKey, createPublicKey } from "node:crypto";
import { EntitlementException } from "./errors";
import { assertGenericCredentials, type GenericCredentials } from "./payment-crypto";
import type { ProviderId } from "./payment-providers";

export interface AlipayF2fCredentials {
  appId: string;
  merchantPrivateKey: string;
  alipayPublicKey: string;
  notifyUrl: string;
  sellerId?: string;
}

export interface PaypalCredentials {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  returnUrl?: string;
  cancelUrl?: string;
  paypalPlanId?: string;
  paypalProductId?: string;
  subscriptionWebhookEnabled?: string;
}

export interface WechatPayV3Credentials {
  mchid: string;
  appid: string;
  merchantSerial: string;
  merchantPrivateKey: string;
  apiV3Key: string;
  notifyUrl: string;
  apiRegion: "cn" | "hk";
  platformCertPem?: string;
  platformCertSerial?: string;
  platformCertPemPrevious?: string;
  platformCertSerialPrevious?: string;
  wechatpayPublicKey?: string;
  wechatpayPublicKeyId?: string;
  platformCertificatesJson?: string;
}

export interface UnionpayQuickpassCredentials {
  merId: string;
  certId: string;
  merchantPrivateKey: string;
  unionpayPublicKey: string;
  frontUrl: string;
  backUrl: string;
  checkoutMode: "hosted" | "qr";
  protocolVersion: string;
  signMethod: string;
  bizType: string;
  txnSubType: string;
  channelType: string;
}

export interface StripeCheckoutCredentials {
  secretKey: string;
  webhookSecret: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CoinbaseCommerceCredentials {
  apiKeyId: string;
  apiKeySecret: string;
  webhookSecret: string;
  successRedirectUrl?: string;
  failRedirectUrl?: string;
}

export interface OkxOnchainCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  payTo: string;
  network: string;
  asset?: string;
  assetName?: string;
  assetVersion?: string;
  assetDecimals?: string;
  /** Public Entitlement HTTPS origin used to build /v1/orders/:id/complete. */
  resourceBaseUrl?: string;
}

export interface BitpayCredentials {
  posToken: string;
  notificationUrl: string;
  merchantToken?: string;
  /** secp256k1 hex private key for merchant-facade request signing. */
  privateKey?: string;
  /** Optional compressed public identity hex; SDK derives identity from privateKey. */
  identity?: string;
  ipnHmacSecret?: string;
  redirectUrl?: string;
}

export function assertProviderCredentials(
  providerId: ProviderId,
  raw: unknown,
): GenericCredentials {
  if (providerId === "manual" || providerId === "contract") {
    if (raw == null) return {};
    return assertGenericCredentials(raw);
  }
  const generic = assertGenericCredentials(raw);
  if (providerId === "alipay_f2f") {
    assertAlipayF2fCredentials(generic);
    return generic;
  }
  if (providerId === "paypal") {
    assertPaypalCredentials(generic);
    return generic;
  }
  if (providerId === "wechat_pay_v3") {
    assertWechatPayV3Credentials(generic);
    return generic;
  }
  if (providerId === "unionpay_quickpass") {
    assertUnionpayQuickpassCredentials(generic);
    return generic;
  }
  if (providerId === "stripe_checkout") {
    assertStripeCheckoutCredentials(generic);
    return generic;
  }
  if (providerId === "coinbase_commerce") {
    assertCoinbaseCommerceCredentials(generic);
    return generic;
  }
  if (providerId === "okx_onchain") {
    assertOkxOnchainCredentials(generic);
    return generic;
  }
  if (providerId === "bitpay") {
    assertBitpayCredentials(generic);
    return generic;
  }
  return generic;
}

export function assertAlipayF2fCredentials(credentials: GenericCredentials): AlipayF2fCredentials {
  const appId = required(credentials, "appId");
  if (!/^\d{8,32}$/.test(appId)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "alipay_f2f appId must be an 8–32 digit application id",
    );
  }
  const merchantPrivateKey = required(credentials, "merchantPrivateKey");
  const alipayPublicKey = required(credentials, "alipayPublicKey");
  loadPrivateKey(merchantPrivateKey);
  loadPublicKey(alipayPublicKey);
  assertKeysNotSwapped(merchantPrivateKey, alipayPublicKey);
  const notifyUrl = required(credentials, "notifyUrl");
  assertHttpsUrl(notifyUrl, "notifyUrl");
  if (credentials.gatewayUrl) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "alipay_f2f gatewayUrl is not accepted; official sandbox/live endpoints are selected from environment",
    );
  }
  const sellerId = optional(credentials, "sellerId");
  if (sellerId && !/^[A-Za-z0-9]{8,32}$/.test(sellerId)) {
    throw new EntitlementException("VALIDATION_ERROR", "alipay_f2f sellerId is malformed");
  }
  return {
    appId,
    merchantPrivateKey,
    alipayPublicKey,
    notifyUrl,
    sellerId,
  };
}

export function assertPaypalCredentials(credentials: GenericCredentials): PaypalCredentials {
  const clientId = required(credentials, "clientId");
  const clientSecret = required(credentials, "clientSecret");
  const webhookId = required(credentials, "webhookId");
  if (clientId.length < 8 || clientSecret.length < 8) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "paypal clientId and clientSecret are too short",
    );
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(webhookId)) {
    throw new EntitlementException("VALIDATION_ERROR", "paypal webhookId is malformed");
  }
  if (credentials.apiBase || credentials.baseUrl || credentials.gatewayUrl) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "paypal custom API base URLs are not accepted; official sandbox/live hosts are selected from environment",
    );
  }
  const returnUrl = optional(credentials, "returnUrl");
  const cancelUrl = optional(credentials, "cancelUrl");
  if (returnUrl) assertHttpsUrl(returnUrl, "returnUrl");
  if (cancelUrl) assertHttpsUrl(cancelUrl, "cancelUrl");
  return {
    clientId,
    clientSecret,
    webhookId,
    returnUrl,
    cancelUrl,
    paypalPlanId: optional(credentials, "paypalPlanId"),
    paypalProductId: optional(credentials, "paypalProductId"),
    subscriptionWebhookEnabled: optional(credentials, "subscriptionWebhookEnabled"),
  };
}

export function assertWechatPayV3Credentials(
  credentials: GenericCredentials,
): WechatPayV3Credentials {
  rejectCustomGateway(credentials, "wechat_pay_v3");
  const mchid = required(credentials, "mchid");
  if (!/^\d{8,12}$/.test(mchid)) {
    throw new EntitlementException("VALIDATION_ERROR", "wechat_pay_v3 mchid must be 8–12 digits");
  }
  const appid = required(credentials, "appid");
  if (!/^[A-Za-z0-9]{10,32}$/.test(appid)) {
    throw new EntitlementException("VALIDATION_ERROR", "wechat_pay_v3 appid is malformed");
  }
  const merchantSerial = required(credentials, "merchantSerial");
  if (!/^[A-Fa-f0-9]{8,64}$/.test(merchantSerial)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "wechat_pay_v3 merchantSerial must be a certificate serial",
    );
  }
  const merchantPrivateKey = required(credentials, "merchantPrivateKey");
  loadPrivateKey(merchantPrivateKey);
  const apiV3Key = required(credentials, "apiV3Key");
  if (apiV3Key.length !== 32) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "wechat_pay_v3 apiV3Key must be the 32-character APIv3 key",
    );
  }
  const notifyUrl = required(credentials, "notifyUrl");
  assertHttpsUrl(notifyUrl, "notifyUrl");
  const regionRaw = optional(credentials, "apiRegion") ?? "cn";
  if (regionRaw !== "cn" && regionRaw !== "hk") {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "wechat_pay_v3 apiRegion must be cn or hk (official hosts only)",
    );
  }
  const platformCertPem = optional(credentials, "platformCertPem");
  const platformCertSerial = optional(credentials, "platformCertSerial");
  const platformCertPemPrevious = optional(credentials, "platformCertPemPrevious");
  const platformCertSerialPrevious = optional(credentials, "platformCertSerialPrevious");
  const wechatpayPublicKey = optional(credentials, "wechatpayPublicKey");
  const wechatpayPublicKeyId = optional(credentials, "wechatpayPublicKeyId");
  const platformCertificatesJson = optional(credentials, "platformCertificatesJson");
  if (platformCertPem) loadPublicKey(platformCertPem);
  if (wechatpayPublicKey) loadPublicKey(wechatpayPublicKey);
  if (platformCertPemPrevious) loadPublicKey(platformCertPemPrevious);
  if (platformCertificatesJson) parsePlatformCertificatesJson(platformCertificatesJson);
  const hasRing =
    Boolean(platformCertPem && platformCertSerial) ||
    Boolean(wechatpayPublicKey && wechatpayPublicKeyId) ||
    Boolean(platformCertificatesJson);
  if (!hasRing) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "wechat_pay_v3 requires a WeChat platform certificate or public key for webhook verification",
    );
  }
  if (platformCertPem && !platformCertSerial) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "wechat_pay_v3 platformCertSerial is required with platformCertPem",
    );
  }
  if (wechatpayPublicKey && !wechatpayPublicKeyId) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "wechat_pay_v3 wechatpayPublicKeyId is required with wechatpayPublicKey",
    );
  }
  return {
    mchid,
    appid,
    merchantSerial,
    merchantPrivateKey,
    apiV3Key,
    notifyUrl,
    apiRegion: regionRaw,
    platformCertPem,
    platformCertSerial,
    platformCertPemPrevious,
    platformCertSerialPrevious,
    wechatpayPublicKey,
    wechatpayPublicKeyId,
    platformCertificatesJson,
  };
}

export function assertUnionpayQuickpassCredentials(
  credentials: GenericCredentials,
): UnionpayQuickpassCredentials {
  rejectCustomGateway(credentials, "unionpay_quickpass");
  const merId = required(credentials, "merId");
  if (!/^\d{8,15}$/.test(merId)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "unionpay_quickpass merId must be the 8–15 digit merchant code",
    );
  }
  const certId = required(credentials, "certId");
  if (!/^\d{8,40}$/.test(certId)) {
    throw new EntitlementException("VALIDATION_ERROR", "unionpay_quickpass certId is malformed");
  }
  const merchantPrivateKey = required(credentials, "merchantPrivateKey");
  const unionpayPublicKey = required(credentials, "unionpayPublicKey");
  loadPrivateKey(merchantPrivateKey);
  loadPublicKey(unionpayPublicKey);
  assertKeysNotSwapped(merchantPrivateKey, unionpayPublicKey);
  const frontUrl = required(credentials, "frontUrl");
  const backUrl = required(credentials, "backUrl");
  assertHttpsUrl(frontUrl, "frontUrl");
  assertHttpsUrl(backUrl, "backUrl");
  const checkoutMode = required(credentials, "checkoutMode");
  if (checkoutMode !== "hosted" && checkoutMode !== "qr") {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "unionpay_quickpass checkoutMode must be hosted or qr; other acquirer products are not implemented",
    );
  }
  const protocolVersion = optional(credentials, "protocolVersion") ?? "5.1.0";
  if (protocolVersion !== "5.1.0") {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "unionpay_quickpass only implements official gateway protocol 5.1.0",
    );
  }
  const signMethod = optional(credentials, "signMethod") ?? "01";
  if (signMethod !== "01") {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "unionpay_quickpass only implements RSA signMethod 01; SM2/other methods are not faked",
    );
  }
  const bizType = optional(credentials, "bizType") ?? (checkoutMode === "qr" ? "000000" : "000201");
  const txnSubType = optional(credentials, "txnSubType") ?? (checkoutMode === "qr" ? "07" : "01");
  const channelType = optional(credentials, "channelType") ?? (checkoutMode === "qr" ? "08" : "07");
  if (checkoutMode === "hosted" && (txnSubType !== "01" || bizType !== "000201")) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "unionpay_quickpass hosted mode requires bizType 000201 and txnSubType 01",
    );
  }
  if (checkoutMode === "qr" && (txnSubType !== "07" || bizType !== "000000")) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "unionpay_quickpass qr mode requires bizType 000000 and txnSubType 07",
    );
  }
  if (channelType !== "07" && channelType !== "08") {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "unionpay_quickpass channelType must be 07 (internet) or 08 (mobile)",
    );
  }
  return {
    merId,
    certId,
    merchantPrivateKey,
    unionpayPublicKey,
    frontUrl,
    backUrl,
    checkoutMode,
    protocolVersion,
    signMethod,
    bizType,
    txnSubType,
    channelType,
  };
}

export function assertStripeCheckoutCredentials(
  credentials: GenericCredentials,
): StripeCheckoutCredentials {
  rejectCustomGateway(credentials, "stripe_checkout");
  const secretKey = required(credentials, "secretKey");
  if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "stripe_checkout secretKey must be an official sk_test_ or sk_live_ key",
    );
  }
  const webhookSecret = required(credentials, "webhookSecret");
  if (!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret) || webhookSecret.length < 16) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "stripe_checkout webhookSecret must be an official whsec_ signing secret",
    );
  }
  const successUrl = optional(credentials, "successUrl");
  const cancelUrl = optional(credentials, "cancelUrl");
  if (successUrl) assertHttpsUrl(successUrl, "successUrl");
  if (cancelUrl) assertHttpsUrl(cancelUrl, "cancelUrl");
  return { secretKey, webhookSecret, successUrl, cancelUrl };
}

export function assertCoinbaseCommerceCredentials(
  credentials: GenericCredentials,
): CoinbaseCommerceCredentials {
  rejectCustomGateway(credentials, "coinbase_commerce");
  if (credentials.commerceApiKey || credentials.sharedSecret) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "coinbase_commerce requires Coinbase Business CDP API keys; legacy Commerce Charge credentials are not accepted",
    );
  }
  const apiKeyId = required(credentials, "apiKeyId");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(apiKeyId) &&
    !/^organizations\/[A-Za-z0-9_-]+\/apiKeys\/[0-9a-f-]{36}$/i.test(apiKeyId)
  ) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "coinbase_commerce apiKeyId must be a CDP API key UUID",
    );
  }
  const apiKeySecret = required(credentials, "apiKeySecret");
  if (apiKeySecret.length < 40) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "coinbase_commerce apiKeySecret is too short for a CDP EC/Ed25519 secret",
    );
  }
  if (/BEGIN PUBLIC KEY/.test(apiKeySecret) && !/BEGIN .*PRIVATE KEY/.test(apiKeySecret)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "coinbase_commerce apiKeySecret looks like a public key",
    );
  }
  const webhookSecret = required(credentials, "webhookSecret");
  if (webhookSecret.length < 16) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "coinbase_commerce webhookSecret is required for X-Hook0-Signature verification",
    );
  }
  const successRedirectUrl = optional(credentials, "successRedirectUrl");
  const failRedirectUrl = optional(credentials, "failRedirectUrl");
  if (successRedirectUrl) assertHttpsUrl(successRedirectUrl, "successRedirectUrl");
  if (failRedirectUrl) assertHttpsUrl(failRedirectUrl, "failRedirectUrl");
  return { apiKeyId, apiKeySecret, webhookSecret, successRedirectUrl, failRedirectUrl };
}

export function assertOkxOnchainCredentials(
  credentials: GenericCredentials,
): OkxOnchainCredentials {
  rejectCustomGateway(credentials, "okx_onchain");
  const apiKey = required(credentials, "apiKey");
  const secretKey = required(credentials, "secretKey");
  const passphrase = required(credentials, "passphrase");
  if (apiKey.length < 8 || secretKey.length < 8 || passphrase.length < 4) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "okx_onchain apiKey, secretKey, and passphrase are required OKX facilitator credentials",
    );
  }
  const payTo = required(credentials, "payTo");
  if (!/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
    throw new EntitlementException("VALIDATION_ERROR", "okx_onchain payTo must be an EVM address");
  }
  const network = required(credentials, "network");
  if (!/^eip155:\d+$/.test(network)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "okx_onchain network must be a CAIP-2 eip155 chain id",
    );
  }
  const asset = optional(credentials, "asset");
  if (asset && !/^0x[a-fA-F0-9]{40}$/.test(asset)) {
    throw new EntitlementException("VALIDATION_ERROR", "okx_onchain asset must be a token address");
  }
  const knownDefault = network === "eip155:196" || network === "eip155:1952";
  if (!asset && !knownDefault) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "okx_onchain asset is required unless the official ExactEvmScheme default token covers this network",
    );
  }
  const resourceBaseUrl = optional(credentials, "resourceBaseUrl");
  if (resourceBaseUrl) assertPublicHttpsUrl(resourceBaseUrl, "resourceBaseUrl");
  return {
    apiKey,
    secretKey,
    passphrase,
    payTo,
    network,
    asset,
    assetName: optional(credentials, "assetName"),
    assetVersion: optional(credentials, "assetVersion"),
    assetDecimals: optional(credentials, "assetDecimals"),
    resourceBaseUrl,
  };
}

export function assertBitpayCredentials(credentials: GenericCredentials): BitpayCredentials {
  rejectCustomGateway(credentials, "bitpay");
  const posToken = required(credentials, credentials.posToken ? "posToken" : "token");
  if (!/^[A-Za-z0-9]{20,128}$/.test(posToken)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "bitpay posToken must be the official POS/merchant token",
    );
  }
  const notificationUrl = required(credentials, "notificationUrl");
  assertHttpsUrl(notificationUrl, "notificationUrl");
  const merchantToken = optional(credentials, "merchantToken");
  if (merchantToken && !/^[A-Za-z0-9]{20,128}$/.test(merchantToken)) {
    throw new EntitlementException("VALIDATION_ERROR", "bitpay merchantToken is malformed");
  }
  const privateKey = optional(credentials, "privateKey");
  if (privateKey && !isBitpayHexPrivateKey(privateKey)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "bitpay privateKey must be a 32-byte secp256k1 hex key; file paths are not accepted",
    );
  }
  const identity = optional(credentials, "identity");
  if (identity && !/^(0x)?[0-9a-fA-F]{66,130}$/.test(identity)) {
    throw new EntitlementException("VALIDATION_ERROR", "bitpay identity must be a hex public key");
  }
  const ipnHmacSecret = optional(credentials, "ipnHmacSecret");
  const redirectUrl = optional(credentials, "redirectUrl");
  if (redirectUrl) assertHttpsUrl(redirectUrl, "redirectUrl");
  return {
    posToken,
    notificationUrl,
    merchantToken,
    privateKey,
    identity,
    ipnHmacSecret,
    redirectUrl,
  };
}

function rejectCustomGateway(credentials: GenericCredentials, provider: string): void {
  if (credentials.apiBase || credentials.baseUrl || credentials.gatewayUrl) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      `${provider} custom API base URLs are not accepted; official sandbox/live hosts are selected from environment`,
    );
  }
}

export function parsePlatformCertificatesJson(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "wechat_pay_v3 platformCertificatesJson must be a JSON object of serial to PEM",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "wechat_pay_v3 platformCertificatesJson must be a JSON object of serial to PEM",
    );
  }
  const out: Record<string, string> = {};
  for (const [serial, pem] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof pem !== "string" || !serial.trim()) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "wechat_pay_v3 platformCertificatesJson values must be PEM strings",
      );
    }
    loadPublicKey(pem);
    out[serial] = pem;
  }
  return out;
}

export function loadPrivateKey(raw: string) {
  const attempts = pemCandidates(raw, "private");
  let last: unknown;
  for (const pem of attempts) {
    try {
      return createPrivateKey(pem);
    } catch (err) {
      last = err;
    }
  }
  throw new EntitlementException(
    "VALIDATION_ERROR",
    "Merchant private key could not be parsed as RSA",
    { details: { reason: last instanceof Error ? last.name : "parse_failed" } },
  );
}

export function loadPublicKey(raw: string) {
  const attempts = pemCandidates(raw, "public");
  let last: unknown;
  for (const pem of attempts) {
    try {
      return createPublicKey(pem);
    } catch (err) {
      last = err;
    }
  }
  throw new EntitlementException(
    "VALIDATION_ERROR",
    "Alipay or provider public key could not be parsed as RSA",
    { details: { reason: last instanceof Error ? last.name : "parse_failed" } },
  );
}

function assertKeysNotSwapped(privatePem: string, publicPem: string): void {
  if (/BEGIN (RSA )?PUBLIC KEY/.test(privatePem) && !/BEGIN .*PRIVATE KEY/.test(privatePem)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "merchantPrivateKey looks like a public key; check PEM pairing",
    );
  }
  if (/BEGIN .*PRIVATE KEY/.test(publicPem)) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "alipayPublicKey looks like a private key; check PEM pairing",
    );
  }
  try {
    createPrivateKey(publicPem);
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "alipayPublicKey looks like a private key; check PEM pairing",
    );
  } catch (err) {
    if (err instanceof EntitlementException) throw err;
  }
}

function pemCandidates(raw: string, kind: "private" | "public"): string[] {
  const trimmed = raw.trim().replace(/\r/g, "");
  const out = [trimmed];
  if (trimmed.includes("BEGIN")) return out;
  const body = chunkBase64(trimmed.replace(/\s+/g, ""));
  if (kind === "private") {
    out.push(`-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`);
    out.push(`-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`);
  } else {
    out.push(`-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`);
    out.push(`-----BEGIN RSA PUBLIC KEY-----\n${body}\n-----END RSA PUBLIC KEY-----`);
  }
  return out;
}

function chunkBase64(value: string): string {
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += 64) parts.push(value.slice(i, i + 64));
  return parts.join("\n");
}

function assertHttpsUrl(raw: string, field: string): URL {
  return assertPublicHttpsUrl(raw, field, { allowPrivateLan: true });
}

/**
 * Strict public HTTPS origin/base. Rejects localhost, loopback, link-local,
 * metadata, and RFC1918/ULA hosts. Used for buyer-visible callback URLs.
 */
export function assertPublicHttpsUrl(
  raw: string,
  field: string,
  opts?: { allowPrivateLan?: boolean },
): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new EntitlementException("VALIDATION_ERROR", `${field} is not a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new EntitlementException("VALIDATION_ERROR", `${field} must be an HTTPS URL`);
  }
  if (parsed.username || parsed.password) {
    throw new EntitlementException("VALIDATION_ERROR", `${field} must not include credentials`);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isBlockedPublicHost(host, opts?.allowPrivateLan === true)) {
    throw new EntitlementException("VALIDATION_ERROR", `${field} host is not allowed`);
  }
  return parsed;
}

export function resolveOkxResourceBaseUrl(
  credentials: OkxOnchainCredentials,
  metadata: Record<string, unknown> = {},
): string {
  const fromMeta =
    (typeof metadata.resourceBaseUrl === "string" ? metadata.resourceBaseUrl : "") ||
    (typeof metadata.entitlementPublicBaseUrl === "string"
      ? metadata.entitlementPublicBaseUrl
      : "");
  const raw = (credentials.resourceBaseUrl || fromMeta).trim();
  if (!raw) {
    throw new EntitlementException(
      "VALIDATION_ERROR",
      "okx_onchain requires HTTPS resourceBaseUrl or metadata.entitlementPublicBaseUrl",
    );
  }
  const parsed = assertPublicHttpsUrl(raw, "resourceBaseUrl");
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

export function okxCompleteResourceUrl(resourceBaseUrl: string, orderId: string): string {
  if (!orderId.trim()) {
    throw new EntitlementException("VALIDATION_ERROR", "okx_onchain orderId is required");
  }
  return `${resourceBaseUrl.replace(/\/+$/, "")}/v1/orders/${encodeURIComponent(orderId)}/complete`;
}

function isBlockedPublicHost(host: string, allowPrivateLan: boolean): boolean {
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "169.254.169.254"
  ) {
    return true;
  }
  if (isIpv4(host)) {
    const [a, b] = host.split(".").map((part) => Number(part));
    if (a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (!allowPrivateLan) {
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
    }
    return false;
  }
  if (host.includes(":")) {
    if (
      host === "::1" ||
      host.startsWith("fe80:") ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    ) {
      return true;
    }
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped?.[1]) return isBlockedPublicHost(mapped[1], allowPrivateLan);
  }
  return false;
}

function isIpv4(host: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
}

function isBitpayHexPrivateKey(raw: string): boolean {
  const hex = raw.replace(/^0x/i, "");
  if (/[/\\]/.test(raw) || raw.includes("..") || /\.json$/i.test(raw)) return false;
  return /^[0-9a-fA-F]{64}$/.test(hex);
}

function required(credentials: GenericCredentials, key: string): string {
  const value = credentials[key]?.trim() ?? "";
  if (!value) {
    throw new EntitlementException("VALIDATION_ERROR", `Missing required credential ${key}`);
  }
  return value;
}

function optional(credentials: GenericCredentials, key: string): string | undefined {
  const value = credentials[key]?.trim() ?? "";
  return value || undefined;
}
