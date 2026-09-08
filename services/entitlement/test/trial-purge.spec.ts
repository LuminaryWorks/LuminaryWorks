import { createHmac } from "node:crypto";
import {
  assertTrialPurgeAck,
  missingTrialPurgeTargetError,
  signTrialPurgeRequest,
  trialPurgeSignatureMessage,
} from "../src/modules/notify/trial-purge";

describe("trial.purge signature and ack", () => {
  const payload = {
    eventType: "trial.purge" as const,
    eventId: "evt-1",
    jobId: "job-1",
    trialRedemptionId: "red-1",
    subscriptionId: "sub-1",
    logtoSub: "user-1",
    productCode: "dataluminary",
    startsAt: "2026-09-07T00:00:00.000Z",
    endsAt: "2026-09-14T00:00:00.000Z",
    policyVersion: "lw-legal-v2026-09-07",
    scheduledFor: "2026-09-14T00:00:00.000Z",
  };

  it("signs raw JSON with HMAC-SHA256 timestamp nonce and event/job ids", () => {
    const signed = signTrialPurgeRequest({
      secret: "replace-with-product-secret",
      payload,
      timestamp: "1710000000",
      nonce: "nonce-1",
    });
    const expected = createHmac("sha256", "replace-with-product-secret")
      .update(trialPurgeSignatureMessage("1710000000", "nonce-1", signed.rawBody))
      .digest("base64url");
    expect(signed.headers["x-lw-signature"]).toBe(`v1=${expected}`);
    expect(signed.headers["x-lw-event-id"]).toBe("evt-1");
    expect(signed.headers["x-lw-job-id"]).toBe("job-1");
    expect(JSON.parse(signed.rawBody).eventType).toBe("trial.purge");
  });

  it("accepts documented 2xx ack shape", () => {
    expect(
      assertTrialPurgeAck(200, JSON.stringify({ ok: true, jobId: "job-1", eventId: "evt-1" }), {
        jobId: "job-1",
        eventId: "evt-1",
      }),
    ).toMatchObject({ ok: true });
  });

  it("treats non-2xx and invalid ack as retry", () => {
    expect(() =>
      assertTrialPurgeAck(500, JSON.stringify({ ok: true }), { jobId: "job-1", eventId: "evt-1" }),
    ).toThrow(/HTTP 500/);
    expect(() =>
      assertTrialPurgeAck(200, "not-json", { jobId: "job-1", eventId: "evt-1" }),
    ).toThrow(/not JSON/);
    expect(() =>
      assertTrialPurgeAck(200, JSON.stringify({ ok: false }), { jobId: "job-1", eventId: "evt-1" }),
    ).toThrow(/ok:true/);
    expect(() =>
      assertTrialPurgeAck(200, JSON.stringify({ ok: true, jobId: "other" }), {
        jobId: "job-1",
        eventId: "evt-1",
      }),
    ).toThrow(/jobId mismatch/);
  });

  it("never treats a missing target as success", () => {
    expect(missingTrialPurgeTargetError("dataluminary").message).toMatch(
      /Missing trial purge target/,
    );
  });
});
