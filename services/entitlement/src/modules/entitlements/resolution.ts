import type {
  MeteringMode,
  PlanCode,
  QuotaMerge,
  QuotaPeriod,
  SubjectKind,
} from "../../common/constants";

export interface ResolveContext {
  subjectKind: SubjectKind;
  subjectId: string;
  productCode: string;
  organizationId?: string | null;
  deploymentId?: string | null;
  asOf?: Date;
}

export interface FeatureSnapshot {
  allowed: boolean;
  sources: string[];
  reason?: string;
}

export interface QuotaSnapshot {
  limit: number | null;
  used: number;
  remaining: number | null;
  period: QuotaPeriod;
  meteringMode: MeteringMode;
  sources: string[];
}

export interface TrialSnapshot {
  active: boolean;
  endsAt: string | null;
  consumed: boolean;
  eligible: boolean;
  /** Active or consumed redemption id for product trial resource registries. */
  trialRedemptionId: string | null;
}

export interface EntitlementSnapshotDto {
  productCode: string;
  subjectKind: SubjectKind;
  subjectId: string;
  organizationId: string | null;
  effectivePlan: PlanCode | "none";
  trial: TrialSnapshot;
  sellable: boolean;
  features: Record<string, FeatureSnapshot>;
  quotas: Record<string, QuotaSnapshot>;
  asOf: string;
}

export interface CheckItem {
  featureCode: string;
  need?: number;
}

export interface CheckResultItem {
  featureCode: string;
  allowed: boolean;
  reason?: string;
  remaining?: number | null;
}

export interface AllocationMutationResult {
  featureCode: string;
  resourceId: string;
  amount: number;
  previousAmount: number;
  used: number;
  remaining: number | null;
  limit: number | null;
  meteringMode: "gauge";
  unchanged: boolean;
  released: boolean;
}

export interface ActiveSource {
  id: string;
  kind: "subscription" | "grant";
  planCode: PlanCode | null;
  source: string;
  sourceRef: string | null;
  features: Record<string, { effect: "allow" | "deny"; limitValue?: number | null }>;
  startsAt: Date;
  endsAt: Date | null;
}

export interface PlanFeatureDef {
  featureCode: string;
  kind: "bool" | "quota";
  effect: "allow" | "deny";
  limitValue: number | null;
  quotaPeriod: QuotaPeriod | null;
  quotaMerge: QuotaMerge;
}

export function pickEffectivePlan(plans: Array<PlanCode | null | undefined>): PlanCode | "none" {
  const priority: Record<string, number> = {
    none: 0,
    trial: 1,
    pro: 2,
    ultra: 3,
    enterprise: 4,
  };
  let best: PlanCode | "none" = "none";
  for (const p of plans) {
    if (!p) continue;
    if ((priority[p] ?? 0) > (priority[best] ?? 0)) best = p;
  }
  return best;
}

