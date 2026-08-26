# 跨产品 MQTT topic（v1）

| Metadata | Value |
| :--- | :--- |
| **文档 ID** | `SPEC-MQTT-TOPICS-001` |
| **版本** | 1.0.1 |
| **状态** | Accepted（跨产品事件总线；**不是**设备遥测平面） |
| **关联** | [ecosystem-refactoring.md](./ecosystem-refactoring.md) · [products/vistacast.md](./products/vistacast.md) · [products/syncrobrain.md](./products/syncrobrain.md) |

跨产品 JWT claim、`iot.*` / `agent.*` 权限码、**MQTT topic** 变更必须先改本文件，再改各产品实现。

---

## 0. 平面分离

| 平面 | Topic 归属 | 谁写 |
| :--- | :--- | :--- |
| **设备遥测** | ThingsBoard / SyncroBrain 设备 MQTT（如 `v1/devices/me/telemetry`） | 设备、TB 模拟器 |
| **跨产品事件** | 本文件 `lw/v1/...` | 产品控制面（VistaCast 告警出站等） |

禁止把 VistaCast `alert.v1` 发到 ThingsBoard 设备 topic。  
禁止把本文件写成「SyncroBrain 生产对接完成」。camera↔device 是可选 payload 字段（VistaCast FR-ECO-03），**不**改 topic。

---

## 1. 命名

```text
lw/v1/{tenantId}/{sourceProduct}/{schemaVersion}
```

| 段 | 规则 |
| :--- | :--- |
| `lw` | LuminaryWorks 跨产品前缀 |
| `v1` | **总线**版本；与 payload `schemaVersion` 独立 |
| `{tenantId}` | 租户 UUID（禁止 `+` `#` `/`） |
| `{sourceProduct}` | 小写产品 slug：`vistacast` / `syncrobrain` / … |
| `{schemaVersion}` | payload 契约 id，例如 `alert.v1` |

QoS **1**，retain **false**。UTF-8 JSON payload，字段名以源产品 artifacts 为准。

订阅示例：`lw/v1/+/vistacast/alert.v1` 或 `lw/v1/{tenantId}/#`。

---

## 2. VistaCast 出站告警（FR-RUL-05）

| 项 | 值 |
| :--- | :--- |
| Topic | `lw/v1/{tenantId}/vistacast/alert.v1` |
| Payload | VistaCast `alert.v1` JSON（见 VistaCast `artifacts/events/alert.v1.schema.json`） |
| 何时发 | 控制面**新打开**一条告警时（与 Webhook 出站同一时刻） |
| 未配置 broker | 产品必须 **no-op**，不得拖垮告警落库 / WebSocket |
| 本机验收 | Mosquitto 即可；**不是** EMQX/TB 生产平面 |

SyncroBrain 可订阅上述 topic 做台账/联动。本规范 **不**要求 SB 消费实现。摄像头若绑定了 `syncrobrainDeviceId`，仅写入 `alert.v1.payload`，topic 不变。**不是** TB `v1/devices/me/telemetry`。

---

## 3. 明确不做（本版本）

- 命令下发 / RPC topic
- 跨产品共享 MQTT ACL 与证书 PKI
- 把 `alert.v1` 映射成 TB Alarm 实体
- 家庭看护或自动急救语义

---

## RFC / Changelog

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-08-23 | 1.0.0 | 初版：`lw/v1/{tenantId}/{product}/{schema}`；VistaCast `alert.v1` 出站 |
| 2026-08-25 | 1.0.1 | 澄清：可选 `payload.syncrobrainDeviceId`；topic 不变；仍非 SB 生产 / TB 遥测 |
