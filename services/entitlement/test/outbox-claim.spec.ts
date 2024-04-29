import {
  isClaimableRow,
  isLeaseExpired,
  leaseExpiresAt,
  nextStatusAfterFailure,
  OUTBOX_CLAIM_SQL,
} from "../src/modules/notify/outbox-claim";
import { outboxBackoffSeconds, trialNotifyDedupeKey } from "../src/modules/notify/outbox-policy";

describe("outbox multi-instance claim", () => {
  const now = new Date("2026-07-29T08:00:00.000Z");

  it("exposes FOR UPDATE SKIP LOCKED claim SQL", () => {
    expect(OUTBOX_CLAIM_SQL).toContain("FOR UPDATE SKIP LOCKED");
    expect(OUTBOX_CLAIM_SQL).toContain("locked_until");
    expect(OUTBOX_CLAIM_SQL).toContain("status = 'processing'");
  });

  it("treats null lease as expired", () => {
    expect(isLeaseExpired(null, now)).toBe(true);
    expect(isLeaseExpired(new Date("2026-07-29T07:59:00.000Z"), now)).toBe(true);
    expect(isLeaseExpired(new Date("2026-07-29T08:01:00.000Z"), now)).toBe(false);
  });

  it("allows reclaim of processing rows only after lease expiry", () => {
    expect(
      isClaimableRow({
        status: "processing",
        scheduledFor: null,
        nextAttemptAt: null,
        lockedUntil: new Date("2026-07-29T07:00:00.000Z"),
        now,
      }),
    ).toBe(true);
    expect(
      isClaimableRow({
        status: "processing",
        scheduledFor: null,
        nextAttemptAt: null,
        lockedUntil: new Date("2026-07-29T09:00:00.000Z"),
        now,
      }),
    ).toBe(false);
  });

  it("respects scheduled_for and next_attempt_at before claim", () => {
    expect(
      isClaimableRow({
        status: "pending",
        scheduledFor: new Date("2026-07-29T09:00:00.000Z"),
        nextAttemptAt: null,
        lockedUntil: null,
        now,
      }),
    ).toBe(false);
    expect(
      isClaimableRow({
        status: "failed",
        scheduledFor: null,
        nextAttemptAt: new Date("2026-07-29T09:00:00.000Z"),
        lockedUntil: null,
        now,
      }),
    ).toBe(false);
    expect(
      isClaimableRow({
        status: "pending",
        scheduledFor: null,
        nextAttemptAt: null,
        lockedUntil: null,
        now,
      }),
    ).toBe(true);
  });

  it("computes lease expiry window", () => {
    expect(leaseExpiresAt(now, 60).toISOString()).toBe("2026-07-29T08:01:00.000Z");
  });

  it("dead-letters after max attempts; otherwise retries", () => {
    expect(nextStatusAfterFailure({ attempts: 8, maxAttempts: 8 })).toBe("dead");
    expect(nextStatusAfterFailure({ attempts: 3, maxAttempts: 8 })).toBe("failed");
  });

  it("keeps retry backoff + dedupe keys stable", () => {
    expect(outboxBackoffSeconds(3)).toBe(8);
    expect(
      trialNotifyDedupeKey(
        "u1",
        "blockyedu",
        "trial.expiring",
        new Date("2026-07-05T00:00:00.000Z"),
      ),
    ).toBe("u1:blockyedu:trial.expiring:2026-07-05");
  });
});
