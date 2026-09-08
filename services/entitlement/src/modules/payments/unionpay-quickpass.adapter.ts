import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { assertUnionpayQuickpassCredentials } from "../../common/payment-credentials";
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
import {
  officialUnionpayBack,
  officialUnionpayFront,
  officialUnionpayQuery,
  paymentFetch,
  unionpayAllowedHosts,
} from "./payment-http";
import {
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";
import {
  composeUnionpayProviderRef,
  encodeUnionPayForm,
  formatUnionpayTxnTime,
  mapUnionpayRespCode,
  parseUnionPayBody,
  parseUnionpayProviderRef,
  signUnionPayParams,
  UNIONPAY_CNY,
  UNIONPAY_ENCODING,
  UNIONPAY_SIGN_METHOD_RSA,
  UNIONPAY_VERSION,
  unionpayAttemptIdFromOrderId,
  unionpayCnyFen,
  unionpayOrderId,
  verifyUnionPayParams,
} from "./unionpay-protocol";

@Injectable()
export class UnionpayQuickpassPaymentAdapter implements PaymentAdapter {
  readonly provider = "unionpay_quickpass" as const;

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
    const creds = assertUnionpayQuickpassCredentials(input.config.credentials);
    const orderId = unionpayOrderId(input.attemptId);
    const txnTime = formatUnionpayTxnTime(this.now());
    const txnAmt = unionpayCnyFen(input.amountCents, input.currency);
    const unsigned = this.baseFields(creds, {
      txnType: "01",
      txnSubType: creds.txnSubType,
      bizType: creds.bizType,
      channelType: creds.channelType,
      accessType: "0",
      orderId,
      txnTime,
      txnAmt,
      currencyCode: UNIONPAY_CNY,
      frontUrl: creds.frontUrl,
      backUrl: creds.backUrl,
      reqReserved: input.orderId,
    });
    unsigned.signature = signUnionPayParams(unsigned, creds.merchantPrivateKey);
    const providerRef = composeUnionpayProviderRef(orderId, txnTime);
    if (creds.checkoutMode === "hosted") {
      const url = officialUnionpayFront(input.config.environment);
      return {
        provider: this.provider,
        providerRef,
        status: "pending",
        checkoutUrl: url,
        qrPayload: null,
        action: { type: "form_post", url, fields: unsigned, attemptId: input.attemptId },
      };
    }
    const response = await this.postSigned(
      officialUnionpayBack(input.config.environment),
      unsigned,
    );
    if (!verifyUnionPayParams(response, creds.unionpayPublicKey)) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "UnionPay QR response signature is invalid",
      );
    }
    const qr = response.qrCode;
    if (mapUnionpayRespCode(response.respCode ?? "") !== "succeeded" || !qr) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        response.respMsg || "UnionPay QR preorder failed",
      );
    }
    return {
      provider: this.provider,
      providerRef: response.queryId ? composeUnionpayProviderRef(orderId, txnTime) : providerRef,
      status: "pending",
      checkoutUrl: null,
      qrPayload: qr,
      action: { type: "qr", attemptId: input.attemptId, orderId, txnTime },
    };
  }

  async completeCheckout(input: CompleteCheckoutInput): Promise<PaymentQueryResult> {
    return this.queryPayment(input.providerRef, input.config);
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    _headers: Record<string, string>,
    config: ProviderConfig,
  ): Promise<VerifiedWebhook> {
    const creds = assertUnionpayQuickpassCredentials(config.credentials);
    const params = parseUnionPayBody(rawBody);
    if (!verifyUnionPayParams(params, creds.unionpayPublicKey)) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "UnionPay backUrl signature mismatch",
      );
    }
    if (params.merId && params.merId !== creds.merId) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "UnionPay merId does not match config",
      );
    }
    if (params.currencyCode && params.currencyCode !== UNIONPAY_CNY) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "UnionPay currencyCode must be 156 (CNY)",
      );
    }
    const respMapped = mapUnionpayRespCode(params.respCode ?? "");
    const orderId = params.orderId ?? "";
    const txnTime = params.txnTime ?? "";
    const queryId = params.queryId ?? "";
    const eventId = params.traceNo || params.queryId || `${orderId}:${params.respCode}:${txnTime}`;
    const ack = { status: 200, body: "ok", contentType: "text/plain; charset=utf-8" };
    if (respMapped !== "succeeded") {
      return {
        eventId,
        orderId: params.reqReserved || "",
        attemptId: unionpayAttemptIdFromOrderId(orderId),
        providerRef: queryId || composeUnionpayProviderRef(orderId, txnTime),
        status: respMapped === "pending" ? "pending" : "failed",
        amountCents: params.txnAmt ? Number(params.txnAmt) : 0,
        currency: "CNY",
        merchantId: creds.merId,
        payload: redactPaymentSecrets({ ...params, signature: "[redacted]" }),
        ack,
      };
    }
    const queried = await this.queryPayment(
      queryId || composeUnionpayProviderRef(orderId, txnTime),
      config,
    );
    if (queried.status !== "succeeded") {
      return {
        eventId,
        orderId: queried.orderId || params.reqReserved || "",
        attemptId: queried.attemptId || unionpayAttemptIdFromOrderId(orderId),
        providerRef: queried.providerRef,
        status: queried.status === "failed" ? "failed" : "pending",
        amountCents: queried.amountCents,
        currency: "CNY",
        merchantId: creds.merId,
        requiresQuery: queried.status === "pending",
        payload: redactPaymentSecrets({ respCode: params.respCode, queryStatus: queried.status }),
        ack,
      };
    }
    if (params.txnAmt && Number(params.txnAmt) !== queried.amountCents) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "UnionPay backUrl amount does not match query",
      );
    }
    return {
      eventId,
      orderId: queried.orderId || params.reqReserved || "",
      attemptId: queried.attemptId || unionpayAttemptIdFromOrderId(orderId),
      providerRef: queried.providerRef,
      status: "succeeded",
      amountCents: queried.amountCents,
      currency: "CNY",
      merchantId: creds.merId,
      payload: redactPaymentSecrets({ respCode: params.respCode, queryId }),
      ack,
    };
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const creds = assertUnionpayQuickpassCredentials(config.credentials);
    const parsed = parseUnionpayProviderRef(providerRef);
    const txnTime = parsed.txnTime || formatUnionpayTxnTime(this.now());
    const orderId = parsed.orderId || unionpayOrderId(providerRef);
    const unsigned = this.baseFields(creds, {
      txnType: "00",
      txnSubType: "00",
      bizType: creds.bizType,
      accessType: "0",
      orderId,
      txnTime,
      ...(parsed.queryId ? { queryId: parsed.queryId } : {}),
    });
    unsigned.signature = signUnionPayParams(unsigned, creds.merchantPrivateKey);
    const response = await this.postSigned(officialUnionpayQuery(config.environment), unsigned);
    if (!verifyUnionPayParams(response, creds.unionpayPublicKey)) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "UnionPay query response signature is invalid",
      );
    }
    const orig = response.origRespCode || response.respCode || "";
    const mapped = mapUnionpayRespCode(orig);
    const status =
      mapped === "succeeded" ? "succeeded" : mapped === "failed" ? "failed" : "pending";
    return {
      providerRef: response.queryId || composeUnionpayProviderRef(orderId, txnTime),
      orderId: response.reqReserved || null,
      attemptId: unionpayAttemptIdFromOrderId(response.orderId || orderId),
      status,
      amountCents: response.txnAmt ? Number(response.txnAmt) : 0,
      currency: "CNY",
      merchantId: response.merId || creds.merId,
    };
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertUnionpayQuickpassCredentials(config.credentials);
    if (input.amountCents <= 0) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "UnionPay refund amount is invalid",
      );
    }
    const queried = await this.queryPayment(input.providerRef, config);
    const parsed = parseUnionpayProviderRef(input.providerRef);
    const origQryId = queried.providerRef.match(/^\d{16,32}$/)
      ? queried.providerRef
      : parsed.queryId;
    if (!origQryId) {
      throw new EntitlementException(
        "PAYMENT_REFUND_UNSUPPORTED",
        "UnionPay refund requires origQryId from a successful query",
      );
    }
    const orderId = unionpayOrderId(input.idempotencyKey);
    const txnTime = formatUnionpayTxnTime(this.now());
    const unsigned = this.baseFields(creds, {
      txnType: "04",
      txnSubType: "00",
      bizType: creds.bizType,
      channelType: creds.channelType,
      accessType: "0",
      orderId,
      txnTime,
      txnAmt: unionpayCnyFen(input.amountCents, input.currency),
      currencyCode: UNIONPAY_CNY,
      origQryId,
      backUrl: creds.backUrl,
    });
    unsigned.signature = signUnionPayParams(unsigned, creds.merchantPrivateKey);
    const response = await this.postSigned(officialUnionpayBack(config.environment), unsigned);
    if (!verifyUnionPayParams(response, creds.unionpayPublicKey)) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "UnionPay refund response signature is invalid",
      );
    }
    const mapped = mapUnionpayRespCode(response.respCode ?? "");
    return {
      providerRef: response.queryId || input.idempotencyKey,
      status: mapped === "succeeded" ? "succeeded" : mapped === "failed" ? "failed" : "pending",
      amountCents: input.amountCents,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      frontUrl: officialUnionpayFront(config.environment),
      backGateway: officialUnionpayBack(config.environment),
      queryGateway: officialUnionpayQuery(config.environment),
      protocolVersion: UNIONPAY_VERSION,
      signMethod: UNIONPAY_SIGN_METHOD_RSA,
      remoteTested: false,
      sm2: false,
    };
    try {
      const creds = assertUnionpayQuickpassCredentials(config.credentials);
      diagnostics.merIdLastFour = creds.merId.slice(-4);
      diagnostics.checkoutMode = creds.checkoutMode;
      diagnostics.certIdFingerprint = createHash("sha256")
        .update(creds.certId)
        .digest("hex")
        .slice(0, 16);
      const sample = signUnionPayParams(
        { merId: creds.merId, certId: creds.certId, version: UNIONPAY_VERSION },
        creds.merchantPrivateKey,
      );
      diagnostics.localSignOk = sample.length > 0;
      if (opts?.remote) {
        await this.queryPayment("healthcheck", config);
        diagnostics.remoteTested = true;
      }
    } catch (err) {
      issues.push(err instanceof Error ? err.message : "credential_invalid");
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("unionpay_quickpass"),
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private baseFields(
    creds: ReturnType<typeof assertUnionpayQuickpassCredentials>,
    extra: Record<string, string>,
  ): Record<string, string> {
    return {
      version: creds.protocolVersion,
      encoding: UNIONPAY_ENCODING,
      signMethod: creds.signMethod,
      merId: creds.merId,
      certId: creds.certId,
      ...extra,
    };
  }

  private async postSigned(
    url: string,
    params: Record<string, string>,
  ): Promise<Record<string, string>> {
    const response = await paymentFetch(
      this.fetchFn(),
      url,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
        body: encodeUnionPayForm(params),
      },
      { allowedHosts: unionpayAllowedHosts() },
    );
    const text = await response.text();
    if (response.status >= 400) {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "UnionPay gateway request failed",
        { details: { status: response.status, bodyLength: text.length } },
      );
    }
    return parseUnionPayBody(Buffer.from(text));
  }
}
