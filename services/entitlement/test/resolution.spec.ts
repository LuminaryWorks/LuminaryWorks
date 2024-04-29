import { ERROR_HTTP_STATUS, PLAN_PRIORITY, TRIAL_DURATION_MS } from "../src/common/constants";
import { EntitlementException } from "../src/common/errors";
import {
  type ActiveSource,
  isActiveWindow,
  mergeFeatureMaps,
  type PlanFeatureDef,
  periodKeyFor,
  pickEffectivePlan,
} from "../src/modules/entitlements/resolution";

describe("pickEffectivePlan", () => {
  it("prefers enterprise > ultra > pro > trial > none", () => {
    expect(pickEffectivePlan(["trial", "pro"])).toBe("pro");
    expect(pickEffectivePlan(["ultra", "enterprise", "pro"])).toBe("enterprise");
    expect(pickEffectivePlan([])).toBe("none");
    expect(pickEffectivePlan([null, undefined])).toBe("none");
  });

  it("matches PLAN_PRIORITY ordering", () => {
    const ordered = Object.entries(PLAN_PRIORITY)
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k);
    expect(ordered).toEqual(["none", "trial", "pro", "ultra", "enterprise"]);
  });
});

describe("isActiveWindow", () => {
  const t0 = new Date("2026-07-01T00:00:00.000Z");
  const t1 = new Date("2026-07-08T00:00:00.000Z");
  const mid = new Date("2026-07-04T12:00:00.000Z");

  it("includes startsAt and excludes endsAt", () => {
    expect(isActiveWindow(t0, t1, mid)).toBe(true);
    expect(isActiveWindow(t0, t1, t0)).toBe(true);
    expect(isActiveWindow(t0, t1, t1)).toBe(false);
  });

  it("treats null endsAt as open-ended", () => {
    expect(isActiveWindow(t0, null, new Date("2030-01-01T00:00:00.000Z"))).toBe(true);
  });
});

describe("mergeFeatureMaps", () => {
  const planFeatures = new Map<string, PlanFeatureDef[]>([
    [
      "pro",
      [
        {
          featureCode: "webrtc.sfu",
          kind: "bool",
          effect: "allow",
          limitValue: null,
          quotaPeriod: null,
          quotaMerge: "max",
        },
        {
          featureCode: "device.limit",
          kind: "quota",
          effect: "allow",
          limitValue: 10,
          quotaPeriod: "lifetime",
          quotaMerge: "max",
        },
      ],
    ],
    [
      "ultra",
      [
        {
          featureCode: "webrtc.sfu",
          kind: "bool",
          effect: "allow",
          limitValue: null,
          quotaPeriod: null,
          quotaMerge: "max",
        },
        {
          featureCode: "ai.cloud_infer",
          kind: "bool",
          effect: "allow",
          limitValue: null,
          quotaPeriod: null,
          quotaMerge: "max",
        },
        {
          featureCode: "device.limit",
          kind: "quota",
          effect: "allow",
          limitValue: 50,
          quotaPeriod: "lifetime",
          quotaMerge: "max",
        },
      ],
    ],
  ]);

  it("unions bool features and takes max quota by default", () => {
    const sources: ActiveSource[] = [
      {
        id: "s1",
        kind: "subscription",
        planCode: "pro",
        source: "order",
        sourceRef: null,
        features: {},
        startsAt: new Date(),
        endsAt: null,
      },
      {
        id: "s2",
        kind: "subscription",
        planCode: "ultra",
        source: "order",
        sourceRef: null,
        features: {},
        startsAt: new Date(),
        endsAt: null,
      },
    ];
    const merged = mergeFeatureMaps(sources, planFeatures as never);
    expect(merged.features["webrtc.sfu"]?.allowed).toBe(true);
    expect(merged.features["ai.cloud_infer"]?.allowed).toBe(true);
    expect(merged.quotas["device.limit"]?.limit).toBe(50);
  });

  it("lets deny override allow", () => {
    const sources: ActiveSource[] = [
      {
        id: "g1",
        kind: "grant",
        planCode: null,
        source: "manual",
        sourceRef: null,
        features: {
          "webrtc.sfu": { effect: "allow" },
        },
        startsAt: new Date(),
        endsAt: null,
      },
      {
        id: "g2",
        kind: "grant",
        planCode: null,
        source: "manual",
        sourceRef: null,
        features: {
          "webrtc.sfu": { effect: "deny" },
        },
        startsAt: new Date(),
        endsAt: null,
      },
    ];
    const merged = mergeFeatureMaps(sources, new Map());
    expect(merged.features["webrtc.sfu"]?.allowed).toBe(false);
    expect(merged.features["webrtc.sfu"]?.reason).toBe("ENTITLEMENT_FEATURE_REQUIRED");
  });
});

describe("periodKeyFor", () => {
  const asOf = new Date("2026-07-28T15:00:00.000Z");
  it("buckets calendar month and lifetime", () => {
    expect(periodKeyFor("lifetime", asOf)).toBe("lifetime");
    expect(periodKeyFor("concurrent", asOf)).toBe("lifetime");
    expect(periodKeyFor("calendar_month", asOf)).toBe("2026-07");
    expect(periodKeyFor("rolling_days", asOf)).toBe("2026-07-28");
  });
});

describe("EntitlementException", () => {
  it("maps stable codes to HTTP status", () => {
    const ex = new EntitlementException("ENTITLEMENT_QUOTA_EXCEEDED", "Quota exceeded", {
      productCode: "vistaremote",
      featureCode: "device.limit",
    });
    expect(ex.getStatus()).toBe(402);
    expect(ERROR_HTTP_STATUS.ENTITLEMENT_QUOTA_EXCEEDED).toBe(402);
    const body = ex.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe("ENTITLEMENT_QUOTA_EXCEEDED");
  });
});

describe("trial duration", () => {
  it("is 7 days", () => {
    expect(TRIAL_DURATION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("trial expired denial reason", () => {
  function denialReason(snapshot: {
    trial: { active: boolean; consumed: boolean };
    effectivePlan: string;
  }): string {
    if (snapshot.trial.consumed && !snapshot.trial.active && snapshot.effectivePlan === "none") {
      return "ENTITLEMENT_TRIAL_EXPIRED";
    }
    if (snapshot.effectivePlan === "none") return "ENTITLEMENT_REQUIRED";
    return "ENTITLEMENT_FEATURE_REQUIRED";
  }

  it("maps expired trial with no plan to ENTITLEMENT_TRIAL_EXPIRED", () => {
    expect(
      denialReason({
        trial: { active: false, consumed: true },
        effectivePlan: "none",
      }),
    ).toBe("ENTITLEMENT_TRIAL_EXPIRED");
  });

  it("keeps ENTITLEMENT_REQUIRED when trial never consumed", () => {
    expect(
      denialReason({
        trial: { active: false, consumed: false },
        effectivePlan: "none",
      }),
    ).toBe("ENTITLEMENT_REQUIRED");
  });
});
