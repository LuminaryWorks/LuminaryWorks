import { outboxBackoffSeconds, trialNotifyDedupeKey } from "../src/modules/notify/outbox-policy";

describe("outbox policy", () => {
  it("backs off exponentially capped at 3600s", () => {
    expect(outboxBackoffSeconds(1)).toBe(2);
    expect(outboxBackoffSeconds(2)).toBe(4);
    expect(outboxBackoffSeconds(10)).toBe(1024);
    expect(outboxBackoffSeconds(20)).toBe(3600);
  });

  it("builds stable trial dedupe keys", () => {
    const t3 = new Date("2026-07-05T00:00:00.000Z");
    const end = new Date("2026-07-08T00:00:00.000Z");
    expect(trialNotifyDedupeKey("u1", "dataluminary", "trial.expiring", t3)).toBe(
      "u1:dataluminary:trial.expiring:2026-07-05",
    );
    expect(trialNotifyDedupeKey("u1", "dataluminary", "trial.expired", end)).toBe(
      "u1:dataluminary:trial.expired:2026-07-08T00:00:00.000Z",
    );
  });
});
