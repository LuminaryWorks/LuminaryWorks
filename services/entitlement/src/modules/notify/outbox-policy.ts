/**
 * Exponential backoff for outbox retries: min(3600, 2^attempt) seconds.
 */
export function outboxBackoffSeconds(attempts: number): number {
  return Math.min(3600, 2 ** Math.min(Math.max(attempts, 1), 12));
}

export function trialNotifyDedupeKey(
  logtoSub: string,
  productCode: string,
  eventType: "trial.expiring" | "trial.expired",
  scheduledFor: Date,
): string {
  if (eventType === "trial.expiring") {
    return `${logtoSub}:${productCode}:${eventType}:${scheduledFor.toISOString().slice(0, 10)}`;
  }
  return `${logtoSub}:${productCode}:${eventType}:${scheduledFor.toISOString()}`;
}
