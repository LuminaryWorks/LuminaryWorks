/**
 * Exponential backoff for outbox retries: min(3600, 2^attempt) seconds.
 */
export function outboxBackoffSeconds(attempts: number): number {
  return Math.min(3600, 2 ** Math.min(Math.max(attempts, 1), 12));
}

export {
  trialNotifyDedupeKey,
  TRIAL_LIFECYCLE_EVENT_TYPES,
  type TrialLifecycleEventType,
} from "../trials/trial-lifecycle";
