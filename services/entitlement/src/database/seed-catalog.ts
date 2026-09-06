import type { PlanCode, QuotaPeriod, TrialPolicy } from "../common/constants";

export type FeatureSeed = {
  code: string;
  name: string;
  kind: "bool" | "quota";
  quotaPeriod?: QuotaPeriod;
  quotaMerge?: "max" | "sum";
};

export type PlanSeed = {
  code: PlanCode;
  name: string;
  rank: number;
  features: Array<{
    code: string;
    effect?: "allow" | "deny";
    limitValue?: number;
  }>;
};

export type ProductSeed = {
  code: string;
  name: string;
  trialPolicy: TrialPolicy;
  features: FeatureSeed[];
  plans: PlanSeed[];
};

/** Cross-product commerce gates on DoerFlow. Not protocol fee / Escrow / Gas. */
export const DOERFLOW_INTEGRATION_FEATURE_CODES = {
  providerRegister: "integration.provider.register",
  eventSubmit: "integration.event.submit",
  eventMonthly: "integration.event.monthly",
  apiMonthly: "integration.api.monthly",
} as const;

export const DOERFLOW_INTEGRATION_WRITE_CODES = [
  DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister,
  DOERFLOW_INTEGRATION_FEATURE_CODES.eventSubmit,
] as const;

/**
 * Pro omits write features (do not use deny — deny would override Ultra/Enterprise union).
 * Ultra = modest production start; Enterprise = high volume.
 */
export const DOERFLOW_INTEGRATION_QUOTAS = {
  ultra: { eventMonthly: 10_000, apiMonthly: 100_000 },
  enterprise: { eventMonthly: 100_000, apiMonthly: 10_000_000 },
} as const;

const DOERFLOW_INTEGRATION_FEATURES: FeatureSeed[] = [
  {
    code: DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister,
    name: "Register integration providers",
    kind: "bool",
  },
  {
    code: DOERFLOW_INTEGRATION_FEATURE_CODES.eventSubmit,
    name: "Submit integration events",
    kind: "bool",
  },
  {
    code: DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly,
    name: "Monthly integration events",
    kind: "quota",
    quotaPeriod: "calendar_month",
  },
  {
    code: DOERFLOW_INTEGRATION_FEATURE_CODES.apiMonthly,
    name: "Monthly integration API requests",
    kind: "quota",
    quotaPeriod: "calendar_month",
  },
];

export function doerflowIntegrationPlanFeatures(
  tier: "pro" | keyof typeof DOERFLOW_INTEGRATION_QUOTAS,
) {
  if (tier === "pro") return [];
  const quotas = DOERFLOW_INTEGRATION_QUOTAS[tier];
  return [
    { code: DOERFLOW_INTEGRATION_FEATURE_CODES.providerRegister },
    { code: DOERFLOW_INTEGRATION_FEATURE_CODES.eventSubmit },
    {
      code: DOERFLOW_INTEGRATION_FEATURE_CODES.eventMonthly,
      limitValue: quotas.eventMonthly,
    },
    {
      code: DOERFLOW_INTEGRATION_FEATURE_CODES.apiMonthly,
      limitValue: quotas.apiMonthly,
    },
  ];
}

