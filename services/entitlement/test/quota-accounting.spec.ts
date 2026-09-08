import { EntitlementException } from "../src/common/errors";
import {
  applyGaugeDelta,
  assertMeteringMode,
  parseNonNegativeInt,
  remainingOf,
} from "../src/common/quota-math";
import {
  BLOCKYEDU_PLAN_LIMITS,
  CATALOG,
  STORAGE_BYTE_LIMITS,
  SYNCROBRAIN_PLAN_LIMITS,
  SYNCROBRAIN_TOC_BOOL_FEATURES,
  SYNCROBRAIN_UNGRANTED_FEATURES,
  VISTACAST_PLAN_LIMITS,
  VISTACAST_TOC_BOOL_FEATURES,
  VISTACAST_UNGRANTED_FEATURES,
  VISTAREMOTE_ENTERPRISE_ONLY_FEATURES,
  VISTAREMOTE_PLAN_LIMITS,
} from "../src/database/seed-catalog";

describe("gauge delta math", () => {
  it("treats repeating the same amount as idempotent", () => {
    expect(
      applyGaugeDelta({
        currentUsed: 3n,
        previousAmount: 1n,
        nextAmount: 1n,
        limit: 10n,
      }),
    ).toEqual({ used: 3n, delta: 0n, unchanged: true });
  });

  it("rejects an increase that would exceed the limit and never goes negative", () => {
    expect(
      applyGaugeDelta({
        currentUsed: 1n,
        previousAmount: 0n,
        nextAmount: 2n,
        limit: 3n,
      }),
    ).toEqual({ used: 3n, delta: 2n, unchanged: false });
    try {
      applyGaugeDelta({
        currentUsed: 2n,
        previousAmount: 0n,
        nextAmount: 2n,
        limit: 3n,
      });
      throw new Error("should throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "ENTITLEMENT_QUOTA_EXCEEDED", status: 402 });
    }
    expect(() =>
      applyGaugeDelta({
        currentUsed: 1n,
        previousAmount: 5n,
        nextAmount: 0n,
        limit: 3n,
      }),
    ).toThrow(EntitlementException);
  });

  it("allows lowering an allocation after the plan limit drops below used", () => {
    const next = applyGaugeDelta({
      currentUsed: 5n,
      previousAmount: 5n,
      nextAmount: 2n,
      limit: 3n,
    });
    expect(next).toEqual({ used: 2n, delta: -3n, unchanged: false });
    expect(remainingOf(3, 2)).toBe(1);
    expect(remainingOf(3, 5)).toBe(0);
    expect(() =>
      applyGaugeDelta({
        currentUsed: 5n,
        previousAmount: 0n,
        nextAmount: 1n,
        limit: 3n,
      }),
    ).toThrow(EntitlementException);
  });

  it("parses nonnegative safe integers only", () => {
    expect(parseNonNegativeInt(0)).toBe(0n);
    expect(parseNonNegativeInt("1048576")).toBe(1048576n);
    expect(() => parseNonNegativeInt(-1)).toThrow(EntitlementException);
    expect(() => parseNonNegativeInt(1.5)).toThrow(EntitlementException);
  });

  it("keeps consume on counters and allocate on gauges", () => {
    expect(() => assertMeteringMode("counter", "counter", "sync.run.daily")).not.toThrow();
    expect(() => assertMeteringMode("gauge", "gauge", "dashboard.count")).not.toThrow();
    expect(() => assertMeteringMode("gauge", "counter", "dashboard.count")).toThrow(
      EntitlementException,
    );
    expect(() => assertMeteringMode("counter", "gauge", "sync.run.daily")).toThrow(
      EntitlementException,
    );
  });
});

describe("planned gauge catalog", () => {
  const byCode = (productCode: string) => {
    const product = CATALOG.find((row) => row.code === productCode);
    if (!product) throw new Error(`missing ${productCode}`);
    return {
      product,
      features: new Map(product.features.map((feature) => [feature.code, feature])),
    };
  };

  it("seeds DataLuminary resource/byte gauges and a daily counter", () => {
    const { product, features } = byCode("dataluminary");
    for (const code of [
      "space.count",
      "dashboard.count",
      "dataset.count",
      "sync.task.count",
      "storage.bytes",
      "analytical.storage.bytes",
    ]) {
      expect(features.get(code)).toMatchObject({ kind: "quota", meteringMode: "gauge" });
    }
    expect(features.get("sync.run.daily")).toMatchObject({
      kind: "quota",
      quotaPeriod: "calendar_day",
    });
    expect(features.get("sync.run.daily")?.meteringMode ?? "counter").toBe("counter");
    expect(features.get("analytical.shared_demo")).toMatchObject({ kind: "bool" });
    expect(features.get("analytical.dedicated_service")).toMatchObject({ kind: "bool" });
    const trial = product.plans.find((plan) => plan.code === "trial");
    const pro = product.plans.find((plan) => plan.code === "pro");
    const ultra = product.plans.find((plan) => plan.code === "ultra");
    const enterprise = product.plans.find((plan) => plan.code === "enterprise");
    for (const plan of [trial, pro, ultra, enterprise]) {
      expect(plan?.features.some((row) => row.code === "analytical.shared_demo")).toBe(true);
      expect(plan?.features.some((row) => row.code === "analytical.storage.bytes")).toBe(true);
    }
    expect(trial?.features.some((row) => row.code === "analytical.dedicated_service")).toBe(false);
    expect(pro?.features.some((row) => row.code === "analytical.dedicated_service")).toBe(false);
    expect(ultra?.features.some((row) => row.code === "analytical.dedicated_service")).toBe(false);
    expect(enterprise?.features.some((row) => row.code === "analytical.dedicated_service")).toBe(
      true,
    );
    const ultraDashboard = ultra?.features.find(
      (row) => row.code === "dashboard.count",
    )?.limitValue;
    const proDashboard = pro?.features.find((row) => row.code === "dashboard.count")?.limitValue;
    expect(ultraDashboard).toBeGreaterThan(proDashboard ?? 0);
    expect(product.plans.find((plan) => plan.code === "trial")?.features.length).toBeGreaterThan(0);
  });

  it("seeds VistaRemote device and recording gauges", () => {
    const { product, features } = byCode("vistaremote");
    expect(features.get("device.limit")).toMatchObject({ meteringMode: "gauge" });
    expect(features.get("recording.storage.bytes")).toMatchObject({
      kind: "quota",
      meteringMode: "gauge",
      quotaPeriod: "lifetime",
    });
    const trial = product.plans.find((plan) => plan.code === "trial");
    const pro = product.plans.find((plan) => plan.code === "pro");
    const ultra = product.plans.find((plan) => plan.code === "ultra");
    const enterprise = product.plans.find((plan) => plan.code === "enterprise");
    expect(trial?.features.find((row) => row.code === "device.limit")?.limitValue).toBe(
      VISTAREMOTE_PLAN_LIMITS.trial.devices,
    );
    expect(pro?.features.find((row) => row.code === "device.limit")?.limitValue).toBe(
      VISTAREMOTE_PLAN_LIMITS.pro.devices,
    );
    expect(ultra?.features.find((row) => row.code === "device.limit")?.limitValue).toBe(
      VISTAREMOTE_PLAN_LIMITS.ultra.devices,
    );
    expect(trial?.features.find((row) => row.code === "recording.storage.bytes")?.limitValue).toBe(
      STORAGE_BYTE_LIMITS.vistaremote.recording.trial,
    );
    expect(pro?.features.find((row) => row.code === "recording.storage.bytes")?.limitValue).toBe(
      STORAGE_BYTE_LIMITS.vistaremote.recording.pro,
    );
    expect(ultra?.features.find((row) => row.code === "recording.storage.bytes")?.limitValue).toBe(
      STORAGE_BYTE_LIMITS.vistaremote.recording.ultra,
    );
    for (const plan of [trial, pro, ultra]) {
      for (const code of VISTAREMOTE_ENTERPRISE_ONLY_FEATURES) {
        expect(plan?.features.some((row) => row.code === code)).toBe(false);
      }
    }
    for (const code of VISTAREMOTE_ENTERPRISE_ONLY_FEATURES) {
      expect(enterprise?.features.some((row) => row.code === code)).toBe(true);
    }
    const proCodes = new Set((pro?.features ?? []).map((row) => row.code));
    for (const code of proCodes) {
      expect(ultra?.features.some((row) => row.code === code)).toBe(true);
    }
  });

  it("seeds conservative BlockyEdu gauges and daily code counter", () => {
    const { product, features } = byCode("blockyedu");
    expect(features.get("student.limit")).toMatchObject({ meteringMode: "gauge" });
    expect(features.get("artifact.count")).toMatchObject({ meteringMode: "gauge" });
    expect(features.get("storage.bytes")).toMatchObject({
      kind: "quota",
      meteringMode: "gauge",
      quotaPeriod: "lifetime",
    });
    expect(features.get("code.execute.daily")).toMatchObject({
      kind: "quota",
      quotaPeriod: "calendar_day",
    });
    expect(features.get("ai.agent")).toMatchObject({ kind: "bool" });
    expect(features.get("ai.assessment")).toMatchObject({ kind: "bool" });
    const trial = product.plans.find((plan) => plan.code === "trial");
    const pro = product.plans.find((plan) => plan.code === "pro");
    const ultra = product.plans.find((plan) => plan.code === "ultra");
    expect(trial?.features.find((row) => row.code === "student.limit")?.limitValue).toBe(
      BLOCKYEDU_PLAN_LIMITS.trial.students,
    );
    expect(pro?.features.find((row) => row.code === "student.limit")?.limitValue).toBe(
      BLOCKYEDU_PLAN_LIMITS.pro.students,
    );
    expect(trial?.features.find((row) => row.code === "storage.bytes")?.limitValue).toBe(
      STORAGE_BYTE_LIMITS.blockyedu.object.trial,
    );
    expect(ultra?.features.find((row) => row.code === "ai.tutor")).toBeTruthy();
    expect(pro?.features.find((row) => row.code === "ai.tutor")).toBeUndefined();
    expect(trial?.features.find((row) => row.code === "ai.agent")).toBeUndefined();
    expect(product.trialPolicy).toBe("standard_7d");
  });

  it("keeps voice/API monthly consumption as counters", () => {
    const blocky = byCode("blockyedu").features;
    expect(blocky.get("ai.voice.monthly.seconds")?.meteringMode ?? "counter").toBe("counter");
    expect(blocky.get("student.limit")).toMatchObject({ meteringMode: "gauge" });
    const doerflow = byCode("doerflow").features;
    expect(doerflow.get("api.request.monthly")?.meteringMode ?? "counter").toBe("counter");
    expect(doerflow.get("agent.limit")).toMatchObject({ meteringMode: "gauge" });
  });

  it("does not invent Trial for disabled VistaCast/SyncroBrain placeholders", () => {
    for (const code of ["vistacast", "syncrobrain"] as const) {
      const { product, features } = byCode(code);
      expect(product.trialPolicy).toBe("disabled");
      expect(product.sellable).toBe(false);
      expect(product.plans.some((plan) => plan.code === "trial")).toBe(false);
      const gauge = [...features.values()].find((feature) => feature.meteringMode === "gauge");
      expect(gauge?.kind).toBe("quota");
    }
  });

  it("seeds VistaCast implemented ToC gauges and leaves stub CV ungranted", () => {
    const { product, features } = byCode("vistacast");
    expect(features.get("camera.limit")).toMatchObject({ meteringMode: "gauge" });
    expect(features.get("site.limit")).toMatchObject({ meteringMode: "gauge" });
    expect(features.get("preview.concurrent")).toMatchObject({
      meteringMode: "gauge",
      quotaPeriod: "concurrent",
    });
    expect(features.get("event.retention.days")).toMatchObject({ kind: "quota" });
    expect(features.get("recording.storage.bytes")).toMatchObject({
      meteringMode: "gauge",
      quotaPeriod: "lifetime",
    });
    const pro = product.plans.find((plan) => plan.code === "pro");
    const ultra = product.plans.find((plan) => plan.code === "ultra");
    const enterprise = product.plans.find((plan) => plan.code === "enterprise");
    expect(pro?.features.find((row) => row.code === "camera.limit")?.limitValue).toBe(
      VISTACAST_PLAN_LIMITS.pro.cameras,
    );
    expect(ultra?.features.find((row) => row.code === "camera.limit")?.limitValue).toBe(
      VISTACAST_PLAN_LIMITS.ultra.cameras,
    );
    expect(enterprise?.features.find((row) => row.code === "camera.limit")?.limitValue).toBe(
      VISTACAST_PLAN_LIMITS.enterprise.cameras,
    );
    expect(pro?.features.find((row) => row.code === "site.limit")?.limitValue).toBe(1);
    expect(ultra?.features.find((row) => row.code === "site.limit")?.limitValue).toBe(2);
    expect(pro?.features.find((row) => row.code === "preview.concurrent")?.limitValue).toBe(1);
    expect(ultra?.features.find((row) => row.code === "preview.concurrent")?.limitValue).toBe(2);
    expect(pro?.features.find((row) => row.code === "event.retention.days")?.limitValue).toBe(7);
    expect(ultra?.features.find((row) => row.code === "event.retention.days")?.limitValue).toBe(30);
    expect(pro?.features.find((row) => row.code === "recording.storage.bytes")?.limitValue).toBe(
      STORAGE_BYTE_LIMITS.vistacast.recording.pro,
    );
    expect(ultra?.features.find((row) => row.code === "recording.storage.bytes")?.limitValue).toBe(
      STORAGE_BYTE_LIMITS.vistacast.recording.ultra,
    );
    for (const plan of [pro, ultra, enterprise]) {
      for (const code of VISTACAST_TOC_BOOL_FEATURES) {
        expect(plan?.features.some((row) => row.code === code)).toBe(true);
      }
      for (const code of VISTACAST_UNGRANTED_FEATURES) {
        expect(plan?.features.some((row) => row.code === code)).toBe(false);
      }
    }
  });

  it("seeds SyncroBrain device gauge and daily telemetry counter without ToC HA/DoerFlow", () => {
    const { product, features } = byCode("syncrobrain");
    expect(features.get("device.limit")).toMatchObject({ meteringMode: "gauge" });
    expect(features.get("telemetry.points.daily")).toMatchObject({
      kind: "quota",
      quotaPeriod: "calendar_day",
    });
    expect(features.get("telemetry.retention.days")).toMatchObject({ kind: "quota" });
    const pro = product.plans.find((plan) => plan.code === "pro");
    const ultra = product.plans.find((plan) => plan.code === "ultra");
    expect(pro?.features.find((row) => row.code === "device.limit")?.limitValue).toBe(
      SYNCROBRAIN_PLAN_LIMITS.pro.devices,
    );
    expect(ultra?.features.find((row) => row.code === "device.limit")?.limitValue).toBe(
      SYNCROBRAIN_PLAN_LIMITS.ultra.devices,
    );
    expect(pro?.features.find((row) => row.code === "telemetry.points.daily")?.limitValue).toBe(
      10_000,
    );
    expect(ultra?.features.find((row) => row.code === "telemetry.points.daily")?.limitValue).toBe(
      50_000,
    );
    expect(pro?.features.find((row) => row.code === "telemetry.retention.days")?.limitValue).toBe(7);
    expect(ultra?.features.find((row) => row.code === "telemetry.retention.days")?.limitValue).toBe(
      30,
    );
    for (const plan of product.plans) {
      for (const code of SYNCROBRAIN_TOC_BOOL_FEATURES) {
        expect(plan.features.some((row) => row.code === code)).toBe(true);
      }
      for (const code of SYNCROBRAIN_UNGRANTED_FEATURES) {
        expect(plan.features.some((row) => row.code === code)).toBe(false);
      }
    }
  });
});
