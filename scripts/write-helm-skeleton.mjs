#!/usr/bin/env node
/**
 * Emit Helm chart skeletons. Charts are gated on Compose acceptance.
 * Run: node scripts/write-helm-skeleton.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const helmRoot = join(repoRoot, "deploy", "helm");

export const PRODUCT_CHARTS = [
  "dataluminary",
  "blockyedu",
  "doerflow",
  "vistacast",
  "vistaremote",
  "syncrobrain",
  "control-plane",
];

const valuesSchema = {
  $schema: "https://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: true,
  required: ["global", "database", "existingSecret", "networkPolicy", "persistence", "migration"],
  properties: {
    global: {
      type: "object",
      description: "Shared non-secret topology. Must not contain database passwords.",
      additionalProperties: false,
      properties: {
        domain: { type: "string" },
        imageRegistry: { type: "string" },
        storageClass: { type: "string" },
        controlPlane: {
          type: "object",
          additionalProperties: false,
          properties: {
            identity: { type: "string" },
            authGateway: { type: "string" },
            entitlement: { type: "string" },
          },
        },
      },
    },
    database: {
      type: "object",
      additionalProperties: false,
      required: ["external"],
      properties: {
        external: { type: "boolean" },
        host: { type: "string" },
        port: { type: "integer" },
        name: { type: "string" },
        existingSecret: { type: "string", description: "Secret with username/password keys" },
      },
    },
    existingSecret: {
      type: "string",
      description:
        "Optional existing Secret for app credentials; empty means chart does not create one.",
    },
    networkPolicy: {
      type: "object",
      required: ["enabled"],
      properties: { enabled: { type: "boolean" } },
    },
    persistence: {
      type: "object",
      required: ["retain"],
      properties: {
        enabled: { type: "boolean" },
        storageClass: { type: "string" },
        size: { type: "string" },
        retain: {
          type: "boolean",
          description: "When true, helm uninstall keeps the PVC (resource-policy keep).",
        },
      },
    },
    migration: {
      type: "object",
      required: ["preUpgradeJob"],
      properties: {
        preUpgradeJob: {
          type: "object",
          required: ["enabled"],
          properties: {
            enabled: { type: "boolean" },
            image: { type: "string" },
          },
        },
      },
    },
  },
};

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents.endsWith("\n") ? contents : `${contents}\n`, { encoding: "utf8" });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
}

function helpersTpl(name) {
  return `{{- define "${name}.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "${name}.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- define "${name}.labels" -}}
app.kubernetes.io/name: {{ include "${name}.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
luminaryworks.dev/gated: compose-acceptance
{{- end }}
`;
}

function gatedResources(name) {
  return `{{- /*
Scaffold only. No product Deployment is rendered until Compose acceptance
(standalone + agent-commerce + smart-site) has passed. NetworkPolicy and the
idempotent pre-upgrade migration Job can be enabled independently.
*/ -}}
{{- if .Values.networkPolicy.enabled }}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "${name}.fullname" . }}
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: {{ include "${name}.name" . }}
  policyTypes:
    - Ingress
    - Egress
{{- end }}
{{- if .Values.migration.preUpgradeJob.enabled }}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "${name}.fullname" . }}-migrate
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-upgrade
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: {{ .Values.migration.preUpgradeJob.image | default "busybox:1.36" | quote }}
          command: ["sh", "-c", "echo idempotent-pre-upgrade-migrate; exit 0"]
{{- end }}
`;
}

function notes(_name) {
  return `LuminaryWorks chart "{{ .Chart.Name }}" is a scaffold.

Production enablement is gated on Compose acceptance:

  1. product standalone
  2. deploy/scenarios/agent-commerce
  3. deploy/scenarios/smart-site

global contains only domain / registry / storageClass / control-plane endpoints.
Database passwords must come from existingSecret — never from global.
`;
}

function valuesYaml(name) {
  return `# Scaffold values. Do not put shared DB passwords in global.
global:
  domain: luminaryworks.dev
  imageRegistry: ghcr.io/luminaryworks
  storageClass: ""
  controlPlane:
    identity: http://identity:3001/oidc
    authGateway: http://auth-gateway:3010
    entitlement: http://entitlement:3040

database:
  external: false
  host: ""
  port: 5432
  name: ${name.replace(/-/g, "_")}
  existingSecret: ""

existingSecret: ""

networkPolicy:
  enabled: false

persistence:
  enabled: false
  storageClass: ""
  size: 10Gi
  retain: true

migration:
  preUpgradeJob:
    enabled: false
    image: busybox:1.36

nameOverride: ""
fullnameOverride: ""
`;
}

for (const name of PRODUCT_CHARTS) {
  const dir = join(helmRoot, name);
  write(
    join(dir, "Chart.yaml"),
    `apiVersion: v2
name: ${name}
description: LuminaryWorks ${name} plane (scaffold — gated on Compose acceptance)
type: application
version: 0.0.1
appVersion: "0.0.0"
annotations:
  luminaryworks.dev/gated: compose-acceptance