export const CATALOG: ProductSeed[] = [
  {
    code: "vistaremote",
    name: "VistaRemote",
    trialPolicy: "standard_7d",
    features: [
      { code: "webrtc.sfu", name: "WebRTC SFU", kind: "bool" },
      { code: "recording", name: "Recording", kind: "bool" },
      {
        code: "ai.recording_summarize",
        name: "AI recording summarize",
        kind: "bool",
      },
      { code: "ai.cloud_infer", name: "AI cloud infer", kind: "bool" },
      {
        code: "recording.sfu_server",
        name: "SFU server recording",
        kind: "bool",
      },
      {
        code: "telemetry.enterprise",
        name: "Enterprise telemetry",
        kind: "bool",
      },
      {
        code: "batch.remote",
        name: "Batch remote control",
        kind: "bool",
      },
      {
        code: "device.limit",
        name: "Device limit",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
    ],
    plans: [
      {
        code: "trial",
        name: "Trial",
        rank: 1,
        features: [
          { code: "webrtc.sfu" },
          { code: "recording" },
          { code: "ai.recording_summarize" },
          { code: "batch.remote" },
          { code: "device.limit", limitValue: 3 },
        ],
      },
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "webrtc.sfu" },
          { code: "recording" },
          { code: "ai.recording_summarize" },
          { code: "batch.remote" },
          { code: "device.limit", limitValue: 10 },
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "webrtc.sfu" },
          { code: "recording" },
          { code: "ai.recording_summarize" },
          { code: "ai.cloud_infer" },
          { code: "recording.sfu_server" },
          { code: "batch.remote" },
          { code: "device.limit", limitValue: 50 },
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "webrtc.sfu" },
          { code: "recording" },
          { code: "ai.recording_summarize" },
          { code: "ai.cloud_infer" },
          { code: "recording.sfu_server" },
          { code: "telemetry.enterprise" },
          { code: "batch.remote" },
          { code: "device.limit", limitValue: 500 },
        ],
      },
    ],
  },
  {
    code: "blockyedu",
    name: "BlockyEdu",
    trialPolicy: "standard_7d",
    features: [
      { code: "code.execute.pro", name: "Pro code execute", kind: "bool" },
      { code: "ai.copilot", name: "AI copilot", kind: "bool" },
      { code: "ai.tutor", name: "AI tutor", kind: "bool" },
      { code: "ai.voice", name: "AI speaking classroom", kind: "bool" },
      {
        code: "ai.voice.trial.seconds",
        name: "Speaking trial seconds",
        kind: "quota",
        quotaPeriod: "lifetime",
        quotaMerge: "max",
      },
      {
        code: "ai.voice.monthly.seconds",
        name: "Speaking monthly seconds",
        kind: "quota",
        quotaPeriod: "calendar_month",
        quotaMerge: "max",
      },
      {
        code: "ai.voice.purchased.seconds",
        name: "Speaking purchased seconds",
        kind: "quota",
        quotaPeriod: "lifetime",
        quotaMerge: "sum",
      },
      {
        code: "student.limit",
        name: "Student seats",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
    ],
    plans: [
      {
        code: "trial",
        name: "Trial",
        rank: 1,
        features: [
          { code: "code.execute.pro" },
          { code: "ai.copilot" },
          { code: "ai.voice" },
          { code: "student.limit", limitValue: 30 },
        ],
      },
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "code.execute.pro" },
          { code: "ai.copilot" },
          { code: "ai.voice" },
          { code: "ai.voice.monthly.seconds", limitValue: 1800 },
          { code: "student.limit", limitValue: 100 },
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "code.execute.pro" },
          { code: "ai.copilot" },
          { code: "ai.tutor" },
          { code: "ai.voice" },
          { code: "ai.voice.monthly.seconds", limitValue: 1800 },
          { code: "student.limit", limitValue: 500 },
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "code.execute.pro" },
          { code: "ai.copilot" },
          { code: "ai.tutor" },
          { code: "ai.voice" },
          { code: "ai.voice.monthly.seconds", limitValue: 1800 },
          { code: "student.limit", limitValue: 5000 },
        ],
      },
    ],
  },
  {
    code: "dataluminary",
    name: "DataLuminary",
    trialPolicy: "standard_7d",
    features: [
      { code: "dashboard.export", name: "Dashboard export", kind: "bool" },
      { code: "ai.analysis", name: "AI analysis", kind: "bool" },
      {
        code: "storage.bytes",
        name: "Storage bytes",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
      {
        code: "dashboard.count",
        name: "Dashboard count",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
    ],
    plans: [
      {
        code: "trial",
        name: "Trial",
        rank: 1,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "dashboard.count", limitValue: 5 },
          { code: "storage.bytes", limitValue: 1_073_741_824 },
        ],
      },
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "dashboard.count", limitValue: 50 },
          { code: "storage.bytes", limitValue: 10_737_418_240 },
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "dashboard.count", limitValue: 200 },
          { code: "storage.bytes", limitValue: 107_374_182_400 },
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "dashboard.count", limitValue: 2000 },
          { code: "storage.bytes", limitValue: 1_099_511_627_776 },
        ],
      },
    ],
  },
  {
    code: "doerflow",
    name: "DoerFlow",
    trialPolicy: "disabled",
    features: [
      { code: "agent.publish", name: "Publish agents", kind: "bool" },
      { code: "skill.register", name: "Register skills", kind: "bool" },
      { code: "task.publish", name: "Publish tasks", kind: "bool" },
      { code: "ai.strategy.run", name: "Run AI strategies", kind: "bool" },
      {
        code: "settlement.merkle_batch",
        name: "Merkle batch settlement",
        kind: "bool",
      },
      { code: "admin.ops.read", name: "Read platform operations", kind: "bool" },
      {
        code: "agent.limit",
        name: "Published agent limit",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
      {
        code: "task.publish.monthly",
        name: "Monthly task publications",
        kind: "quota",
        quotaPeriod: "calendar_month",
      },
      {
        code: "api.request.monthly",
        name: "Monthly API requests",
        kind: "quota",
        quotaPeriod: "calendar_month",
      },
      ...DOERFLOW_INTEGRATION_FEATURES,
    ],
    plans: [
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "agent.publish" },
          { code: "skill.register" },
          { code: "task.publish" },
          { code: "agent.limit", limitValue: 10 },
          { code: "task.publish.monthly", limitValue: 100 },
          { code: "api.request.monthly", limitValue: 10_000 },
          ...doerflowIntegrationPlanFeatures("pro"),
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "agent.publish" },
          { code: "skill.register" },
          { code: "task.publish" },
          { code: "ai.strategy.run" },
          { code: "settlement.merkle_batch" },
          { code: "agent.limit", limitValue: 100 },
          { code: "task.publish.monthly", limitValue: 1_000 },
          { code: "api.request.monthly", limitValue: 100_000 },
          ...doerflowIntegrationPlanFeatures("ultra"),
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "agent.publish" },
          { code: "skill.register" },
          { code: "task.publish" },
          { code: "ai.strategy.run" },
          { code: "settlement.merkle_batch" },
          { code: "admin.ops.read" },
          { code: "agent.limit", limitValue: 10_000 },
          { code: "task.publish.monthly", limitValue: 100_000 },
          { code: "api.request.monthly", limitValue: 10_000_000 },
          ...doerflowIntegrationPlanFeatures("enterprise"),
        ],
      },
    ],
  },
];

export const SAMPLE_BUNDLE = {
  sku: "luminary_pro_bundle",
  name: "Luminary Pro Bundle",
  productCodes: ["dataluminary", "blockyedu", "vistaremote"] as const,
  planCode: "pro" as const,
};
