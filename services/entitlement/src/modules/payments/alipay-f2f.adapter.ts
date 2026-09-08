import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  assertAlipayF2fCredentials,
  loadPrivateKey,
  loadPublicKey,
} from "../../common/payment-credentials";
import { redactPaymentSecrets } from "../../common/payment-crypto";
import { EntitlementException } from "../../common/errors";
import { defaultCapabilities } from "../../common/payment-providers";
import {
  ALIPAY_CHARSET,
  ALIPAY_FORMAT,
  ALIPAY_SIGN_TYPE,
  ALIPAY_VERSION,
  alipaySuccess,
  formatAlipayTimestamp,
  mapAlipayTradeStatus,
  minorFromYuan,
  parseAlipayNotifyBody,
  signAlipayRequest,
  verifyAlipayGatewayResponse,
  verifyAlipayNotify,
  yuanFromMinor,
} from "./alipay-protocol";
import type {
  CheckoutSession,
  CompleteCheckoutInput,
  CreateCheckoutInput,
  HealthCheckOptions,
  HealthStatus,
  PaymentAdapter,
  PaymentQueryResult,
  ProviderConfig,
  RefundInput,
  RefundResult,
  VerifiedWebhook,
} from "./payment-adapter";
import { alipayAllowedHosts, officialAlipayGateway, paymentFetch } from "./payment-http";
import {
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";

const PRECREATE = "alipay.trade.precreate";
const QUERY = "alipay.trade.query";
const REFUND = "alipay.trade.refund";

@Injectable()
export class AlipayF2fPaymentAdapter implements PaymentAdapter {
  readonly provider = "alipay_f2f" as const;

  constructor(
    @Optional() @Inject(PAYMENT_FETCH) private readonly fetchImpl?: PaymentFetch,
    @Optional() @Inject(PAYMENT_CLOCK) private readonly clock?: PaymentClock,
  ) {}

  private fetchFn(): PaymentFetch {
    return this.fetchImpl ?? defaultPaymentFetch();
  }

  private now(): Date {
    return (this.clock ?? defaultPaymentClock).now();
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const creds = assertAlipayF2fCredentials(input.config.credentials);
    const totalAmount = yuanFromMinor(input.amountCents, input.currency);
    const biz = {
      out_trade_no: input.attemptId,
      total_amount: totalAmount,
      subject: `order ${input.orderId}`,
      timeout_express: "15m",
      passback_params: input.orderId,
    };
    const payload = await this.gateway(input.config, creds, PRECREATE, biz);
    const qr = stringField(payload, "qr_code");
    if (!alipaySuccess(stringField(payload, "code")) || !qr) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        alipayErrorMessage(payload, "Alipay precreate failed"),
      );
    }
    return {
      provider: this.provider,
      providerRef: input.attemptId,
      status: "pending",
      checkoutUrl: null,
      qrPayload: qr,
      action: { type: "qr", attemptId: input.attemptId },
    };
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    _headers: Record<string, string>,
    config: ProviderConfig,
  ): Promise<VerifiedWebhook> {
    const creds = assertAlipayF2fCredentials(config.credentials);
    const params = parseAlipayNotifyBody(rawBody);
    if ((params.sign_type ?? ALIPAY_SIGN_TYPE).toUpperCase() !== "RSA2") {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "Alipay notify sign_type must be RSA2",
      );
    }
    if (!verifyAlipayNotify(params, creds.alipayPublicKey)) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "Alipay RSA2 notify signature mismatch",
      );
    }
    if (params.app_id && params.app_id !== creds.appId) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "Alipay notify app_id does not match config",
      );
    }
    if (creds.sellerId && params.seller_id && params.seller_id !== creds.sellerId) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "Alipay seller_id does not match config",
      );
    }
    const tradeStatus = params.trade_status ?? "";
    const mapped = mapAlipayTradeStatus(tradeStatus);
    const amountCents = params.total_amount ? minorFromYuan(params.total_amount, "CNY") : 0;
    const orderId = params.passback_params || "";
    const attemptId = params.out_trade_no || "";
    const eventId = params.notify_id || params.trade_no;
    if (!eventId) {
      throw new EntitlementException("PAYMENT_WEBHOOK_INVALID", "Alipay notify_id is required");
    }
    const status =
      mapped === "succeeded" ? "succeeded" : mapped === "pending" ? "pending" : "failed";
    return {
      eventId,
      orderId,
      attemptId,
      providerRef: params.trade_no || attemptId,
      status,
      amountCents,
      currency: "CNY",
      merchantId: params.seller_id || creds.sellerId || creds.appId,
      payload: redactPaymentSecrets({ ...params, sign: "[redacted]" }),
      ack: { status: 200, body: "success", contentType: "text/plain; charset=utf-8" },
    };
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const creds = assertAlipayF2fCredentials(config.credentials);
    const looksLikeTradeNo = /^[0-9]{16,64}$/.test(providerRef);
    const biz = looksLikeTradeNo ? { trade_no: providerRef } : { out_trade_no: providerRef };
    const payload = await this.gateway(config, creds, QUERY, biz);
    const code = stringField(payload, "code");
    if (code === "40004") {
      return {
        providerRef,
        status: "pending",
        amountCents: 0,
        currency: "CNY",
        merchantId: config.merchantId ?? creds.appId,
      };
    }
    if (!alipaySuccess(code)) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        alipayErrorMessage(payload, "Alipay query failed"),
      );
    }
    const tradeStatus = stringField(payload, "trade_status");
    const mapped = mapAlipayTradeStatus(tradeStatus);
    const amount = stringField(payload, "total_amount");
    return {
      providerRef: stringField(payload, "trade_no") || providerRef,
      orderId: stringField(payload, "passback_params") || null,
      attemptId: stringField(payload, "out_trade_no") || null,
      status: mapped === "canceled" ? "canceled" : mapped,
      amountCents: amount ? minorFromYuan(amount, "CNY") : 0,
      currency: "CNY",
      merchantId: stringField(payload, "seller_id") || config.merchantId || creds.appId,
    };
  }

  async completeCheckout(input: CompleteCheckoutInput): Promise<PaymentQueryResult> {
    return this.queryPayment(input.providerRef, input.config);
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertAlipayF2fCredentials(config.credentials);
    const payload = await this.gateway(config, creds, REFUND, {
      out_trade_no: input.attemptId,
      trade_no: looksLikeAlipayTradeNo(input.providerRef) ? input.providerRef : undefined,
      refund_amount: yuanFromMinor(input.amountCents, input.currency),
      out_request_no: input.idempotencyKey,
      refund_reason: input.reason ?? "refund",
    });
    if (!alipaySuccess(stringField(payload, "code"))) {
      return {
        providerRef: input.idempotencyKey,
        status: "failed",
        amountCents: input.amountCents,
      };
    }
    return {
      providerRef: stringField(payload, "trade_no") || input.idempotencyKey,
      status: "succeeded",
      amountCents: input.amountCents,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      gateway: officialAlipayGateway(config.environment),
      merchantApproved: false,
      enabledOpsControlled: true,
    };
    try {
      const creds = assertAlipayF2fCredentials(config.credentials);
      loadPrivateKey(creds.merchantPrivateKey);
      loadPublicKey(creds.alipayPublicKey);
      const signed = signAlipayRequest(
        {
          app_id: creds.appId,
          method: "alipay.system.oauth.token",
          sign_type: ALIPAY_SIGN_TYPE,
          charset: ALIPAY_CHARSET,
          timestamp: formatAlipayTimestamp(this.now()),
        },
        creds.merchantPrivateKey,
      );
      diagnostics.appIdLastFour = creds.appId.slice(-4);
      diagnostics.notifyHost = new URL(creds.notifyUrl).host;
      diagnostics.publicKeyFingerprint = createHash("sha256")
        .update(creds.alipayPublicKey)
        .digest("hex")
        .slice(0, 16);
      diagnostics.localSignOk = signed.length > 0;
      if (opts?.remote) {
        try {
          await this.gateway(config, creds, QUERY, { out_trade_no: "healthcheck_probe" });
          diagnostics.remoteQuery = "ok";
        } catch (err) {
          const message = err instanceof Error ? err.message : "remote_failed";
          if (message.toLowerCase().includes("signature")) {
            issues.push("remote_signature_rejected");
          } else {
            diagnostics.remoteQuery = "structured_error";
          }
        }
      }
    } catch (err) {
      issues.push(err instanceof Error ? err.message : "credential_invalid");
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("alipay_f2f"),
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private async gateway(
    config: ProviderConfig,
    creds: ReturnType<typeof assertAlipayF2fCredentials>,
    method: string,
    biz: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(biz)) {
      if (value !== undefined && value !== null && value !== "") cleaned[key] = value;
    }
    const unsigned: Record<string, string> = {
      app_id: creds.appId,
      method,
      format: ALIPAY_FORMAT,
      charset: ALIPAY_CHARSET,
      sign_type: ALIPAY_SIGN_TYPE,
      timestamp: formatAlipayTimestamp(this.now()),
      version: ALIPAY_VERSION,
      notify_url: creds.notifyUrl,
      biz_content: JSON.stringify(cleaned),
    };
    unsigned.sign = signAlipayRequest(unsigned, creds.merchantPrivateKey);
    const gateway = officialAlipayGateway(config.environment);
    const response = await paymentFetch(
      this.fetchFn(),
      gateway,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
        body: new URLSearchParams(unsigned).toString(),
      },
      { allowedHosts: alipayAllowedHosts() },
    );
    const text = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Alipay gateway returned a non-JSON body",
      );
    }
    const responseKey = `${method.replaceAll(".", "_")}_response`;
    const sign = typeof parsed.sign === "string" ? parsed.sign : "";
    if (!sign || !verifyAlipayGatewayResponse(text, responseKey, sign, creds.alipayPublicKey)) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Alipay gateway response signature is invalid",
      );
    }
    const node = parsed[responseKey];
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Alipay gateway response node is missing",
      );
    }
    return node as Record<string, unknown>;
  }
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function alipayErrorMessage(payload: Record<string, unknown>, fallback: string): string {
  const sub = stringField(payload, "sub_msg") || stringField(payload, "msg");
  return sub || fallback;
}

function looksLikeAlipayTradeNo(value: string): boolean {
  return /^[0-9]{16,64}$/.test(value);
}