`,
  );
  write(join(dir, "values.yaml"), valuesYaml(name));
  writeJson(join(dir, "values.schema.json"), valuesSchema);
  write(join(dir, "templates/_helpers.tpl"), helpersTpl(name));
  write(join(dir, "templates/gated-resources.yaml"), gatedResources(name));
  write(join(dir, "templates/NOTES.txt"), notes(name));
  write(
    join(dir, ".helmignore"),
    `.DS_Store
*.md
*.tgz
`,
  );
}

const umbrellaValues = {
  $schema: "https://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["global", "components"],
  additionalProperties: true,
  properties: {
    global: valuesSchema.properties.global,
    components: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        PRODUCT_CHARTS.map((name) => {
          const key = name === "control-plane" ? "controlPlane" : name;
          return [key, { type: "object", properties: { enabled: { type: "boolean" } } }];
        }),
      ),
    },
  },
};

write(
  join(helmRoot, "luminaryworks", "Chart.yaml"),
  `apiVersion: v2
name: luminaryworks
description: Umbrella chart — enable product planes via components.<product>.enabled only
type: application
version: 0.0.1
appVersion: "0.0.0"
annotations:
  luminaryworks.dev/gated: compose-acceptance
dependencies:
  - name: control-plane
    version: 0.0.1
    repository: "file://../control-plane"
    condition: components.controlPlane.enabled
  - name: vistacast
    version: 0.0.1
    repository: "file://../vistacast"
    condition: components.vistacast.enabled
  - name: syncrobrain
    version: 0.0.1
    repository: "file://../syncrobrain"
    condition: components.syncrobrain.enabled
  - name: doerflow
    version: 0.0.1
    repository: "file://../doerflow"
    condition: components.doerflow.enabled
  - name: vistaremote
    version: 0.0.1
    repository: "file://../vistaremote"
    condition: components.vistaremote.enabled
  - name: dataluminary
    version: 0.0.1
    repository: "file://../dataluminary"
    condition: components.dataluminary.enabled
  - name: blockyedu
    version: 0.0.1
    repository: "file://../blockyedu"
    condition: components.blockyedu.enabled
`,
);

write(
  join(helmRoot, "luminaryworks", "values.yaml"),
  `# Umbrella values. global has no shared database passwords.
global:
  domain: luminaryworks.dev
  imageRegistry: ghcr.io/luminaryworks
  storageClass: ""
  controlPlane:
    identity: http://identity:3001/oidc
    authGateway: http://auth-gateway:3010
    entitlement: http://entitlement:3040

components:
  controlPlane:
    enabled: false
  vistacast:
    enabled: false
  syncrobrain:
    enabled: false
  doerflow:
    enabled: false
  vistaremote:
    enabled: false
  dataluminary:
    enabled: false
  blockyedu:
    enabled: false
`,
);

writeJson(join(helmRoot, "luminaryworks", "values.schema.json"), umbrellaValues);
write(
  join(helmRoot, "luminaryworks", "templates/NOTES.txt"),
  `LuminaryWorks umbrella.

Enable planes with components.<product>.enabled only.
Production use is gated on standalone + agent-commerce + smart-site Compose acceptance.
`,
);
write(
  join(helmRoot, "luminaryworks", "templates/_helpers.tpl"),
  `{{- define "luminaryworks.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
`,
);
write(
  join(helmRoot, "luminaryworks", ".helmignore"),
  `.DS_Store
*.md
*.tgz
charts/
`,
);

write(
  join(helmRoot, "README.md"),
  `# LuminaryWorks Helm (scaffold)

Charts exist so a **future** mapping from Compose profiles can start after Compose
combination delivery. They are **not** the current delivery path and are **not**
production-ready.

## Current path

Daily work and combination demos use **Compose only**. **Helm CLI is not required.**
Do not install Helm to work on this repo. Kubernetes is a later mapping, not a
current gate. \`pnpm helm:template\` records a skip and exits 0 when \`helm\` is missing.

## Gate (later)

Do not enable these charts in production until §11.1–§11.2 in
\`spec/composable-deployment.md\` have passed. Backup / N-1 / six-product full-stack
up are §11.3 later gates on the Compose path — not a reason to switch to Helm.

## Layout

| Chart | Role |
|---|---|
| \`control-plane\` / six product charts | Independent planes (no Deployments rendered yet) |
| \`luminaryworks\` | Umbrella: **only** \`components.<product>.enabled\` (plus \`components.controlPlane.enabled\`) |

\`global\` is limited to:

- domain
- image registry
- storageClass
- control-plane endpoints (identity / auth-gateway / entitlement)

**No shared database passwords** belong in \`global\`. Per-chart \`database.external\`,
\`database.existingSecret\`, \`existingSecret\`, \`networkPolicy.enabled\`,
\`persistence.retain\` and \`migration.preUpgradeJob\` are in each chart's
\`values.schema.json\`.

## Template (optional)

\`\`\`bash
pnpm helm:template          # skip-ok when helm is missing
helm template doerflow deploy/helm/doerflow --dry-run
helm template luminaryworks deploy/helm/luminaryworks --dependency-update --dry-run
\`\`\`
`,
);


console.log(`wrote helm skeletons under ${helmRoot}`);