export function mergeFeatureMaps(
  sources: ActiveSource[],
  planFeaturesByPlan: Map<PlanCode, PlanFeatureDef[]>,
  catalogQuotas: Map<
    string,
    { period: QuotaPeriod; merge: QuotaMerge; meteringMode?: MeteringMode }
  > = new Map(),
): {
  features: Record<string, FeatureSnapshot>;
  quotas: Record<
    string,
    {
      limit: number | null;
      period: QuotaPeriod;
      merge: QuotaMerge;
      meteringMode: MeteringMode;
      sources: string[];
    }
  >;
} {
  const boolAllow = new Map<string, Set<string>>();
  const boolDeny = new Map<string, Set<string>>();
  const quotaLimits = new Map<
    string,
    {
      limits: number[];
      period: QuotaPeriod;
      merge: QuotaMerge;
      meteringMode: MeteringMode;
      sources: string[];
    }
  >();

  for (const src of sources) {
    const label = `${src.kind}:${src.id}`;
    if (src.planCode) {
      const defs = planFeaturesByPlan.get(src.planCode) ?? [];
      for (const def of defs) {
        applyDef(def, label, boolAllow, boolDeny, quotaLimits, catalogQuotas);
      }
    }
    for (const [code, override] of Object.entries(src.features ?? {})) {
      if (override.limitValue != null) {
        const catalog = catalogQuotas.get(code);
        const existing = quotaLimits.get(code) ?? {
          limits: [],
          period: catalog?.period ?? "lifetime",
          merge: catalog?.merge ?? "max",
          meteringMode: catalog?.meteringMode ?? "counter",
          sources: [],
        };
        existing.limits.push(Number(override.limitValue));
        existing.sources.push(label);
        if (catalog?.period) existing.period = catalog.period;
        if (catalog?.merge) existing.merge = catalog.merge;
        if (catalog?.meteringMode) existing.meteringMode = catalog.meteringMode;
        quotaLimits.set(code, existing);
      } else if (override.effect === "deny") {
        const set = boolDeny.get(code) ?? new Set();
        set.add(label);
        boolDeny.set(code, set);
      } else {
        const set = boolAllow.get(code) ?? new Set();
        set.add(label);
        boolAllow.set(code, set);
      }
    }
  }

  const features: Record<string, FeatureSnapshot> = {};
  const allBool = new Set([...boolAllow.keys(), ...boolDeny.keys()]);
  for (const code of allBool) {
    const denied = boolDeny.get(code);
    if (denied && denied.size > 0) {
      features[code] = {
        allowed: false,
        sources: [...denied],
        reason: "ENTITLEMENT_FEATURE_REQUIRED",
      };
      continue;
    }
    const allowed = boolAllow.get(code);
    features[code] = {
      allowed: Boolean(allowed && allowed.size > 0),
      sources: allowed ? [...allowed] : [],
      reason: allowed && allowed.size > 0 ? undefined : "ENTITLEMENT_FEATURE_REQUIRED",
    };
  }

  const quotas: Record<
    string,
    {
      limit: number | null;
      period: QuotaPeriod;
      merge: QuotaMerge;
      meteringMode: MeteringMode;
      sources: string[];
    }
  > = {};
  for (const [code, q] of quotaLimits) {
    const limit =
      q.merge === "sum"
        ? q.limits.reduce((a, b) => a + b, 0)
        : q.limits.length
          ? Math.max(...q.limits)
          : null;
    quotas[code] = {
      limit,
      period: q.period,
      merge: q.merge,
      meteringMode: q.meteringMode ?? "counter",
      sources: q.sources,
    };
  }

  return { features, quotas };
}

function applyDef(
  def: PlanFeatureDef,
  label: string,
  boolAllow: Map<string, Set<string>>,
  boolDeny: Map<string, Set<string>>,
  quotaLimits: Map<
    string,
    {
      limits: number[];
      period: QuotaPeriod;
      merge: QuotaMerge;
      meteringMode: MeteringMode;
      sources: string[];
    }
  >,
  catalogQuotas: Map<
    string,
    { period: QuotaPeriod; merge: QuotaMerge; meteringMode?: MeteringMode }
  >,
): void {
  if (def.kind === "quota") {
    const catalog = catalogQuotas.get(def.featureCode);
    const existing = quotaLimits.get(def.featureCode) ?? {
      limits: [],
      period: def.quotaPeriod ?? "lifetime",
      merge: def.quotaMerge,
      meteringMode: catalog?.meteringMode ?? "counter",
      sources: [],
    };
    if (def.limitValue != null) existing.limits.push(def.limitValue);
    existing.period = def.quotaPeriod ?? existing.period;
    existing.merge = def.quotaMerge ?? existing.merge;
    if (catalog?.meteringMode) existing.meteringMode = catalog.meteringMode;
    existing.sources.push(label);
    quotaLimits.set(def.featureCode, existing);
    return;
  }
  if (def.effect === "deny") {
    const set = boolDeny.get(def.featureCode) ?? new Set();
    set.add(label);
    boolDeny.set(def.featureCode, set);
  } else {
    const set = boolAllow.get(def.featureCode) ?? new Set();
    set.add(label);
    boolAllow.set(def.featureCode, set);
  }
}

export function isActiveWindow(startsAt: Date, endsAt: Date | null, asOf: Date): boolean {
  if (startsAt.getTime() > asOf.getTime()) return false;
  if (endsAt == null) return true;
  return endsAt.getTime() > asOf.getTime();
}

export function periodKeyFor(period: QuotaPeriod, asOf: Date): string {
  if (period === "lifetime" || period === "concurrent") return "lifetime";
  if (period === "calendar_month") {
    return `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  // calendar_day and rolling_days: UTC day bucket of asOf
  return asOf.toISOString().slice(0, 10);
}
