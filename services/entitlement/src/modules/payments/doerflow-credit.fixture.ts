import { EntitlementException } from "../../common/errors";
import { defaultCapabilities } from "../../common/payment-providers";
import type { ProviderConfig } from "./payment-adapter";
import { DoerflowCreditPaymentAdapter } from "./doerflow-credit.adapter";
import { MERCHANT_CHARGE_EVENT_TYPE, MERCHANT_REFUND_EVENT_TYPE } from "./doerflow-credit";
import type { PaymentClock } from "./payment-runtime";

/**
 * Lab dry-run for `doerflow_credit` when the webhook config id has no enabled
 * provider row. Records a plan-grant marker and a revoke. Does not write
 * subscriptions, touch a PSP, or move chain funds.
 *
 * Ignored when `NODE_ENV=production`, even if the flag is set.
 */
export function doerflowCreditFixtureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  const raw = env.DOERFLOW_CREDIT_FIXTURE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

type FixtureGrant = {
  eventId: string;
  orderId: string;
  planCode: "pro";
  amountMinor: string;
  revoked: boolean;
};

export type DoerflowCreditFixtureBody = {
  received: true;
  dryRun: true;
  granted: boolean;
  revoked: boolean;
  replayed: boolean;
  eventId: string;
  orderId: string;
  planCode: "pro" | null;
};

export class DoerflowCreditFixture {
  private readonly grants = new Map<string, FixtureGrant>();
  private readonly refunds = new Map<string, { orderId: string; revoked: boolean }>();
  private readonly adapter: DoerflowCreditPaymentAdapter;

  constructor(clock?: PaymentClock) {
    this.adapter = new DoerflowCreditPaymentAdapter(undefined, clock);
  }

  snapshot(configId: string) {
    return {
      dryRun: true as const,
      configId,
      grants: [...this.grants.values()].map((grant) => ({
        eventId: grant.eventId,
        orderId: grant.orderId,
        planCode: grant.planCode,
        revoked: grant.revoked,
      })),
    };
  }

  async handle(
    rawBody: Uint8Array,
    headers: Record<string, string>,
    configId: string,
  ): Promise<{ status: number; body: DoerflowCreditFixtureBody }> {
    const verified = await this.adapter.verifyWebhook(
      rawBody,
      headers,
      fixtureProviderConfig(configId),
    );
    const payload = verified.payload;
    const eventType = stringField(payload, "eventType");
    const eventId = verified.eventId || stringField(payload, "eventId");
    const orderId = verified.orderId || stringField(payload, "orderId");
    assertMerchant(stringField(payload, "merchantAccount"));
    if (eventType === MERCHANT_REFUND_EVENT_TYPE) {
      return { status: 200, body: this.applyRefund(eventId, orderId) };
    }
    if (eventType !== MERCHANT_CHARGE_EVENT_TYPE || verified.status !== "succeeded") {
      return {
        status: 200,
        body: {
          received: true,
          dryRun: true,
          granted: false,
          revoked: false,
          replayed: false,
          eventId,
          orderId,
          planCode: null,
        },
      };
    }
    return {
      status: 200,
      body: this.applyCharge(eventId, orderId, stringField(payload, "amountMinor")),
    };
  }

  private applyCharge(
    eventId: string,
    orderId: string,
    amountMinor: string,
  ): DoerflowCreditFixtureBody {
    if (!eventId || !orderId || !amountMinor) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "DoerFlow fixture charge is missing eventId, orderId, or amountMinor",
      );
    }
    const existing = this.grants.get(eventId);
    if (existing) {
      if (existing.amountMinor !== amountMinor || existing.orderId !== orderId) {
        throw new EntitlementException(
          "PAYMENT_AMOUNT_MISMATCH",
          "DoerFlow fixture replay does not match the first grant",
        );
      }
      return this.chargeBody(existing, true);
    }
    const grant: FixtureGrant = {
      eventId,
      orderId,
      planCode: "pro",
      amountMinor,
      revoked: false,
    };
    this.grants.set(eventId, grant);
    return this.chargeBody(grant, false);
  }

  private applyRefund(eventId: string, orderId: string): DoerflowCreditFixtureBody {
    if (!eventId || !orderId) {
      throw new EntitlementException(
        "PAYMENT_WEBHOOK_INVALID",
        "DoerFlow fixture refund is missing eventId or orderId",
      );
    }
    const seen = this.refunds.get(eventId);
    if (seen) {
      return {
        received: true,
        dryRun: true,
        granted: this.grantForOrder(seen.orderId) != null,
        revoked: seen.revoked,
        replayed: true,
        eventId,
        orderId: seen.orderId,
        planCode: seen.revoked ? "pro" : null,
      };
    }
    let revoked = false;
    for (const grant of this.grants.values()) {
      if (grant.orderId !== orderId || grant.revoked) continue;
      grant.revoked = true;
      revoked = true;
    }
    this.refunds.set(eventId, { orderId, revoked });
    return {
      received: true,
      dryRun: true,
      granted: this.grantForOrder(orderId) != null,
      revoked,
      replayed: false,
      eventId,
      orderId,
      planCode: revoked ? "pro" : null,
    };
  }

  private grantForOrder(orderId: string): FixtureGrant | null {
    for (const grant of this.grants.values()) {
      if (grant.orderId === orderId) return grant;
    }
    return null;
  }

  private chargeBody(grant: FixtureGrant, replayed: boolean): DoerflowCreditFixtureBody {
    return {
      received: true,
      dryRun: true,
      granted: true,
      revoked: grant.revoked,
      replayed,
      eventId: grant.eventId,
      orderId: grant.orderId,
      planCode: grant.planCode,
    };
  }
}

function fixtureProviderConfig(configId: string): ProviderConfig {
  const merchantAccount = process.env.DOERFLOW_MERCHANT_ACCOUNT?.trim() ?? "";
  const webhookSecret = process.env.DOERFLOW_CREDIT_WEBHOOK_SECRET?.trim() ?? "";
  if (!merchantAccount || !webhookSecret) {
    throw new EntitlementException(
      "PAYMENT_WEBHOOK_INVALID",
      "Lab fixture requires DOERFLOW_CREDIT_WEBHOOK_SECRET and DOERFLOW_MERCHANT_ACCOUNT",
    );
  }
  return {
    id: configId,
    providerId: "doerflow_credit",
    environment: "sandbox",
    enabled: true,
    status: "active",
    marketScopes: ["GLOBAL"],
    currencies: ["USD"],
    priority: 25,
    capabilities: defaultCapabilities("doerflow_credit"),
    merchantId: merchantAccount,
    credentials: {
      baseUrl: "http://127.0.0.1:13008",
      serviceKey: "fixture-service-key",
      webhookSecret,
      merchantAccount,
      asset: "USDC",
      chainId: process.env.DOERFLOW_CREDIT_CHAIN_ID?.trim() || "84532",
    },
    metadata: {},
  };
}

function assertMerchant(observed: string): void {
  const expected = process.env.DOERFLOW_MERCHANT_ACCOUNT?.trim() ?? "";
  if (!observed || observed !== expected) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "DoerFlow merchantAccount does not match the lab fixture",
    );
  }
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}
