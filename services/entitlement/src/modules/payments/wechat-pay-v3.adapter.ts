import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { assertWechatPayV3Credentials, loadPrivateKey } from "../../common/payment-credentials";
import { redactPaymentSecrets } from "../../common/payment-crypto";
import { EntitlementException } from "../../common/errors";
import { defaultCapabilities } from "../../common/payment-providers";
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
import { officialWechatBase, paymentFetchJson, wechatAllowedHosts } from "./payment-http";
import {
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";
import {
  assertFreshWechatTimestamp,
  decryptWechatResource,
  lookupWechatPlatformKey,
  mapWechatTradeState,
  signWechatRequest,
  verifyWechatSignature,
  wechatAttemptIdFromOutTradeNo,
  wechatAuthorization,
  wechatCnyAmount,
  wechatNotifyMessage,
  wechatOutTradeNo,
  wechatPlatformKeyRing,
  wechatSignMessage,
  WECHAT_AUTH_SCHEME,
} from "./wechat-pay-v3.protocol";

@Injectable()
export class WechatPayV3PaymentAdapter implements PaymentAdapter {
  readonly provider = "wechat_pay_v3" as const;

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
    const creds = assertWechatPayV3Credentials(input.config.credentials);
    const outTradeNo = wechatOutTradeNo(input.attemptId);
    const total = wechatCnyAmount(input.amountCents, input.currency);
    const created = requireObject(
      await this.api(input.config, creds, "POST", "/v3/pay/transactions/native", {
        appid: creds.appid,
        mchid: creds.mchid,
        description: `order ${input.orderId}`,
        out_trade_no: outTradeNo,
        attach: input.orderId,
        notify_url: creds.notifyUrl,
        amount: { total, currency: "CNY" },
      }),
      "WeChat native prepay returned an empty body",
    );
    const qr = stringField(created, "code_url");
    if (!qr) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "WeChat native prepay did not return code_url",
      );
    }
    return {
      provider: this.provider,
      providerRef: outTradeNo,
      status: "pending",
      checkoutUrl: null,
      qrPayload: qr,
      action: { type: "qr", attemptId: input.attemptId, outTradeNo },
    };
  }

  async completeCheckout(input: CompleteCheckoutInput): Promise<PaymentQueryResult> {
    return this.queryPayment(input.providerRef, input.config);
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Record<string, string>,
    config: ProviderConfig,
  ): Promise<VerifiedWebhook> {
    const creds = assertWechatPayV3Credentials(config.credentials);
    const timestamp = header(headers, "wechatpay-timestamp");
    const nonce = header(headers, "wechatpay-nonce");
    const signature = header(headers, "wechatpay-signature");
    const serial = header(headers, "wechatpay-serial");
    const sigType = header(headers, "wechatpay-signature-type");
    if (!timestamp || !nonce || !signature || !serial) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "WeChat notification is missing signature headers",
      );
    }
    if (sigType && sigType !== WECHAT_AUTH_SCHEME) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "WeChat notification signature type is not WECHATPAY2-SHA256-RSA2048",
      );
    }
    assertFreshWechatTimestamp(timestamp, this.now());
    const body = Buffer.from(rawBody).toString("utf8");
    const ring = wechatPlatformKeyRing(creds);
    const key = lookupWechatPlatformKey(ring, serial);
    if (!verifyWechatSignature(wechatNotifyMessage(timestamp, nonce, body), signature, key)) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "WeChat notification signature mismatch",
      );
    }
    let envelope: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad");
      envelope = parsed as Record<string, unknown>;
    } catch {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "WeChat notification JSON is invalid",
      );
    }
    const resource = asObject(envelope.resource);
    const decrypted = decryptWechatResource(
      {
        algorithm: stringField(resource, "algorithm"),
        ciphertext: stringField(resource, "ciphertext"),
        nonce: stringField(resource, "nonce"),
        associated_data: stringField(resource, "associated_data"),
      },
      creds.apiV3Key,
    );
    let trade: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(decrypted);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad");
      trade = parsed as Record<string, unknown>;
    } catch {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "WeChat decrypted resource is not JSON",
      );
    }
    const mchid = stringField(trade, "mchid") || stringField(trade, "mch_id");
    const appid = stringField(trade, "appid");
    if (mchid && mchid !== creds.mchid) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "WeChat mchid does not match config",
      );
    }
    if (appid && appid !== creds.appid) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "WeChat appid does not match config",
      );
    }
    const amount = asObject(trade.amount);
    const currency = (stringField(amount, "currency") || "CNY").toUpperCase();
    const total = Number(amount.total);
    if (currency !== "CNY") {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "WeChat notification currency must be CNY",
      );
    }
    if (!Number.isInteger(total) || total < 0) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "WeChat notification amount is invalid",
      );
    }
    const outTradeNo = stringField(trade, "out_trade_no");
    const tradeState = stringField(trade, "trade_state");
    const mapped = mapWechatTradeState(tradeState);
    const status = mapped === "canceled" ? "failed" : mapped === "ignored" ? "ignored" : mapped;
    const eventId =
      stringField(envelope, "id") || stringField(trade, "transaction_id") || outTradeNo;
    if (!eventId) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "WeChat notification id is required",
      );
    }
    return {
      eventId,
      orderId: stringField(trade, "attach"),
      attemptId: wechatAttemptIdFromOutTradeNo(outTradeNo),
      providerRef: stringField(trade, "transaction_id") || outTradeNo,
      status,
      amountCents: total,
      currency: "CNY",
      merchantId: mchid || creds.mchid,
      payload: redactPaymentSecrets({
        eventType: stringField(envelope, "event_type"),
        tradeState,
        outTradeNo,
      }),
      ack: {
        status: 200,
        body: { code: "SUCCESS", message: "成功" },
        contentType: "application/json; charset=utf-8",
      },
    };
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const creds = assertWechatPayV3Credentials(config.credentials);
    const looksLikeTxn = /^[0-9]{10,64}$/.test(providerRef);
    const path = looksLikeTxn
      ? `/v3/pay/transactions/id/${encodeURIComponent(providerRef)}?mchid=${encodeURIComponent(creds.mchid)}`
      : `/v3/pay/transactions/out-trade-no/${encodeURIComponent(wechatOutTradeNo(providerRef))}?mchid=${encodeURIComponent(creds.mchid)}`;
    const payload = requireObject(
      await this.api(config, creds, "GET", path),
      "WeChat query returned an empty body",
    );
    return this.queryFromTrade(payload, config, creds, providerRef);
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertWechatPayV3Credentials(config.credentials);
    const queried = await this.queryPayment(input.providerRef, config);
    const originalTotal = queried.amountCents > 0 ? queried.amountCents : input.amountCents;
    wechatCnyAmount(input.amountCents, input.currency);
    const body: Record<string, unknown> = {
      out_refund_no: wechatOutTradeNo(input.idempotencyKey.replaceAll("-", "").slice(0, 32)),
      reason: input.reason ?? "refund",
      amount: {
        refund: input.amountCents,
        total: originalTotal,
        currency: "CNY",
      },
    };
    if (/^[0-9]{10,64}$/.test(input.providerRef)) {
      body.transaction_id = input.providerRef;
    } else {
      body.out_trade_no = wechatOutTradeNo(input.attemptId);
    }
    const payload = requireObject(
      await this.api(config, creds, "POST", "/v3/refund/domestic/refunds", body),
      "WeChat refund returned an empty body",
    );
    const status = stringField(payload, "status");
    const mapped =
      status === "SUCCESS" || status === "PROCESSING"
        ? status === "SUCCESS"
          ? "succeeded"
          : "pending"
        : "failed";
    const refundAmt = asObject(payload.amount);
    return {
      providerRef: stringField(payload, "refund_id") || input.idempotencyKey,
      status: mapped,
      amountCents: Number(refundAmt.refund) || input.amountCents,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      apiBase: officialWechatBase(config.environment, "cn"),
      remoteTested: false,
    };
    try {
      const creds = assertWechatPayV3Credentials(config.credentials);
      diagnostics.apiBase = officialWechatBase(config.environment, creds.apiRegion);
      diagnostics.mchidLastFour = creds.mchid.slice(-4);
      diagnostics.notifyHost = new URL(creds.notifyUrl).host;
      diagnostics.platformSerialCount = wechatPlatformKeyRing(creds).size;
      diagnostics.merchantSerialFingerprint = createHash("sha256")
        .update(creds.merchantSerial)
        .digest("hex")
        .slice(0, 16);
      const signed = signWechatRequest(
        wechatSignMessage("GET", "/v3/certificates", "1", "n", ""),
        loadPrivateKey(creds.merchantPrivateKey),
      );
      diagnostics.localSignOk = signed.length > 0;
      if (opts?.remote) {
        await this.api(config, creds, "GET", "/v3/certificates");
        diagnostics.remoteTested = true;
      }
    } catch (err) {
      issues.push(err instanceof Error ? err.message : "credential_invalid");
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("wechat_pay_v3"),
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private queryFromTrade(
    payload: Record<string, unknown>,
    config: ProviderConfig,
    creds: ReturnType<typeof assertWechatPayV3Credentials>,
    fallbackRef: string,
  ): PaymentQueryResult {
    const tradeState = stringField(payload, "trade_state");
    const mapped = mapWechatTradeState(tradeState);
    const amount = asObject(payload.amount);
    const status =
      mapped === "succeeded"
        ? "succeeded"
        : mapped === "failed"
          ? "failed"
          : mapped === "canceled"
            ? "canceled"
            : "pending";
    return {
      providerRef: stringField(payload, "transaction_id") || fallbackRef,
      orderId: stringField(payload, "attach") || null,
      attemptId: wechatAttemptIdFromOutTradeNo(stringField(payload, "out_trade_no")) || null,
      status,
      amountCents: Number(amount.total) || 0,
      currency: (stringField(amount, "currency") || "CNY").toUpperCase(),
      merchantId: stringField(payload, "mchid") || config.merchantId || creds.mchid,
    };
  }

  private async api(
    config: ProviderConfig,
    creds: ReturnType<typeof assertWechatPayV3Credentials>,
    method: string,
    pathWithQuery: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    const timestamp = String(Math.floor(this.now().getTime() / 1000));
    const nonce = randomBytes(16).toString("hex");
    const bodyText = method === "GET" || body === undefined ? "" : JSON.stringify(body);
    const message = wechatSignMessage(method, pathWithQuery, timestamp, nonce, bodyText);
    const signature = signWechatRequest(message, loadPrivateKey(creds.merchantPrivateKey));
    const { status, json, text } = await paymentFetchJson(
      this.fetchFn(),
      `${officialWechatBase(config.environment, creds.apiRegion)}${pathWithQuery}`,
      {
        method,
        headers: {
          authorization: wechatAuthorization({
            mchid: creds.mchid,
            nonce,
            signature,
            timestamp,
            serial: creds.merchantSerial,
          }),
          accept: "application/json",
          "content-type": "application/json",
        },
        body: bodyText || undefined,
      },
      { allowedHosts: wechatAllowedHosts() },
    );
    if (status >= 400) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        `WeChat API ${method} ${pathWithQuery.split("?")[0]} failed`,
        { details: { status, bodyLength: text.length } },
      );
    }
    return asObject(json);
  }
}

function requireObject(
  value: Record<string, unknown> | null,
  message: string,
): Record<string, unknown> {
  if (!value || Object.keys(value).length === 0) {
    throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", message);
  }
  return value;
}

function header(headers: Record<string, string>, name: string): string {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] ?? "";
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
