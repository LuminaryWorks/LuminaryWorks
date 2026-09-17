/**
 * Local mirror of DoerFlow `@vibe-agent/shared/payments` merchant charge contract.
 * Field-for-field with repos/shared/src/payments/merchant.ts — no cross-repo import.
 */
import { hmacSha256Base64Url, sha256Hex } from "../../common/crypto";
import { EntitlementException } from "../../common/errors";
import type { DoerflowCreditAsset } from "../../common/payment-credentials";

export type MerchantChargeRequest = {
  orderId: string;
  subjectId: string;
  asset: DoerflowCreditAsset;
  chainId: number;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type MerchantChargeStatus = "succeeded" | "failed" | "insufficient_funds";

export type MerchantChargeRejectCode =
  | "LEDGER_INSUFFICIENT_FUNDS"
  | "INVALID_AMOUNT"
  | "INVALID_ASSET"
  | "UNKNOWN_SUBJECT"
  | "MERCHANT_ACCOUNT_UNSET"
  | "CHARGE_CONFLICT";

export type MerchantChargeResult =
  | {
      status: "succeeded";
      chargeId: string;
      ledgerOpId: string;
      eventId: string;
      assetAddress: string;
      amountMinor: string;
      remainingMinor: string;
      replayed: boolean;
    }
  | {
      status: "failed" | "insufficient_funds";
      code: MerchantChargeRejectCode;
      message: string;
      eventId: string;
    };

export const MERCHANT_CHARGE_EVENT_TYPE = "doerflow.merchant.charge.settled" as const;

export type MerchantChargeWebhookPayload = {
  eventType: typeof MERCHANT_CHARGE_EVENT_TYPE;
  eventId: string;
  orderId: string;
  chargeId: string;
  status: MerchantChargeStatus;
  amountMinor: string;
  currency: string;
  asset: DoerflowCreditAsset;
  merchantAccount: string;
  settledAt: string;
};

/** amountMinor must be a non-zero positive integer decimal string (uint256). */
const AMOUNT_MINOR_PATTERN = /^[1-9][0-9]{0,77}$/;

export function isValidAmountMinor(value: string): boolean {
  return AMOUNT_MINOR_PATTERN.test(value);
}

/**
 * Deterministic eventId from the charge idempotencyKey.
 * Both ledgers must derive the same id so a replay cannot fulfill twice.
 */
export function deriveChargeEventId(idempotencyKey: string): string {
  return `dfc_${sha256Hex(idempotencyKey).slice(0, 32)}`;
}

/** Deterministic per payment attempt so a retried createCheckout cannot double-debit. */
export function deriveChargeIdempotencyKey(orderId: string, attemptId: string): string {
  return `dfc:${orderId}:${attemptId}`;
}

/** Partner webhook replay window (ENTITLEMENT_PARTNER_REPLAY_WINDOW_SECONDS default). */
export const DOERFLOW_WEBHOOK_REPLAY_WINDOW_SECONDS = 300;

/** USDC / USDT / PYUSD canonical decimals. Entitlement snapshots are fiat cents. */
export const DOERFLOW_STABLECOIN_DECIMALS = 6;
const FIAT_MINOR_DECIMALS = 2;
const LEDGER_PER_FIAT_MINOR = 10n ** BigInt(DOERFLOW_STABLECOIN_DECIMALS - FIAT_MINOR_DECIMALS);

export function toLedgerAmountMinor(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "DoerFlow amount must be a positive integer minor unit",
    );
  }
  return (BigInt(amountCents) * LEDGER_PER_FIAT_MINOR).toString();
}

export function ledgerAmountMinorToCents(amountMinor: string): number {
  if (!isValidAmountMinor(amountMinor)) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "DoerFlow amountMinor must be a positive integer decimal string",
    );
  }
  const value = BigInt(amountMinor);
  if (value % LEDGER_PER_FIAT_MINOR !== 0n) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "DoerFlow amountMinor is not aligned to the order snapshot scale",
    );
  }
  const cents = value / LEDGER_PER_FIAT_MINOR;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "DoerFlow amountMinor exceeds safe integer cents",
    );
  }
  return Number(cents);
}

/** Compare uint256 decimal strings with BigInt — never Number. */
export function assertLedgerAmountMatch(expectedMinor: string, observedMinor: string): void {
  if (!isValidAmountMinor(expectedMinor) || !isValidAmountMinor(observedMinor)) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "DoerFlow amountMinor must be a positive integer decimal string",
    );
  }
  if (BigInt(expectedMinor) !== BigInt(observedMinor)) {
    throw new EntitlementException(
      "PAYMENT_AMOUNT_MISMATCH",
      "DoerFlow amount does not match the order snapshot",
    );
  }
}

/**
 * HMAC over raw request bytes: `${timestamp}.${nonce}.${rawBody}`.
 * Matches partner-webhook.service computeSignature; never JSON.parse-then-reserialize.
 */
export function computeDoerflowWebhookSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  rawBody: Uint8Array,
): string {
  return hmacSha256Base64Url(
    secret,
    Buffer.concat([Buffer.from(`${timestamp}.${nonce}.`, "utf8"), Buffer.from(rawBody)]),
  );
}

export function joinDoerflowUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
