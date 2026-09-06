# Cross-scenario contract fixtures

JSON Schema + CloudEvents samples for `agent-commerce` and `smart-site`. **UTF-8 without BOM.**

This MetaRepo **does not implement product senders**. VistaCast, SyncroBrain, VistaRemote, DataLuminary, BlockyEdu and DoerFlow own their HTTP clients, outbox workers and HMAC secrets. Fixtures here are the shared envelope for orchestration tests and operator review.

| Path | What it freezes |
|---|---|
| `schemas/` | Envelope, HMAC headers, HTTP 401/402/403, MQTT planes, embed origins, Job authorize/capture/void, M2M scopes |
| `samples/` | Example CloudEvents. `source` URIs are illustrative; they are not live endpoints in this repo |

## HMAC

Inbound/outbound CloudEvents use a **per-peer** HMAC-SHA256. DoerFlow's current header is:

```http
Content-Type: application/cloudevents+json
X-DoerFlow-Signature: sha256=<hex>
X-LW-Timestamp: <unix-seconds>
X-LW-Nonce: <uuid>
```

Replay window + nonce are mandatory (`spec/composable-deployment.md` §5.1). Secrets never appear in Control Manifests or in these fixtures.

## 401 / 402 / 403

| Status | Meaning | Typical code |
|---|---|---|
| **401** | Identity missing or invalid (OIDC / M2M / SIWE) | `UNAUTHORIZED` |
| **402** | Identity ok, commercial entitlement / quota / license failed | `ENTITLEMENT_*` |
| **403** | Identity and entitlement ok; **Casbin** denied the resource | `FORBIDDEN` |

Do not use 403 for "has not paid". Front-end upgrade UX reacts only to the entitlement family.

## MQTT planes

| Plane | Topic | Writer |
|---|---|---|
| Device telemetry | ThingsBoard / SyncroBrain device MQTT, e.g. `v1/devices/me/telemetry` | Device |
| Cross-product events | `lw/v1/{tenantId}/{sourceProduct}/{schemaVersion}` | Product control plane |

VistaCast `alert.v1` must not be published onto the device telemetry plane. Production consumption is still the signed Webhook; MQTT is optional compatibility. `care` payloads stay off the bus. See `spec/mqtt-topics.md`.

## Embed origins

DataLuminary iframe embeds accept only an operator allowlist (`DATALUMINARY_EMBED_ORIGINS`). The browser does not receive device, MQTT or admin credentials. DataLuminary is an observer, not Safety Kernel or settlement authority.

## Job authorize / capture / void

DoerFlow owns the ledger. `authorize` reserves budget and a nonce without crediting the payee. `capture` runs after a 2xx provider response and output hash. Timeouts and 5xx `void` the authorization. Signed callbacks **must not** resolve the source Incident or execute RPC.
