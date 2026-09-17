import { hmacSha256Base64Url, randomToken } from "../../common/crypto";
import type { OrderFulfilledTargetMap } from "../../common/legal-policy";
import type { OutboxEventEntity } from "../../database/entities/outbox-event.entity";

export type OrderFulfilledFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text: () => Promise<string> }>;

export interface OrderFulfilledProduct {
  productCode: string;
  planCode: string | null;
}

/** Product-facing body (FR-BILL-06 / VistaRemote §3.1). */
export interface OrderFulfilledPayload {
  orderId: string;
  subjectId: string;
  productCode: string;
  planCode: string | null;
  sku: string;
  paidAt: string;
}

export interface OrderFulfilledSignedRequest {
  rawBody: string;
  headers: {
    "content-type": "application/json";
    "x-lw-timestamp": string;
    "x-lw-nonce": string;
    "x-lw-signature": string;
    "x-lw-event-id": string;
  };
}

export function orderFulfilledSignatureMessage(
  timestamp: string,
  nonce: string,
  rawBody: string,
): string {
  return `${timestamp}.${nonce}.${rawBody}`;
}

/** HMAC-SHA256 over `${timestamp}.${nonce}.${rawBody}`; header `x-lw-signature: v1=<base64url>`. */
export function signOrderFulfilledRequest(input: {
  secret: string;
  payload: OrderFulfilledPayload;
  eventId: string;
  timestamp?: string;
  nonce?: string;
}): OrderFulfilledSignedRequest {
  const rawBody = JSON.stringify(input.payload);
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const nonce = input.nonce ?? randomToken(16);
  const sig = hmacSha256Base64Url(
    input.secret,
    orderFulfilledSignatureMessage(timestamp, nonce, rawBody),
  );
  return {
    rawBody,
    headers: {
      "content-type": "application/json",
      "x-lw-timestamp": timestamp,
      "x-lw-nonce": nonce,
      "x-lw-signature": `v1=${sig}`,
      "x-lw-event-id": input.eventId,
    },
  };
}

/**
 * Product ack: HTTP 2xx JSON `{ "ok": true, "eventId"?: string }`.
 * Present eventId must match delivery. Anything else is retryable.
 */
export function assertOrderFulfilledAck(
  httpStatus: number,
  rawText: string,
  expected: { eventId: string },
): Record<string, unknown> {
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new Error(`Order fulfilled HTTP ${httpStatus}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Order fulfilled ack is not JSON");
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Order fulfilled ack must be a JSON object");
  }
  const ack = parsed as Record<string, unknown>;
  if (ack.ok !== true) {
    throw new Error("Order fulfilled ack missing ok:true");
  }
  if (ack.eventId != null && String(ack.eventId) !== expected.eventId) {
    throw new Error("Order fulfilled ack eventId mismatch");
  }
  return ack;
}

export function missingOrderFulfilledTargetError(productCode: string): Error {
  return new Error(`Missing order.fulfilled target for product ${productCode}`);
}

export function resolveOrderFulfilledProducts(
  payload: Record<string, unknown>,
): OrderFulfilledProduct[] {
  const rawProducts = payload.products;
  if (Array.isArray(rawProducts) && rawProducts.length > 0) {
    const out: OrderFulfilledProduct[] = [];
    for (const item of rawProducts) {
      if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const productCode = typeof rec.productCode === "string" ? rec.productCode.trim() : "";
      if (!productCode) continue;
      const planCode =
        typeof rec.planCode === "string" && rec.planCode.trim() ? rec.planCode.trim() : null;
      out.push({ productCode, planCode });
    }
    if (out.length > 0) return out;
  }
  const productCode = typeof payload.productCode === "string" ? payload.productCode.trim() : "";
  if (!productCode) return [];
  const planCode =
    typeof payload.planCode === "string" && payload.planCode.trim()
      ? payload.planCode.trim()
      : null;
  return [{ productCode, planCode }];
}

/**
 * Fan-out signed order.fulfilled to each product target.
 * Missing targets throw (retry / dead-letter) and never mark the event sent.
 */
export async function deliverOrderFulfilled(input: {
  event: OutboxEventEntity;
  targets: OrderFulfilledTargetMap;
  fetchImpl: OrderFulfilledFetch;
  timeoutMs?: number;
}): Promise<"sent"> {
  const orderId = String(input.event.payload.orderId ?? "").trim();
  const subjectId = String(input.event.payload.subjectId ?? "").trim();
  const sku = String(input.event.payload.sku ?? "").trim();
  const paidAt = String(input.event.payload.paidAt ?? "").trim();
  if (!orderId || !subjectId || !sku || !paidAt) {
    throw new Error("Invalid order.fulfilled payload: need orderId, subjectId, sku, paidAt");
  }

  const products = resolveOrderFulfilledProducts(input.event.payload);
  if (products.length === 0) {
    throw new Error("Invalid order.fulfilled payload: no products to notify");
  }

  const timeoutMs = Math.max(1000, input.timeoutMs ?? 15_000);
  // Stable per-product event id so redelivery remains idempotent at each ingress.
  for (const product of products) {
    const target = input.targets[product.productCode];
    if (!target) {
      throw missingOrderFulfilledTargetError(product.productCode);
    }
    const eventId = `${input.event.id}:${product.productCode}`;
    const signed = signOrderFulfilledRequest({
      secret: target.secret,
      eventId,
      payload: {
        orderId,
        subjectId,
        productCode: product.productCode,
        planCode: product.planCode,
        sku,
        paidAt,
      },
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let httpStatus: number;
    let rawText: string;
    try {
      const res = await input.fetchImpl(target.url, {
        method: "POST",
        headers: signed.headers,
        body: signed.rawBody,
        signal: controller.signal,
      });
      httpStatus = res.status;
      rawText = await res.text();
    } finally {
      clearTimeout(timer);
    }
    assertOrderFulfilledAck(httpStatus, rawText, { eventId });
  }
  return "sent";
}
