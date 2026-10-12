import { describe, expect, it } from "@rstest/core";
import {
  channelCanEnable,
  metadataSaveBody,
  rotateRequestBody,
  testTone,
} from "./channel-ops";
import { buildOrderTimeline } from "./order-timeline";

describe("channel operations", () => {
  it("keeps metadata saves separate from credential rotation", () => {
    expect(metadataSaveBody({ region: "cn" })).toEqual({
      metadata: { region: "cn" },
    });
    expect(rotateRequestBody({})).toBeNull();
    expect(rotateRequestBody({ apiKey: "  " })).toBeNull();
    expect(rotateRequestBody({ apiKey: "new" })).toEqual({
      credentials: { apiKey: "new" },
    });
  });

  it("does not treat a failed or stale test as ready to enable", () => {
    expect(testTone(null)).toBe("none");
    expect(testTone({ ok: false })).toBe("fail");
    expect(testTone({ ok: true })).toBe("ok");
    expect(
      channelCanEnable({
        lastTestOk: false,
        lastTestEnvironment: "sandbox",
        environment: "sandbox",
        lastTestFingerprint: "a",
        credentialFingerprint: "a",
      }),
    ).toBe(false);
    expect(
      channelCanEnable({
        lastTestOk: true,
        lastTestEnvironment: "sandbox",
        environment: "live",
        lastTestFingerprint: "a",
        credentialFingerprint: "a",
      }),
    ).toBe(false);
    expect(
      channelCanEnable({
        lastTestOk: true,
        lastTestEnvironment: "sandbox",
        environment: "sandbox",
        lastTestFingerprint: "old",
        credentialFingerprint: "new",
      }),
    ).toBe(false);
  });
});

describe("order timeline", () => {
  it("places the provider on order, attempt, and refund events", () => {
    expect(
      buildOrderTimeline({
        order: {
          id: "ord",
          status: "failed",
          paymentProvider: "mock",
          createdAt: "t0",
        },
        attempts: [
          { id: "att", status: "failed", provider: "mock", createdAt: "t1" },
        ],
        refunds: [
          { id: "ref", status: "refunded", provider: "mock", createdAt: "t2" },
        ],
      }).map((event) => `${event.kind}:${event.provider}:${event.status}`),
    ).toEqual([
      "order:mock:failed",
      "attempt:mock:failed",
      "refund:mock:refunded",
    ]);
  });
});
