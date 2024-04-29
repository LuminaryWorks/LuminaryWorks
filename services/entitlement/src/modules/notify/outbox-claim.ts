/**
 * Pure helpers for multi-instance outbox claim / lease recovery.
 * SQL is executed by OutboxService; this module stays unit-testable.
 */

export type ClaimableOutboxStatus = "pending" | "failed" | "processing";

/** Rows eligible for claim: due pending/failed, or processing with expired lease. */
export function isLeaseExpired(lockedUntil: Date | null | undefined, now: Date): boolean {
  if (!lockedUntil) return true;
  return lockedUntil.getTime() <= now.getTime();
}

export function isClaimableRow(input: {
  status: string;
  scheduledFor: Date | null;
  nextAttemptAt: Date | null;
  lockedUntil: Date | null;
  now: Date;
}): boolean {
  const { status, scheduledFor, nextAttemptAt, lockedUntil, now } = input;
  const dueSchedule = !scheduledFor || scheduledFor.getTime() <= now.getTime();
  const dueRetry = !nextAttemptAt || nextAttemptAt.getTime() <= now.getTime();
  if (!dueSchedule || !dueRetry) return false;

  if (status === "pending" || status === "failed") {
    return isLeaseExpired(lockedUntil, now);
  }
  // Recover abandoned processing leases
  if (status === "processing") {
    return isLeaseExpired(lockedUntil, now);
  }
  return false;
}

export function nextStatusAfterFailure(input: {
  attempts: number;
  maxAttempts: number;
}): "failed" | "dead" {
  return input.attempts >= input.maxAttempts ? "dead" : "failed";
}

/** PostgreSQL claim statement (parameterized placeholders for documentation/tests). */
export const OUTBOX_CLAIM_SQL = `
WITH cte AS (
  SELECT id FROM outbox_events
  WHERE (
      (status IN ('pending', 'failed') AND (locked_until IS NULL OR locked_until < $1))
      OR (status = 'processing' AND locked_until IS NOT NULL AND locked_until < $1)
    )
    AND (scheduled_for IS NULL OR scheduled_for <= $1)
    AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
  ORDER BY scheduled_for ASC NULLS FIRST
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
UPDATE outbox_events e SET
  status = 'processing',
  locked_until = $3,
  locked_by = $4,
  attempts = e.attempts + 1,
  updated_at = $1
FROM cte
WHERE e.id = cte.id
RETURNING e.*
`.trim();

export function leaseExpiresAt(now: Date, leaseSeconds: number): Date {
  return new Date(now.getTime() + Math.max(1, leaseSeconds) * 1000);
}

export function defaultWorkerId(): string {
  const host = process.env.HOSTNAME || process.env.COMPUTERNAME || "worker";
  return `${host}:${process.pid}`;
}
