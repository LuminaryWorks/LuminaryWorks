import { Inject, Injectable, Optional } from "@nestjs/common";
import Stripe from "stripe";
import { assertStripeCheckoutCredentials } from "../../common/payment-credentials";
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
  officialStripeBase,
  PAYMENT_HTTP_TIMEOUT_MS,
  paymentFetch,
  stripeAllowedHosts,
} from "./payment-http";
import {
  defaultPaymentClock,
  defaultPaymentFetch,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
  type PaymentClock,
  type PaymentFetch,
} from "./payment-runtime";

@Injectable()
export class StripeCheckoutPaymentAdapter implements PaymentAdapter {
  readonly provider = "stripe_checkout" as const;

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
    const creds = assertStripeCheckoutCredentials(input.config.credentials);
    this.assertKeyEnvironment(creds.secretKey, input.config.environment);
    const successUrl = input.returnUrl || creds.successUrl;
    const cancelUrl = creds.cancelUrl || successUrl;
    if (!successUrl || !cancelUrl) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "Stripe Checkout requires successUrl (order returnUrl or credentials) and cancelUrl",
      );
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new EntitlementException(
        "PAYMENT_AMOUNT_MISMATCH",
        "Stripe amount must be a positive integer minor unit",
      );
    }
    const stripe = this.client(creds);
    const session = await this.wrapStripe("create checkout session", () =>
      stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: input.orderId,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: { orderId: input.orderId, attemptId: input.attemptId },
          payment_intent_data: {
            metadata: { orderId: input.orderId, attemptId: input.attemptId },
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.currency.toLowerCase(),
                unit_amount: input.amountCents,
                product_data: { name: `order ${input.orderId}` },
              },
            },
          ],
        },
        { idempotencyKey: input.attemptId },
      ),
    );
    if (!session.url || session.payment_status === "paid") {
      throw new EntitlementException(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "Stripe Checkout did not return a hosted session URL",
      );
    }
    return {
      provider: this.provider,
      providerRef: session.id,
      status: "pending",
      checkoutUrl: session.url,
      qrPayload: null,
      action: { type: "redirect", attemptId: input.attemptId, sessionId: session.id },
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
    const creds = assertStripeCheckoutCredentials(config.credentials);
    this.assertKeyEnvironment(creds.secretKey, config.environment);
    const signature = header(headers, "stripe-signature");
    if (!signature) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "Stripe-Signature header is required",
      );
    }
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(
        Buffer.from(rawBody),
        signature,
        creds.webhookSecret,
        undefined,
        undefined,
        this.now().getTime(),
      );
    } catch {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "Stripe webhook signature mismatch or timestamp outside tolerance",
      );
    }
    const ack = { status: 200, body: { received: true } };
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const amount = session.amount_total ?? 0;
      const currency = (session.currency ?? "usd").toUpperCase();
      if (session.payment_status === "paid") {
        return {
          eventId: event.id,
          orderId: session.client_reference_id || meta(session, "orderId"),
          attemptId: meta(session, "attemptId") || null,
          providerRef: session.id,
          status: "succeeded",
          amountCents: amount,
          currency,
          merchantId: config.merchantId,
          payload: redactPaymentSecrets({
            type: event.type,
            paymentStatus: session.payment_status,
          }),
          ack,
        };
      }
      return {
        eventId: event.id,
        orderId: session.client_reference_id || meta(session, "orderId"),
        attemptId: meta(session, "attemptId") || null,
        providerRef: paymentIntentId(session) || session.id,
        status: "pending",
        requiresQuery: true,
        amountCents: amount,
        currency,
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({
          type: event.type,
          paymentStatus: session.payment_status,
          reason: "session_completed_not_paid",
        }),
        ack,
      };
    }
    if (
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        eventId: event.id,
        orderId: session.client_reference_id || meta(session, "orderId"),
        attemptId: meta(session, "attemptId") || null,
        providerRef: session.id,
        status: "failed",
        amountCents: session.amount_total ?? 0,
        currency: (session.currency ?? "usd").toUpperCase(),
        merchantId: config.merchantId,
        payload: redactPaymentSecrets({ type: event.type }),
        ack,
      };
    }
    return {
      eventId: event.id,
      orderId: "",
      providerRef: event.id,
      status: "ignored",
      amountCents: 0,
      currency: config.currencies[0] ?? "USD",
      payload: redactPaymentSecrets({ type: event.type, reason: "unmapped_event" }),
      ack,
    };
  }

  async queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult> {
    const creds = assertStripeCheckoutCredentials(config.credentials);
    this.assertKeyEnvironment(creds.secretKey, config.environment);
    const stripe = this.client(creds);
    if (providerRef.startsWith("pi_")) {
      const intent = await this.wrapStripe("retrieve payment intent", () =>
        stripe.paymentIntents.retrieve(providerRef),
      );
      return this.fromIntent(intent, config);
    }
    const session = await this.wrapStripe("retrieve checkout session", () =>
      stripe.checkout.sessions.retrieve(providerRef, { expand: ["payment_intent"] }),
    );
    if (session.payment_status === "paid") {
      return {
        providerRef: session.id,
        orderId: session.client_reference_id || meta(session, "orderId") || null,
        attemptId: meta(session, "attemptId") || null,
        status: "succeeded",
        amountCents: session.amount_total ?? 0,
        currency: (session.currency ?? "usd").toUpperCase(),
        merchantId: config.merchantId,
      };
    }
    const intent = expandedIntent(session);
    if (intent && (intent.status === "succeeded" || intent.amount_received === intent.amount)) {
      if (intent.status === "succeeded") return this.fromIntent(intent, config);
    }
    if (session.status === "expired") {
      return {
        providerRef: session.id,
        status: "expired",
        amountCents: session.amount_total ?? 0,
        currency: (session.currency ?? "usd").toUpperCase(),
        merchantId: config.merchantId,
      };
    }
    return {
      providerRef: session.id,
      orderId: session.client_reference_id || null,
      attemptId: meta(session, "attemptId") || null,
      status: "pending",
      amountCents: session.amount_total ?? 0,
      currency: (session.currency ?? "usd").toUpperCase(),
      merchantId: config.merchantId,
    };
  }

  async refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult> {
    const creds = assertStripeCheckoutCredentials(config.credentials);
    this.assertKeyEnvironment(creds.secretKey, config.environment);
    const stripe = this.client(creds);
    let paymentIntent = input.providerRef.startsWith("pi_") ? input.providerRef : "";
    if (!paymentIntent) {
      const session = await this.wrapStripe("retrieve checkout session", () =>
        stripe.checkout.sessions.retrieve(input.providerRef),
      );
      paymentIntent = paymentIntentId(session);
    }
    if (!paymentIntent) {
      throw new EntitlementException(
        "PAYMENT_REFUND_UNSUPPORTED",
        "Stripe refund requires a PaymentIntent id",
      );
    }
    const refund = await this.wrapStripe("create refund", () =>
      stripe.refunds.create(
        {
          payment_intent: paymentIntent,
          amount: input.amountCents,
          reason: input.reason === "fraudulent" ? "fraudulent" : "requested_by_customer",
        },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    const status =
      refund.status === "succeeded"
        ? "succeeded"
        : refund.status === "failed"
          ? "failed"
          : "pending";
    return {
      providerRef: refund.id,
      status,
      amountCents: refund.amount,
    };
  }

  async healthCheck(config: ProviderConfig, opts?: HealthCheckOptions): Promise<HealthStatus> {
    const issues: string[] = [];
    const diagnostics: Record<string, unknown> = {
      environment: config.environment,
      apiBase: officialStripeBase(config.environment),
      remoteTested: false,
      hostedCheckoutOnly: true,
    };
    try {
      const creds = assertStripeCheckoutCredentials(config.credentials);
      this.assertKeyEnvironment(creds.secretKey, config.environment);
      diagnostics.secretKeyMode = creds.secretKey.startsWith("sk_live_") ? "live" : "test";
      diagnostics.secretKeyLastFour = creds.secretKey.slice(-4);
      diagnostics.webhookSecretLastFour = creds.webhookSecret.slice(-4);
      if (opts?.remote) {
        await this.wrapStripe("retrieve account", () =>
          this.client(creds).accounts.retrieveCurrent(),
        );
        diagnostics.remoteTested = true;
      }
    } catch (err) {
      issues.push(err instanceof Error ? err.message : "credential_invalid");
    }
    return {
      ok: issues.length === 0,
      issues,
      capabilities: defaultCapabilities("stripe_checkout"),
      diagnostics: redactPaymentSecrets(diagnostics),
    };
  }

  private client(creds: ReturnType<typeof assertStripeCheckoutCredentials>): Stripe {
    const fetchImpl = this.fetchFn();
    const wrapped: PaymentFetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      return paymentFetch(fetchImpl, url, init ?? {}, { allowedHosts: stripeAllowedHosts() });
    };
    return new Stripe(creds.secretKey, {
      httpClient: Stripe.createFetchHttpClient(wrapped),
      timeout: PAYMENT_HTTP_TIMEOUT_MS,
      maxNetworkRetries: 0,
      host: "api.stripe.com",
      protocol: "https",
      telemetry: false,
    });
  }

  private assertKeyEnvironment(secretKey: string, environment: "sandbox" | "live"): void {
    const liveKey = secretKey.startsWith("sk_live_");
    if (environment === "live" && !liveKey) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "stripe_checkout live environment requires an sk_live_ secret key",
      );
    }
    if (environment === "sandbox" && liveKey) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "stripe_checkout sandbox environment requires an sk_test_ secret key",
      );
    }
  }

  private fromIntent(intent: Stripe.PaymentIntent, config: ProviderConfig): PaymentQueryResult {
    const succeeded = intent.status === "succeeded";
    return {
      providerRef: intent.id,
      orderId: meta(intent, "orderId") || null,
      attemptId: meta(intent, "attemptId") || null,
      status: succeeded ? "succeeded" : intent.status === "canceled" ? "canceled" : "pending",
      amountCents: succeeded ? intent.amount_received : intent.amount,
      currency: intent.currency.toUpperCase(),
      merchantId: config.merchantId,
    };
  }

  private async wrapStripe<T>(op: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof EntitlementException) throw err;
      const message = err instanceof Error ? err.message : "unknown";
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError" || /timeout/i.test(message)) {
        throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", "Payment gateway timed out");
      }
      throw new EntitlementException("PAYMENT_PROVIDER_UNAVAILABLE", `Stripe ${op} failed`);
    }
  }
}

function header(headers: Record<string, string>, name: string): string {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] ?? "";
}

function meta(obj: { metadata?: Stripe.Metadata | null }, key: string): string {
  const value = obj.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function paymentIntentId(session: Stripe.Checkout.Session): string {
  const value = session.payment_intent;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) return value.id;
  return "";
}

function expandedIntent(session: Stripe.Checkout.Session): Stripe.PaymentIntent | null {
  const value = session.payment_intent;
  if (value && typeof value === "object" && "status" in value) return value as Stripe.PaymentIntent;
  return null;
}
