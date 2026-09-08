import type { MeteringMode, PlanCode, QuotaPeriod, TrialPolicy } from "../common/constants";

export type FeatureSeed = {
  code: string;
  name: string;
  kind: "bool" | "quota";
  quotaPeriod?: QuotaPeriod;
  quotaMerge?: "max" | "sum";
  meteringMode?: MeteringMode;
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
  sellable: boolean;
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

export const DATALUMINARY_ANALYTICAL_FEATURES = {
  sharedDemo: "analytical.shared_demo",
  dedicatedService: "analytical.dedicated_service",
  storageBytes: "analytical.storage.bytes",
} as const;

/**
 * Integration writes stay off ToC (Pro/Ultra) until the commerce path is ready.
 * Enterprise / manual grants may attach them. Do not use deny on Pro — deny would
 * override an Ultra/Enterprise union.
 */
export const DOERFLOW_INTEGRATION_QUOTAS = {
  enterprise: { eventMonthly: 100_000, apiMonthly: 10_000_000 },
} as const;

/** Conservative Hosted ToC gauges/counters. Not market research. */
export const DOERFLOW_PLAN_LIMITS = {
  pro: { agents: 3, taskPublishMonthly: 20, apiRequestMonthly: 5_000 },
  ultra: { agents: 10, taskPublishMonthly: 100, apiRequestMonthly: 20_000 },
  enterprise: { agents: 10_000, taskPublishMonthly: 100_000, apiRequestMonthly: 10_000_000 },
} as const;

/** Implemented ToC capabilities. Do not advertise these on Pro/Ultra checkout. */
export const DOERFLOW_TOC_UNSOLD_FEATURE_CODES = [
  "ai.strategy.run",
  "settlement.merkle_batch",
  "admin.ops.read",
  ...DOERFLOW_INTEGRATION_WRITE_CODES,
] as const;

export const DOERFLOW_TOC_DISPLAY_FEATURE_CODES = [
  "agent.publish",
  "skill.register",
  "task.publish",
  "agent.limit",
  "task.publish.monthly",
  "api.request.monthly",
] as const;

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
  tier: "pro" | "ultra" | keyof typeof DOERFLOW_INTEGRATION_QUOTAS,
) {
  if (tier !== "enterprise") return [];
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

const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

/** Object / analytical storage seeds. Conservative Hosted defaults, not market research. */
export const STORAGE_BYTE_LIMITS = {
  dataluminary: {
    object: {
      trial: 1 * GIB,
      pro: 10 * GIB,
      ultra: 100 * GIB,
      enterprise: 1024 * GIB,
    },
    analytical: {
      trial: 512 * MIB,
      pro: 5 * GIB,
      ultra: 50 * GIB,
      enterprise: 500 * GIB,
    },
  },
  vistaremote: {
    recording: {
      trial: 100 * MIB,
      pro: 1 * GIB,
      ultra: 5 * GIB,
      enterprise: 50 * GIB,
    },
  },
  blockyedu: {
    object: {
      trial: 50 * MIB,
      pro: 50 * MIB,
      ultra: 250 * MIB,
      enterprise: 2 * GIB,
    },
  },
  vistacast: {
    recording: {
      pro: 1 * GIB,
      ultra: 5 * GIB,
      enterprise: 50 * GIB,
    },
  },
} as const;

/**
 * VistaRemote ToC gauges. Trial matches Pro on device.limit.
 * `ai.cloud_infer`, `recording.sfu_server`, and `telemetry.enterprise` stay enterprise/manual only.
 */
export const VISTAREMOTE_PLAN_LIMITS = {
  trial: { devices: 2 },
  pro: { devices: 2 },
  ultra: { devices: 8 },
  enterprise: { devices: 500 },
} as const;

export const VISTAREMOTE_ENTERPRISE_ONLY_FEATURES = [
  "ai.cloud_infer",
  "recording.sfu_server",
  "telemetry.enterprise",
] as const;

/**
 * VistaCast ToC gauges/config. sellable stays false; no Trial plan.
 * Cloud Bridge, face/staff/fall/smoke, and production CV stay ungranted on ToC.
 */
export const VISTACAST_PLAN_LIMITS = {
  pro: { cameras: 2, sites: 1, previewConcurrent: 1, eventRetentionDays: 7 },
  ultra: { cameras: 8, sites: 2, previewConcurrent: 2, eventRetentionDays: 30 },
  enterprise: { cameras: 50, sites: 20, previewConcurrent: 8, eventRetentionDays: 90 },
} as const;

export const VISTACAST_TOC_BOOL_FEATURES = ["visual.event", "preview.p2p"] as const;

export const VISTACAST_UNGRANTED_FEATURES = [
  "cloud.bridge",
  "cv.face",
  "cv.staff",
  "cv.fall",
  "cv.smoke",
  "cv.production",
] as const;

/**
 * SyncroBrain ToC gauges/counters. HA and DoerFlow commerce stay ungranted on ToC.
 * sellable stays false; no Trial plan.
 */
export const SYNCROBRAIN_PLAN_LIMITS = {
  pro: { devices: 5, telemetryPointsDaily: 10_000, telemetryRetentionDays: 7 },
  ultra: { devices: 20, telemetryPointsDaily: 50_000, telemetryRetentionDays: 30 },
  enterprise: { devices: 200, telemetryPointsDaily: 500_000, telemetryRetentionDays: 90 },
} as const;

export const SYNCROBRAIN_TOC_BOOL_FEATURES = ["console", "mqtt"] as const;

export const SYNCROBRAIN_UNGRANTED_FEATURES = ["ha", "doerflow.commerce"] as const;

/** Conservative BlockyEdu gauges. Trial matches Pro; enterprise is a higher configurable default. */
export const BLOCKYEDU_PLAN_LIMITS = {
  trial: { students: 5, artifacts: 10, codeDaily: 20, voiceMonthlySeconds: 600 },
  pro: { students: 5, artifacts: 10, codeDaily: 20, voiceMonthlySeconds: 600 },
  ultra: { students: 20, artifacts: 50, codeDaily: 80, voiceMonthlySeconds: 1800 },
  enterprise: { students: 200, artifacts: 200, codeDaily: 400, voiceMonthlySeconds: 7200 },
} as const;

export const CATALOG: ProductSeed[] = [
  {
    code: "vistaremote",
    name: "VistaRemote",
    trialPolicy: "standard_7d",
    sellable: true,
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
        meteringMode: "gauge",
      },
      {
        code: "recording.storage.bytes",
        name: "Recording storage bytes",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
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
          { code: "device.limit", limitValue: VISTAREMOTE_PLAN_LIMITS.trial.devices },
          {
            code: "recording.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.vistaremote.recording.trial,
          },
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
          { code: "device.limit", limitValue: VISTAREMOTE_PLAN_LIMITS.pro.devices },
          {
            code: "recording.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.vistaremote.recording.pro,
          },
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
          { code: "batch.remote" },
          { code: "device.limit", limitValue: VISTAREMOTE_PLAN_LIMITS.ultra.devices },
          {
            code: "recording.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.vistaremote.recording.ultra,
          },
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
          { code: "device.limit", limitValue: VISTAREMOTE_PLAN_LIMITS.enterprise.devices },
          {
            code: "recording.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.vistaremote.recording.enterprise,
          },
        ],
      },
    ],
  },
  {
    code: "blockyedu",
    name: "BlockyEdu",
    trialPolicy: "standard_7d",
    sellable: true,
    features: [
      { code: "code.execute.pro", name: "Pro code execute", kind: "bool" },
      { code: "ai.copilot", name: "AI copilot", kind: "bool" },
      { code: "ai.tutor", name: "AI tutor", kind: "bool" },
      { code: "ai.voice", name: "AI speaking classroom", kind: "bool" },
      {
        code: "ai.agent",
        name: "AI coding agent (not commercially ready)",
        kind: "bool",
      },
      {
        code: "ai.assessment",
        name: "AI assessment (not commercially ready)",
        kind: "bool",
      },
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
        meteringMode: "gauge",
      },
      {
        code: "artifact.count",
        name: "Artifact count",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: "storage.bytes",
        name: "Object storage bytes",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: "code.execute.daily",
        name: "Daily cloud code runs",
        kind: "quota",
        quotaPeriod: "calendar_day",
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
          {
            code: "ai.voice.monthly.seconds",
            limitValue: BLOCKYEDU_PLAN_LIMITS.trial.voiceMonthlySeconds,
          },
          { code: "student.limit", limitValue: BLOCKYEDU_PLAN_LIMITS.trial.students },
          { code: "artifact.count", limitValue: BLOCKYEDU_PLAN_LIMITS.trial.artifacts },
          { code: "storage.bytes", limitValue: STORAGE_BYTE_LIMITS.blockyedu.object.trial },
          { code: "code.execute.daily", limitValue: BLOCKYEDU_PLAN_LIMITS.trial.codeDaily },
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
          {
            code: "ai.voice.monthly.seconds",
            limitValue: BLOCKYEDU_PLAN_LIMITS.pro.voiceMonthlySeconds,
          },
          { code: "student.limit", limitValue: BLOCKYEDU_PLAN_LIMITS.pro.students },
          { code: "artifact.count", limitValue: BLOCKYEDU_PLAN_LIMITS.pro.artifacts },
          { code: "storage.bytes", limitValue: STORAGE_BYTE_LIMITS.blockyedu.object.pro },
          { code: "code.execute.daily", limitValue: BLOCKYEDU_PLAN_LIMITS.pro.codeDaily },
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
          {
            code: "ai.voice.monthly.seconds",
            limitValue: BLOCKYEDU_PLAN_LIMITS.ultra.voiceMonthlySeconds,
          },
          { code: "student.limit", limitValue: BLOCKYEDU_PLAN_LIMITS.ultra.students },
          { code: "artifact.count", limitValue: BLOCKYEDU_PLAN_LIMITS.ultra.artifacts },
          { code: "storage.bytes", limitValue: STORAGE_BYTE_LIMITS.blockyedu.object.ultra },
          { code: "code.execute.daily", limitValue: BLOCKYEDU_PLAN_LIMITS.ultra.codeDaily },
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
          {
            code: "ai.voice.monthly.seconds",
            limitValue: BLOCKYEDU_PLAN_LIMITS.enterprise.voiceMonthlySeconds,
          },
          { code: "student.limit", limitValue: BLOCKYEDU_PLAN_LIMITS.enterprise.students },
          { code: "artifact.count", limitValue: BLOCKYEDU_PLAN_LIMITS.enterprise.artifacts },
          {
            code: "storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.blockyedu.object.enterprise,
          },
          { code: "code.execute.daily", limitValue: BLOCKYEDU_PLAN_LIMITS.enterprise.codeDaily },
        ],
      },
    ],
  },
  {
    code: "dataluminary",
    name: "DataLuminary",
    trialPolicy: "standard_7d",
    sellable: true,
    features: [
      { code: "dashboard.export", name: "Dashboard export", kind: "bool" },
      { code: "ai.analysis", name: "AI analysis", kind: "bool" },
      {
        code: "space.count",
        name: "Space count",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: "dashboard.count",
        name: "Dashboard count",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: "dataset.count",
        name: "Dataset count",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: "sync.task.count",
        name: "Sync task count",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: "storage.bytes",
        name: "Object storage bytes",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: "analytical.storage.bytes",
        name: "Analytical storage bytes",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: DATALUMINARY_ANALYTICAL_FEATURES.sharedDemo,
        name: "Shared Doris demonstration Pilot",
        kind: "bool",
      },
      {
        code: DATALUMINARY_ANALYTICAL_FEATURES.dedicatedService,
        name: "Dedicated Doris service",
        kind: "bool",
      },
      {
        code: "sync.run.daily",
        name: "Daily sync runs",
        kind: "quota",
        quotaPeriod: "calendar_day",
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
          { code: "space.count", limitValue: 1 },
          { code: "dashboard.count", limitValue: 5 },
          { code: "dataset.count", limitValue: 5 },
          { code: "sync.task.count", limitValue: 2 },
          { code: "storage.bytes", limitValue: STORAGE_BYTE_LIMITS.dataluminary.object.trial },
          {
            code: "analytical.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.dataluminary.analytical.trial,
          },
          { code: DATALUMINARY_ANALYTICAL_FEATURES.sharedDemo },
          { code: "sync.run.daily", limitValue: 50 },
        ],
      },
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "space.count", limitValue: 5 },
          { code: "dashboard.count", limitValue: 50 },
          { code: "dataset.count", limitValue: 50 },
          { code: "sync.task.count", limitValue: 20 },
          { code: "storage.bytes", limitValue: STORAGE_BYTE_LIMITS.dataluminary.object.pro },
          {
            code: "analytical.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.dataluminary.analytical.pro,
          },
          { code: DATALUMINARY_ANALYTICAL_FEATURES.sharedDemo },
          { code: "sync.run.daily", limitValue: 500 },
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "space.count", limitValue: 20 },
          { code: "dashboard.count", limitValue: 200 },
          { code: "dataset.count", limitValue: 200 },
          { code: "sync.task.count", limitValue: 100 },
          { code: "storage.bytes", limitValue: STORAGE_BYTE_LIMITS.dataluminary.object.ultra },
          {
            code: "analytical.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.dataluminary.analytical.ultra,
          },
          { code: DATALUMINARY_ANALYTICAL_FEATURES.sharedDemo },
          { code: "sync.run.daily", limitValue: 5000 },
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "dashboard.export" },
          { code: "ai.analysis" },
          { code: "space.count", limitValue: 200 },
          { code: "dashboard.count", limitValue: 2000 },
          { code: "dataset.count", limitValue: 2000 },
          { code: "sync.task.count", limitValue: 1000 },
          {
            code: "storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.dataluminary.object.enterprise,
          },
          {
            code: "analytical.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.dataluminary.analytical.enterprise,
          },
          { code: DATALUMINARY_ANALYTICAL_FEATURES.sharedDemo },
          { code: DATALUMINARY_ANALYTICAL_FEATURES.dedicatedService },
          { code: "sync.run.daily", limitValue: 50_000 },
        ],
      },
    ],
  },
  {
    code: "doerflow",
    name: "DoerFlow",
    trialPolicy: "disabled",
    sellable: true,
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
        meteringMode: "gauge",
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
          { code: "agent.limit", limitValue: DOERFLOW_PLAN_LIMITS.pro.agents },
          { code: "task.publish.monthly", limitValue: DOERFLOW_PLAN_LIMITS.pro.taskPublishMonthly },
          { code: "api.request.monthly", limitValue: DOERFLOW_PLAN_LIMITS.pro.apiRequestMonthly },
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
          { code: "agent.limit", limitValue: DOERFLOW_PLAN_LIMITS.ultra.agents },
          {
            code: "task.publish.monthly",
            limitValue: DOERFLOW_PLAN_LIMITS.ultra.taskPublishMonthly,
          },
          { code: "api.request.monthly", limitValue: DOERFLOW_PLAN_LIMITS.ultra.apiRequestMonthly },
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
          { code: "agent.limit", limitValue: DOERFLOW_PLAN_LIMITS.enterprise.agents },
          {
            code: "task.publish.monthly",
            limitValue: DOERFLOW_PLAN_LIMITS.enterprise.taskPublishMonthly,
          },
          {
            code: "api.request.monthly",
            limitValue: DOERFLOW_PLAN_LIMITS.enterprise.apiRequestMonthly,
          },
          ...doerflowIntegrationPlanFeatures("enterprise"),
        ],
      },
    ],
  },
  {
    code: "vistacast",
    name: "VistaCast",
    trialPolicy: "disabled",
    sellable: false,
    features: [
      { code: "visual.event", name: "Visual event ingest", kind: "bool" },
      { code: "preview.p2p", name: "On-demand P2P preview", kind: "bool" },
      {
        code: "camera.limit",
        name: "Camera limit",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: "site.limit",
        name: "Site limit",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: "preview.concurrent",
        name: "Concurrent preview sessions",
        kind: "quota",
        quotaPeriod: "concurrent",
        meteringMode: "gauge",
      },
      {
        code: "event.retention.days",
        name: "Event retention days",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
      {
        code: "recording.storage.bytes",
        name: "Event clip and OTA media bytes",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      { code: "cloud.bridge", name: "Cloud Bridge (manual/enterprise)", kind: "bool" },
      { code: "cv.face", name: "Face CV (not commercially granted)", kind: "bool" },
      { code: "cv.staff", name: "Staff CV (not commercially granted)", kind: "bool" },
      { code: "cv.fall", name: "Fall CV (not commercially granted)", kind: "bool" },
      { code: "cv.smoke", name: "Smoke CV (not commercially granted)", kind: "bool" },
      {
        code: "cv.production",
        name: "Production computer vision (not commercially granted)",
        kind: "bool",
      },
    ],
    plans: [
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "visual.event" },
          { code: "preview.p2p" },
          { code: "camera.limit", limitValue: VISTACAST_PLAN_LIMITS.pro.cameras },
          { code: "site.limit", limitValue: VISTACAST_PLAN_LIMITS.pro.sites },
          {
            code: "preview.concurrent",
            limitValue: VISTACAST_PLAN_LIMITS.pro.previewConcurrent,
          },
          {
            code: "event.retention.days",
            limitValue: VISTACAST_PLAN_LIMITS.pro.eventRetentionDays,
          },
          {
            code: "recording.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.vistacast.recording.pro,
          },
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "visual.event" },
          { code: "preview.p2p" },
          { code: "camera.limit", limitValue: VISTACAST_PLAN_LIMITS.ultra.cameras },
          { code: "site.limit", limitValue: VISTACAST_PLAN_LIMITS.ultra.sites },
          {
            code: "preview.concurrent",
            limitValue: VISTACAST_PLAN_LIMITS.ultra.previewConcurrent,
          },
          {
            code: "event.retention.days",
            limitValue: VISTACAST_PLAN_LIMITS.ultra.eventRetentionDays,
          },
          {
            code: "recording.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.vistacast.recording.ultra,
          },
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "visual.event" },
          { code: "preview.p2p" },
          { code: "camera.limit", limitValue: VISTACAST_PLAN_LIMITS.enterprise.cameras },
          { code: "site.limit", limitValue: VISTACAST_PLAN_LIMITS.enterprise.sites },
          {
            code: "preview.concurrent",
            limitValue: VISTACAST_PLAN_LIMITS.enterprise.previewConcurrent,
          },
          {
            code: "event.retention.days",
            limitValue: VISTACAST_PLAN_LIMITS.enterprise.eventRetentionDays,
          },
          {
            code: "recording.storage.bytes",
            limitValue: STORAGE_BYTE_LIMITS.vistacast.recording.enterprise,
          },
        ],
      },
    ],
  },
  {
    code: "syncrobrain",
    name: "SyncroBrain",
    trialPolicy: "disabled",
    sellable: false,
    features: [
      { code: "console", name: "Operator console", kind: "bool" },
      { code: "mqtt", name: "MQTT device ingest", kind: "bool" },
      {
        code: "device.limit",
        name: "Device limit",
        kind: "quota",
        quotaPeriod: "lifetime",
        meteringMode: "gauge",
      },
      {
        code: "telemetry.points.daily",
        name: "Daily telemetry points",
        kind: "quota",
        quotaPeriod: "calendar_day",
      },
      {
        code: "telemetry.retention.days",
        name: "Telemetry retention days",
        kind: "quota",
        quotaPeriod: "lifetime",
      },
      { code: "ha", name: "HA claims (not commercially granted)", kind: "bool" },
      {
        code: "doerflow.commerce",
        name: "DoerFlow commerce (not commercially granted)",
        kind: "bool",
      },
    ],
    plans: [
      {
        code: "pro",
        name: "Pro",
        rank: 2,
        features: [
          { code: "console" },
          { code: "mqtt" },
          { code: "device.limit", limitValue: SYNCROBRAIN_PLAN_LIMITS.pro.devices },
          {
            code: "telemetry.points.daily",
            limitValue: SYNCROBRAIN_PLAN_LIMITS.pro.telemetryPointsDaily,
          },
          {
            code: "telemetry.retention.days",
            limitValue: SYNCROBRAIN_PLAN_LIMITS.pro.telemetryRetentionDays,
          },
        ],
      },
      {
        code: "ultra",
        name: "Ultra",
        rank: 3,
        features: [
          { code: "console" },
          { code: "mqtt" },
          { code: "device.limit", limitValue: SYNCROBRAIN_PLAN_LIMITS.ultra.devices },
          {
            code: "telemetry.points.daily",
            limitValue: SYNCROBRAIN_PLAN_LIMITS.ultra.telemetryPointsDaily,
          },
          {
            code: "telemetry.retention.days",
            limitValue: SYNCROBRAIN_PLAN_LIMITS.ultra.telemetryRetentionDays,
          },
        ],
      },
      {
        code: "enterprise",
        name: "Enterprise",
        rank: 4,
        features: [
          { code: "console" },
          { code: "mqtt" },
          { code: "device.limit", limitValue: SYNCROBRAIN_PLAN_LIMITS.enterprise.devices },
          {
            code: "telemetry.points.daily",
            limitValue: SYNCROBRAIN_PLAN_LIMITS.enterprise.telemetryPointsDaily,
          },
          {
            code: "telemetry.retention.days",
            limitValue: SYNCROBRAIN_PLAN_LIMITS.enterprise.telemetryRetentionDays,
          },
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

export type OfferingSeed = {
  sku: string;
  productCode: string;
  planCode: "pro" | "ultra";
  interval: "month" | "year";
  currency: "CNY" | "USD";
  market: "CN" | "GLOBAL";
  amountMinor: number;
  active: boolean;
};

/** Conservative Hosted list prices in minor units (fen / cents). Not market research. */
export const CONSERVATIVE_OFFERING_PRICES = {
  CNY: {
    pro: { month: 9900, year: 99000 },
    ultra: { month: 19900, year: 199000 },
  },
  USD: {
    pro: { month: 1200, year: 12000 },
    ultra: { month: 2400, year: 24000 },
  },
} as const;

export const SELLABLE_OFFERING_PRODUCT_CODES = [
  "dataluminary",
  "blockyedu",
  "vistaremote",
  "doerflow",
] as const;

export function buildSeedOfferings(
  productCodes: readonly string[] = SELLABLE_OFFERING_PRODUCT_CODES,
): OfferingSeed[] {
  const offerings: OfferingSeed[] = [];
  for (const productCode of productCodes) {
    for (const planCode of ["pro", "ultra"] as const) {
      for (const interval of ["month", "year"] as const) {
        offerings.push(
          {
            sku: `${productCode}.${planCode}.${interval}.CNY`,
            productCode,
            planCode,
            interval,
            currency: "CNY",
            market: "CN",
            amountMinor: CONSERVATIVE_OFFERING_PRICES.CNY[planCode][interval],
            active: true,
          },
          {
            sku: `${productCode}.${planCode}.${interval}.USD`,
            productCode,
            planCode,
            interval,
            currency: "USD",
            market: "GLOBAL",
            amountMinor: CONSERVATIVE_OFFERING_PRICES.USD[planCode][interval],
            active: true,
          },
        );
      }
    }
  }
  return offerings;
}

export const SEED_OFFERINGS = buildSeedOfferings();
