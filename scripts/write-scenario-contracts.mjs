#!/usr/bin/env node
/**
 * Emit UTF-8 (no BOM) contract schemas + CloudEvents samples.
 * Run from repo root: node scripts/write-scenario-contracts.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repoRoot, "deploy", "scenarios", "contracts");

function writeJson(rel, value) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
}

writeJson("schemas/cloudevents-envelope.schema.json", {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://luminaryworks.dev/schemas/cloudevents-envelope.v1.json",
  title: "LuminaryWorks CloudEvents 1.0 envelope (cross-product)",
  type: "object",
  additionalProperties: false,
  required: ["specversion", "id", "source", "type", "time", "datacontenttype", "data"],
  properties: {
    specversion: { const: "1.0" },
    id: { type: "string", minLength: 1 },
    source: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    time: { type: "string", format: "date-time" },
    datacontenttype: { const: "application/json" },
    subject: { type: "string" },
    data: {
      type: "object",
      additionalProperties: false,
      required: ["sourceTenantId", "sourceId", "audience"],
      properties: {
        sourceTenantId: { type: "string", minLength: 1 },
        sourceId: { type: "string", minLength: 1 },
        audience: { enum: ["agent", "human"] },
        severity: { type: "string" },
        summary: { type: "string" },
        budget: { type: "string" },
        callbackUrl: { type: "string" },
        sourceRef: { type: "string" },
        orgId: { type: "string" },
      },
    },
  },
});

writeJson("schemas/hmac-headers.schema.json", {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://luminaryworks.dev/schemas/hmac-headers.v1.json",
  title: "HMAC CloudEvents HTTP headers",
  type: "object",
  additionalProperties: false,
  required: ["Content-Type", "X-DoerFlow-Signature", "X-LW-Timestamp", "X-LW-Nonce"],
  properties: {
    "Content-Type": { const: "application/cloudevents+json" },
    "X-DoerFlow-Signature": {
      type: "string",
      pattern: "^sha256=[0-9a-f]{64}$",
      description: "HMAC-SHA256 of the raw body with the per-peer secret. Hex digest.",
    },
    "X-LW-Timestamp": { type: "string", pattern: "^[0-9]{10}$" },
    "X-LW-Nonce": { type: "string", minLength: 8 },
    traceparent: { type: "string" },
    "x-request-id": { type: "string" },
  },
  description:
    "Senders are implemented in product repos. This schema only freezes the header contract.",
});

writeJson("schemas/http-status-semantics.schema.json", {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://luminaryworks.dev/schemas/http-status-semantics.v1.json",
  title: "401 / 402 / 403 semantics (identity vs entitlement vs Casbin)",
  type: "object",
  additionalProperties: false,
  required: ["401", "402", "403"],
  properties: {
    401: { $ref: "#/$defs/family" },
    402: { $ref: "#/$defs/family" },
    403: { $ref: "#/$defs/family" },
  },
  $defs: {
    family: {
      type: "object",
      required: ["meaning", "layer", "codes"],
      additionalProperties: false,
      properties: {
        meaning: { type: "string" },
        layer: { enum: ["identity", "entitlement", "casbin"] },
        codes: { type: "array", items: { type: "string" }, minItems: 1 },
        not: { type: "string" },
      },
    },
  },
});

writeJson("samples/http-status-semantics.json", {
  401: {
    meaning: "Caller has no valid identity (missing/invalid OIDC, M2M or SIWE).",
    layer: "identity",
    codes: ["UNAUTHORIZED"],
    not: "Do not use 401 for an identified caller who is unpaid or ACL-denied.",
  },
  402: {
    meaning: "Identity is valid but commercial entitlement, quota, seat or license failed.",
    layer: "entitlement",
    codes: [
      "ENTITLEMENT_REQUIRED",
      "ENTITLEMENT_TRIAL_EXPIRED",
      "ENTITLEMENT_FEATURE_REQUIRED",
      "ENTITLEMENT_QUOTA_EXCEEDED",
      "ENTITLEMENT_SEAT_EXHAUSTED",
      "ENTITLEMENT_LICENSE_INVALID",
      "ENTITLEMENT_LICENSE_EXPIRED",
    ],
    not: "Do not collapse unpaid into 403. Upgrade UX reacts only to this family.",
  },
  403: {
    meaning: "Identity and entitlement passed; Casbin denied the resource operation.",
    layer: "casbin",
    codes: ["FORBIDDEN"],
    not: "Do not use 403 to mean 'has not paid' or 'token missing'.",
  },
});

writeJson("schemas/mqtt-planes.schema.json", {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://luminaryworks.dev/schemas/mqtt-planes.v1.json",
  title: "MQTT topic plane separation",
  type: "object",
  additionalProperties: false,
  required: ["deviceTelemetry", "crossProductEvents", "forbidden"],
  properties: {
    deviceTelemetry: { $ref: "#/$defs/plane" },
    crossProductEvents: { $ref: "#/$defs/plane" },
    forbidden: { type: "array", items: { type: "string" } },
  },
  $defs: {
    plane: {
      type: "object",
      required: ["pattern", "writers", "productionIngress"],
      additionalProperties: false,
      properties: {
        pattern: { type: "string" },
        writers: { type: "array", items: { type: "string" } },
        productionIngress: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
});

writeJson("samples/mqtt-planes.json", {
  deviceTelemetry: {
    pattern: "v1/devices/me/telemetry",
    writers: ["device", "thingsboard-simulator"],
    productionIngress: "SyncroBrain / ThingsBoard device MQTT",
    notes: "Never publish VistaCast alert.v1 here.",
  },
  crossProductEvents: {
    pattern: "lw/v1/{tenantId}/{sourceProduct}/{schemaVersion}",
    writers: ["vistacast-control-plane"],
    productionIngress: "signed Webhook; MQTT is optional compatibility",
    notes: "Example: lw/v1/{tenantId}/vistacast/alert.v1. care payloads must not appear.",
  },
  forbidden: [
    "mapping alert.v1 onto ThingsBoard Alarm entities via this bus",
    "command / RPC topics in this version",
    "shared MQTT ACL or certificate PKI across products",
    "browser holding MQTT credentials",
  ],
});

writeJson("schemas/embed-origin-allowlist.schema.json", {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://luminaryworks.dev/schemas/embed-origin-allowlist.v1.json",
  title: "DataLuminary embed origin allowlist",
  type: "object",
  additionalProperties: false,
  required: ["product", "frameAncestors", "browserMustNotHold", "authority"],
  properties: {
    product: { const: "dataluminary" },
    frameAncestors: {
      type: "array",
      minItems: 1,
      items: { type: "string", pattern: "^https://[a-z0-9.-]+(?::[0-9]+)?$" },
    },
    browserMustNotHold: { type: "array", items: { type: "string" } },
    authority: { type: "string" },
  },
});

writeJson("samples/embed-origin-allowlist.json", {
  product: "dataluminary",
  frameAncestors: [
    "https://vistacast.dev",
    "https://syncrobrain.com",
    "https://doerflow.dev",
    "https://remote.vistacast.dev",
  ],
  browserMustNotHold: [
    "rtsp",
    "onvif",
    "thingsboard-token",
    "mqtt-password",
    "wallet-mnemonic",
    "turn-credentials",
  ],
  authority:
    "DataLuminary is an observer (REST export / embed). It is not Safety Kernel, DoerFlow settlement, or source-alert state.",
});

writeJson("schemas/job-authorize-capture-void.schema.json", {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://luminaryworks.dev/schemas/job-authorize-capture-void.v1.json",
  title: "DoerFlow Job authorize / capture / void",
  type: "object",
  additionalProperties: false,
  required: ["owner", "states", "transitions", "callbackMustNot"],
  properties: {
    owner: { const: "doerflow" },
    states: { type: "array", items: { type: "string" } },
    transitions: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "to", "meaning"],
        additionalProperties: false,
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          meaning: { type: "string" },
        },
      },
    },
    callbackMustNot: { type: "array", items: { type: "string" } },
  },
});

writeJson("samples/job-authorize-capture-void.json", {
  owner: "doerflow",
  states: [
    "awaiting_payment",
    "authorized",
    "running",
    "succeeded",
    "captured",
    "voided",
    "failed",
  ],
  transitions: [
    {
      from: "awaiting_payment",
      to: "authorized",
      meaning: "authorize reserves budget + nonce; payee is not credited.",
    },
    {
      from: "authorized",
      to: "captured",
      meaning: "provider 2xx and output hash required before capture/settled.",
    },
    {
      from: "authorized",
      to: "voided",
      meaning: "5xx or timeout voids the authorization; no payee credit.",
    },
  ],
  callbackMustNot: [
    "ack or resolve the source VistaCast alert",
    "close the source SyncroBrain Incident",
    "execute device RPC",
    "treat DataLuminary as settlement authority",
  ],
});

writeJson("schemas/m2m-scopes.schema.json", {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://luminaryworks.dev/schemas/m2m-scopes.v1.json",
  title: "Product M2M scopes for DoerFlow API",
  type: "object",
  additionalProperties: false,
  required: ["audience", "grant", "scopes", "apps", "forbidden"],
  properties: {
    audience: { type: "string" },
    grant: { const: "client_credentials" },
    scopes: { type: "array", items: { type: "string" } },
    apps: { type: "array", items: { type: "object" } },
    forbidden: { type: "array", items: { type: "string" } },
  },
});

writeJson("samples/m2m-scopes.json", {
  audience: "https://api.doerflow.local",
  grant: "client_credentials",
  scopes: [
    "integration.provider.register",
    "integration.event.submit",
    "integration.callback.read",
  ],
  apps: [
    { name: "VistaCast Service", caller: "vistacast", redirectUri: null },
    { name: "SyncroBrain Gateway", caller: "syncrobrain", redirectUri: null },
  ],
  forbidden: [
    "Management API M2M secrets in product repos or browsers",
    "Mixing VistaCast and VistaRemote M2M clients",
    "Treating M2M scopes as proof of payment (Entitlement still applies)",
  ],
});

writeJson("samples/hmac-headers.example.json", {
  "Content-Type": "application/cloudevents+json",
  "X-DoerFlow-Signature": "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "X-LW-Timestamp": "1788660000",
  "X-LW-Nonce": "6f1d0c2e-7a11-4b20-9c33-000000000001",
  traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
  "x-request-id": "req-agent-commerce-example",
});

const envelope = (over) => ({
  specversion: "1.0",
  datacontenttype: "application/json",
  ...over,
});

writeJson(
  "samples/vistacast-alert.cloudevent.json",
  envelope({
    id: "alert-01900000-aaaa-7bbb-8ccc-000000000042",
    source: "https://vistacast.dev/t/tenant-vc",
    type: "com.vistacast.alert.v1",
    time: "2026-09-06T02:00:00.000Z",
    subject: "cam-42",
    data: {
      sourceTenantId: "tenant-vc",
      sourceId: "cam-42",
      severity: "warning",
      summary: "intrusion",
      audience: "agent",
      budget: "10000",
      callbackUrl: "https://vistacast.dev/integrations/doerflow/callbacks",
      sourceRef: "site-7/alert-9",
    },
  }),
);

writeJson(
  "samples/syncrobrain-incident.cloudevent.json",
  envelope({
    id: "incident:inc-1:open",
    source: "https://syncrobrain.com/t/proj-1",
    type: "com.syncrobrain.incident.v1",
    time: "2026-09-06T02:00:05.000Z",
    subject: "inc-1",
    data: {
      sourceTenantId: "proj-1",
      sourceId: "inc-1",
      severity: "CRITICAL",
      summary: "over-temperature",
      audience: "agent",
      budget: "1",
      callbackUrl: "https://syncrobrain.com/integrations/doerflow/callbacks",
      sourceRef: "proj-1:inc-1",
      orgId: "proj-1",
    },
  }),
);

writeJson("schemas/cloudevents-callback.schema.json", {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://luminaryworks.dev/schemas/cloudevents-callback.v1.json",
  title: "DoerFlow outbound callback CloudEvents (illustration; sender is not in this repo)",
  type: "object",
  additionalProperties: false,
  required: ["specversion", "id", "source", "type", "time", "datacontenttype", "data"],
  properties: {
    specversion: { const: "1.0" },
    id: { type: "string", minLength: 1 },
    source: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    time: { type: "string", format: "date-time" },
    datacontenttype: { const: "application/json" },
    subject: { type: "string" },
    data: {
      type: "object",
      additionalProperties: false,
      required: ["sourceTenantId", "sourceRef"],
      properties: {
        eventId: { type: "string" },
        taskId: { type: "string" },
        jobId: { type: "string" },
        status: { type: "string" },
        dispatchStatus: { type: "string" },
        sourceTenantId: { type: "string" },
        sourceRef: { type: "string" },
        correlationId: { type: "string" },
        mode: { const: "manual" },
        deepLink: { type: "string" },
        autoRemoteControl: { const: false },
      },
    },
  },
});

writeJson(
  "samples/doerflow-task-created.cloudevent.json",
  envelope({
    id: "cb-task-1",
    source: "https://doerflow.dev/trading",
    type: "com.doerflow.task.created",
    time: "2026-09-06T02:01:00.000Z",
    subject: "site-7/alert-9",
    data: {
      eventId: "alert-01900000-aaaa-7bbb-8ccc-000000000042",
      taskId: "task-1",
      status: "dispatched",
      dispatchStatus: "dispatched",
      sourceTenantId: "tenant-vc",
      sourceRef: "site-7/alert-9",
      correlationId: "site-7/alert-9",
    },
  }),
);

writeJson(
  "samples/doerflow-job-settled.cloudevent.json",
  envelope({
    id: "cb-job-1",
    source: "https://doerflow.dev/trading",
    type: "com.doerflow.trading.job.settled",
    time: "2026-09-06T02:02:00.000Z",
    subject: "proj-1:inc-1",
    data: {
      jobId: "job-1",
      status: "settled",
      correlationId: "proj-1:inc-1",
      sourceTenantId: "proj-1",
      sourceRef: "proj-1:inc-1",
    },
  }),
);

writeJson(
  "samples/vistaremote-intervention.cloudevent.json",
  envelope({
    id: "vr-session-1",
    source: "https://remote.vistacast.dev/t/tenant-vc",
    type: "com.vistaremote.intervention.v1",
    time: "2026-09-06T02:03:00.000Z",
    subject: "site-7/alert-9",
    data: {
      sourceTenantId: "tenant-vc",
      sourceId: "session-1",
      audience: "human",
      sourceRef: "site-7/alert-9",
      summary: "human-confirmed remote session completed",
    },
  }),
);

writeJson(
  "samples/dataluminary-export.cloudevent.json",
  envelope({
    id: "dl-export-1",
    source: "https://dataluminary.dev/t/tenant-vc",
    type: "com.dataluminary.export.v1",
    time: "2026-09-06T02:04:00.000Z",
    subject: "site-7/alert-9",
    data: {
      sourceTenantId: "tenant-vc",
      sourceId: "export-1",
      audience: "human",
      sourceRef: "site-7/alert-9",
      summary: "export ready for embed",
    },
  }),
);

writeJson(
  "samples/doerflow-intervention-requested.cloudevent.json",
  envelope({
    id: "cb-intervention-1",
    source: "https://doerflow.dev/site",
    type: "com.doerflow.site.intervention.requested.v1",
    time: "2026-09-06T02:02:30.000Z",
    subject: "site-7/alert-9",
    data: {
      eventId: "alert-01900000-aaaa-7bbb-8ccc-000000000042",
      sourceTenantId: "tenant-vc",
      sourceRef: "site-7/alert-9",
      mode: "manual",
      deepLink: "https://remote.vistacast.dev/sessions/new?ref=site-7%2Falert-9&tenant=tenant-vc",
      autoRemoteControl: false,
    },
  }),
);

console.log("wrote UTF-8 (no BOM) contract schemas and samples under deploy/scenarios/contracts");
