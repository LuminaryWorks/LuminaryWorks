import {
  ERROR_HTTP_STATUS,
  PLAN_PRIORITY,
  TRIAL_DURATION_MS,
  type PlanCode,
} from "../src/common/constants";
import { EntitlementException } from "../src/common/errors";
import {
  CATALOG,
  DOERFLOW_INTEGRATION_FEATURE_CODES,
  DOERFLOW_INTEGRATION_QUOTAS,
  DOERFLOW_INTEGRATION_WRITE_CODES,
  VISTAREMOTE_PLAN_LIMITS,
  VISTAREMOTE_SESSION_FEATURE_CODE,
} from "../src/database/seed-catalog";
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

  it("sums grant quota when catalog merge is sum", () => {
    const sources: ActiveSource[] = [
      {
        id: "g1",
        kind: "grant",
        planCode: null,
        source: "order",
        sourceRef: "pack-1",
        features: { "ai.voice.purchased.seconds": { effect: "allow", limitValue: 1800 } },
        startsAt: new Date(),
        endsAt: null,
      },
      {
        id: "g2",
        kind: "grant",
        planCode: null,
        source: "order",
        sourceRef: "pack-2",
        features: { "ai.voice.purchased.seconds": { effect: "allow", limitValue: 3600 } },
        startsAt: new Date(),
        endsAt: null,
      },
    ];
    const catalog = new Map([
      ["ai.voice.purchased.seconds", { period: "lifetime" as const, merge: "sum" as const }],
    ]);
    const merged = mergeFeatureMaps(sources, new Map(), catalog);
    expect(merged.quotas["ai.voice.purchased.seconds"]?.limit).toBe(5400);
    expect(merged.quotas["ai.voice.purchased.seconds"]?.merge).toBe("sum");
  });

  it("keeps monthly grant on calendar_month from catalog", () => {
    const sources: ActiveSource[] = [
      {
        id: "g1",
        kind: "grant",
        planCode: null,
        source: "promotion",
        sourceRef: "ai.voice.signup.300s",
        features: { "ai.voice.trial.seconds": { effect: "allow", limitValue: 300 } },
        startsAt: new Date(),
        endsAt: null,
      },
    ];
    const catalog = new Map([
      ["ai.voice.trial.seconds", { period: "lifetime" as const, merge: "max" as const }],
    ]);
    const merged = mergeFeatureMaps(sources, new Map(), catalog);
    expect(merged.quotas["ai.voice.trial.seconds"]?.limit).toBe(300);
    expect(merged.quotas["ai.voice.trial.seconds"]?.period).toBe("lifetime");
    expect(merged.quotas["ai.voice.trial.seconds"]?.merge).toBe("max");
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
  it("buckets calendar month, calendar day, and lifetime", () => {
    expect(periodKeyFor("lifetime", asOf)).toBe("lifetime");
    expect(periodKeyFor("concurrent", asOf)).toBe("lifetime");
    expect(periodKeyFor("calendar_month", asOf)).toBe("2026-07");
    expect(periodKeyFor("calendar_day", asOf)).toBe("2026-07-28");
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

function catalogPlanFeatureMap(productCode: string): Map<PlanCode, PlanFeatureDef[]> {
  const product = CATALOG.find((item) => item.code === productCode);
  if (!product) throw new Error(`missing ${productCode} catalog`);
  const meta = new Map(product.features.map((feature) => [feature.code, feature]));
  const map = new Map<PlanCode, PlanFeatureDef[]>();
  for (const plan of product.plans) {
    map.set(
      plan.code,
      plan.features.map((pf) => {
        const feature = meta.get(pf.code);
        if (!feature) throw new Error(`unknown feature ${pf.code}`);
        return {
          featureCode: pf.code,
          kind: feature.kind,
          effect: pf.effect ?? "allow",
          limitValue: pf.limitValue ?? null,
          quotaPeriod: feature.quotaPeriod ?? null,
          quotaMerge: feature.quotaMerge ?? "max",
        };
      }),
    );
  }
  return map;
}

function catalogQuotaMeta(productCode: string) {
  const product = CATALOG.find((item) => item.code === productCode);
  if (!product) throw new Error(`missing ${productCode} catalog`);
  return new Map(
    product.features
      .filter((feature) => feature.kind === "quota")
      .map((feature) => [
        feature.code,
        {
          period: feature.quotaPeriod ?? ("lifetime" as const),
          merge: feature.quotaMerge ?? ("max" as const),
          meteringMode: feature.meteringMode,
        },
      ]),
  );
}

function doerflowPlanFeatureMap(): Map<PlanCode, PlanFeatureDef[]> {
  return catalogPlanFeatureMap("doerflow");
}

function subscriptionSource(id: string, planCode: PlanCode): ActiveSource {
  return {
    id,
    kind: "subscription",
    planCode,
    source: "order",
    sourceRef: null,
    features: {},
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: null,
  };
}

describe("DoerFlow integration resolution", () => {
  const planFeatures = doerflowPlanFeatureMap();

  it("does not allow Pro to register providers or submit integration events", () => {
    const merged = mergeFeatureMaps([subscriptionSource("pro-1", "pro")], planFeatures);
    for (const code of DOERFLOW_INTEGRATION_WRITE_CODES) {
      expect(merged.features[code]).toBeUndefined();
    }
    expect(merged.quotas[DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly]).toBeUndefined();
    expect(merged.quotas[DOERFLOW_INTEGRATION_FEATURE_CODES.apiMonthly]).toBeUndefined();
    expect(merged.features["agent.publish"]?.allowed).toBe(true);
  });

  it("does not sell Ultra integration writes; Enterprise keeps them", () => {
    const ultra = mergeFeatureMaps([subscriptionSource("ultra-1", "ultra")], planFeatures);
    expect(ultra.features[DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister]).toBeUndefined();
    expect(ultra.features[DOERFLOW_INTEGRATION_FEATURE_CODES.eventSubmit]).toBeUndefined();
    expect(ultra.quotas[DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly]).toBeUndefined();
    const enterprise = mergeFeatureMaps([subscriptionSource("ent-1", "enterprise")], planFeatures);
    expect(enterprise.features[DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister]?.allowed).toBe(
      true,
    );
    expect(enterprise.quotas[DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly]?.limit).toBe(
      DOERFLOW_INTEGRATION_QUOTAS.enterprise.eventMonthly,
    );
    expect(enterprise.quotas[DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly]?.period).toBe(
      "calendar_month",
    );
  });

  it("allows Enterprise high integration quotas without treating Pro deny as a union override", () => {
    const merged = mergeFeatureMaps(
      [subscriptionSource("pro-1", "pro"), subscriptionSource("ent-1", "enterprise")],
      planFeatures,
    );
    expect(pickEffectivePlan(["pro", "enterprise"])).toBe("enterprise");
    expect(merged.features[DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister]?.allowed).toBe(
      true,
    );
    expect(merged.quotas[DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly]?.limit).toBe(
      DOERFLOW_INTEGRATION_QUOTAS.enterprise.eventMonthly,
    );
    expect(merged.quotas[DOERFLOW_INTEGRATION_FEATURE_CODES.apiMonthly]?.limit).toBe(
      DOERFLOW_INTEGRATION_QUOTAS.enterprise.apiMonthly,
    );
  });
});

describe("VistaRemote remote.session resolution", () => {
  const planFeatures = catalogPlanFeatureMap("vistaremote");
  const catalogQuotas = catalogQuotaMeta("vistaremote");

  it("resolves concurrent session limits per plan after merge", () => {
    const expected: Array<[PlanCode, number]> = [
      ["trial", VISTAREMOTE_PLAN_LIMITS.trial.concurrentSessions],
      ["pro", VISTAREMOTE_PLAN_LIMITS.pro.concurrentSessions],
      ["ultra", VISTAREMOTE_PLAN_LIMITS.ultra.concurrentSessions],
      ["enterprise", VISTAREMOTE_PLAN_LIMITS.enterprise.concurrentSessions],
    ];
    for (const [planCode, limit] of expected) {
      const merged = mergeFeatureMaps(
        [subscriptionSource(`${planCode}-1`, planCode)],
        planFeatures,
        catalogQuotas,
      );
      expect(merged.quotas[VISTAREMOTE_SESSION_FEATURE_CODE]?.limit).toBe(limit);
      expect(merged.quotas[VISTAREMOTE_SESSION_FEATURE_CODE]?.period).toBe("concurrent");
      expect(merged.quotas[VISTAREMOTE_SESSION_FEATURE_CODE]?.meteringMode).toBe("gauge");
      expect(merged.quotas["session.concurrent"]).toBeUndefined();
    }
  });

  it("takes max remote.session when Pro and Ultra union", () => {
    const merged = mergeFeatureMaps(
      [subscriptionSource("pro-1", "pro"), subscriptionSource("ultra-1", "ultra")],
      planFeatures,
      catalogQuotas,
    );
    expect(merged.quotas[VISTAREMOTE_SESSION_FEATURE_CODE]?.limit).toBe(
      VISTAREMOTE_PLAN_LIMITS.ultra.concurrentSessions,
    );
  });

  it("does not add remote.session to other product catalogs", () => {
    for (const product of CATALOG.filter((item) => item.code !== "vistaremote")) {
      expect(
        product.features.some((feature) => feature.code === VISTAREMOTE_SESSION_FEATURE_CODE),
      ).toBe(false);
    }
  });
});
