import { hmacSha256Base64Url, randomToken } from "../../common/crypto";
import type { DataSource } from "typeorm";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { TrialCleanupJobEntity } from "../../database/entities/trial-cleanup-job.entity";
import type { TrialPurgeTargetMap } from "../../common/legal-policy";
import {
  acquireTrialLifecycleLock,
  cancelTrialLifecycle,
  hasActiveNonTrialPaidEntitlement,
} from "../trials/trial-lifecycle";

export type TrialPurgeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text: () => Promise<string> }>;

export interface TrialPurgeSignedRequest {
  rawBody: string;
  headers: {
    "content-type": "application/json";
    "x-lw-timestamp": string;
    "x-lw-nonce": string;
    "x-lw-signature": string;
    "x-lw-event-id": string;
    "x-lw-job-id": string;
  };
}

export interface TrialPurgePayload {
  eventType: "trial.purge";
  eventId: string;
  jobId: string;
  trialRedemptionId: string;
  subscriptionId: string;
  logtoSub: string;
  productCode: string;
  startsAt: string;
  endsAt: string;
  policyVersion: string;
  scheduledFor: string;
}

export function trialPurgeSignatureMessage(
  timestamp: string,
  nonce: string,
  rawBody: string,
): string {
  return `${timestamp}.${nonce}.${rawBody}`;
}

/** HMAC-SHA256 over `${timestamp}.${nonce}.${rawBody}`; header `x-lw-signature: v1=<base64url>`. */
export function signTrialPurgeRequest(input: {
  secret: string;
  payload: TrialPurgePayload;
  timestamp?: string;
  nonce?: string;
}): TrialPurgeSignedRequest {
  const rawBody = JSON.stringify(input.payload);
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const nonce = input.nonce ?? randomToken(16);
  const sig = hmacSha256Base64Url(
    input.secret,
    trialPurgeSignatureMessage(timestamp, nonce, rawBody),
  );
  return {
    rawBody,
    headers: {
      "content-type": "application/json",
      "x-lw-timestamp": timestamp,
      "x-lw-nonce": nonce,
      "x-lw-signature": `v1=${sig}`,
      "x-lw-event-id": input.payload.eventId,
      "x-lw-job-id": input.payload.jobId,
    },
  };
}

/**
 * Product ack: HTTP 2xx JSON `{ "ok": true, "jobId"?: string, "eventId"?: string }`.
 * Present ids must match the delivered job/event. Anything else is retryable.
 */
export function assertTrialPurgeAck(
  httpStatus: number,
  rawText: string,
  expected: { jobId: string; eventId: string },
): Record<string, unknown> {
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new Error(`Trial purge HTTP ${httpStatus}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Trial purge ack is not JSON");
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Trial purge ack must be a JSON object");
  }
  const ack = parsed as Record<string, unknown>;
  if (ack.ok !== true) {
    throw new Error("Trial purge ack missing ok:true");
  }
  if (ack.jobId != null && String(ack.jobId) !== expected.jobId) {
    throw new Error("Trial purge ack jobId mismatch");
  }
  if (ack.eventId != null && String(ack.eventId) !== expected.eventId) {
    throw new Error("Trial purge ack eventId mismatch");
  }
  return ack;
}

export function missingTrialPurgeTargetError(productCode: string): Error {
  return new Error(`Missing trial purge target for product ${productCode}`);
}

export function buildTrialPurgePayload(
  event: OutboxEventEntity,
  job: TrialCleanupJobEntity,
): TrialPurgePayload {
  return {
    eventType: "trial.purge",
    eventId: event.id,
    jobId: job.id,
    trialRedemptionId: job.trialRedemptionId,
    subscriptionId: job.subscriptionId,
    logtoSub: job.logtoSub,
    productCode: job.productCode,
    startsAt: job.startsAt.toISOString(),
    endsAt: job.endsAt.toISOString(),
    policyVersion: job.policyVersion,
    scheduledFor: job.scheduledFor.toISOString(),
  };
}

/**
 * Deliver signed trial.purge while holding the per-user/product advisory lock.
 * Missing targets throw (retry / dead-letter) and never mark the event sent.
 */
export async function deliverTrialPurge(input: {
  dataSource: DataSource;
  event: OutboxEventEntity;
  targets: TrialPurgeTargetMap;
  fetchImpl: TrialPurgeFetch;
  timeoutMs?: number;
}): Promise<"sent" | "canceled"> {
  return input.dataSource.transaction(async (manager) => {
    const logtoSub = String(input.event.payload.logtoSub ?? "");
    const productCode = String(input.event.payload.productCode ?? "");
    if (!logtoSub || !productCode) {
      throw new Error("Invalid trial.purge payload: missing logtoSub or productCode");
    }

    await acquireTrialLifecycleLock(manager, logtoSub, productCode);

    const current = await manager.findOne(OutboxEventEntity, { where: { id: input.event.id } });
    if (!current || current.status === "canceled") {
      return "canceled";
    }

    const redemptionId = String(input.event.payload.trialRedemptionId ?? "");
    const job = redemptionId
      ? await manager.findOne(TrialCleanupJobEntity, {
          where: { trialRedemptionId: redemptionId },
        })
      : await manager.findOne(TrialCleanupJobEntity, {
          where: { outboxEventId: input.event.id },
        });

    if (!job || job.status === "canceled") {
      current.status = "canceled";
      current.lockedUntil = null;
      current.lockedBy = null;
      await manager.save(current);
      return "canceled";
    }
    if (job.status === "acked") {
      return "sent";
    }

    const paid = await hasActiveNonTrialPaidEntitlement(manager, {
      logtoSub,
      productCode,
      organizationId: job.organizationId,
      deploymentId: job.deploymentId,
    });
    if (paid) {
      await cancelTrialLifecycle(manager, logtoSub, productCode);
      return "canceled";
    }

    const target = input.targets[productCode];
    if (!target) {
      throw missingTrialPurgeTargetError(productCode);
    }

    job.status = "processing";
    job.attempts += 1;
    await manager.save(job);

    const signed = signTrialPurgeRequest({
      secret: target.secret,
      payload: buildTrialPurgePayload(current, job),
    });
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, input.timeoutMs ?? 15_000);
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

    const ack = assertTrialPurgeAck(httpStatus, rawText, {
      jobId: job.id,
      eventId: current.id,
    });
    const now = new Date();
    job.status = "acked";
    job.deliveredAt = now;
    job.ackedAt = now;
    job.ackPayload = ack;
    job.lastError = null;
    await manager.save(job);
    return "sent";
  });
}
