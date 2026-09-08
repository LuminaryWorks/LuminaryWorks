# SyncroBrain 产品规划 · 万物智脑

> **中文名**：万物智脑 · **域名**：[syncrobrain.com](https://syncrobrain.com) · **组织**：[github.com/SyncroBrain](https://github.com/SyncroBrain)  
> **MetaRepo**：[SyncroBrain/SyncroBrain](https://github.com/SyncroBrain/SyncroBrain) · **旧名**：LuminaryIoTChain  
> **Slogan**：An AI-native operating system for connected devices.

## 1. 定位

**连接设备的 AI 原生操作系统** — 从「让设备联网」升级为「让设备通过 AI 大脑产生价值」。

| 维度 | 说明 |
|------|------|
| 独立价值 | 开源可私有化 IoT PaaS，替代涂鸦类闭源方案 |
| 生态角色 | **连** — 物理世界数据大脑，与 DoerFlow（数字 Flow）形成闭环 |
| 受众 | 硬件厂商、集成商、充电桩/储能等设备商 |

## 2. 平台能力

| 层 | 能力 |
|----|------|
| 设备 | 接入、影子、OTA、多协议 |
| 连接 | MQTT（EMQX）、高并发同步（Syncro） |
| 边缘 | 规则引擎、边缘推理 |
| 数据 | 时序、数字孪生 |
| AI | 产品内规则 / 遥测；LLM 走中央 AI Platform，不自建 IoT LLM 栈 |
| 商业 | DoerFlow 链上结算、DataLuminary 大屏 |

## 3. 与涂鸦（Tuya）差异

| 维度 | 涂鸦 | SyncroBrain |
|------|------|-------------|
| 模式 | 闭源 SaaS | **开源可私有化** |
| 核心 | 设备管理、场景 | **AI + 数据 + 链上变现** |
| 可视化 | 内置面板 | **DataLuminary DataTalk** |
| 远程 | 有限 | **VistaRemote**（桌面）+ **VistaCast**（摄像头 AI；切片已编码，非生产 tag） |
| 开发者 | 涂鸦开发者平台 | **BlockyEdu** AI 实验课 |

## 4. 生态协同

```text
SyncroBrain（Brain · 物理数据）  ↔  DoerFlow（Flow · 价值流转）
```

- 设备遥测 → DataLuminary 洞察  
- 告警 → VistaCast **视觉事件** AI 检测 / VistaRemote **远程桌面** 人工介入  
- 跨产品事件总线：VistaCast 可向 `lw/v1/{tenantId}/vistacast/alert.v1` 出站（[mqtt-topics.md](../mqtt-topics.md)）。这是产品事件，**不是** ThingsBoard `v1/devices/me/telemetry`。SyncroBrain 用签名 Webhook 作为生产消费；MQTT 为仓储/楼宇可选兼容；`care` 不上总线。  
- 设备算力/数据 → DoerFlow 可选双向变现（默认关闭，见下）  
- 工程师培养 → BlockyEdu ESPHome/MQTT 课程  

### 4.1 DoerFlow 可选 commerce（默认关闭）

Cloud Lite **可独立交付**；DoerFlow 不进入默认 Build。启用后仍禁止跨仓 runtime import、共享 DB，或把 TelemetryEnvelope / TB MQTT 当成跨产品总线。

| 项 | 合同 |
|----|------|
| 卖方 offering | `syncrobrain.telemetry-digest.v1`、`syncrobrain.incident-report.v1`（时间窗/批次摘要，不逐点建任务） |
| 处置 | Incident 进入 open/escalated 或外部 WorkOrder 策略命中时，经 M2M 创建付费 Task；**任何设备命令**必须经过 Entitlement + Casbin + **Safety Kernel**，不得由 DoerFlow 直接下发 |
| 身份 | Logto M2M `SyncroBrain Gateway` → audience `https://api.doerflow.local`；scopes `integration.provider.register`、`integration.event.submit`、`integration.callback.read`。无 OIDC callback。 |
| 商业 | **不**在 `sellable=false` 期间发布 SyncroBrain 面向用户价格或 Trial；中央目录可占位 `productCode=syncrobrain`。平台用量走 DoerFlow `integration.*`（Pro 不开放 provider/event 写）。协议费 / Job 单价 / Escrow / Gas 不属于套餐 |
| 回调 | HMAC CloudEvents 写关联记录；**不**自动 close Incident |
| 协议 | 仅 REST + OIDC client_credentials + HMAC CloudEvents；禁止 runtime import、共享 DB、ThingsBoard MQTT 直通或出站 TB 凭据 |  

## 5. 技术栈

ThingsBoard CE、EMQX OSS、NestJS 编排层、PostgreSQL · MQTT / REST

## 6. 里程碑（产品向）

| 阶段 | 目标 |
|------|------|
| M1 | 设备接入 + 规则 + 控制台 |
| M2 | DataLuminary 大屏嵌入 + VistaCast 入口 |
| M3 | 可选 DoerFlow 设备 Agent / 数据 Skill / Incident→任务（默认关闭；中央 M2M 已登记） |

## 7. 可组合部署边界

权威：[composable-deployment.md](../composable-deployment.md)。SyncroBrain 是 `agent-commerce` / `smart-site` 的设备平面；**Cloud Lite 可独立交付**。

### 最小独立依赖

- ThingsBoard CE + EMQX + 编排层 + **自有** PostgreSQL / Casbin
- DoerFlow **不**进入默认 Build；无中央 Entitlement 也可运行设备 OS
- 身份：外部 OIDC 或中央 Logto；ThingsBoard token **永不出站**
- AI：产品内规则 / 遥测；LLM 仅 `off` 或 `local_byok`（`ai=central` 为 lab）

### 可选兄弟产品

| 产品 | 场景 | 关闭后 |
|------|------|--------|
| VistaCast | 视觉 `alert.v1`（签名 Webhook 为生产消费；MQTT 可选兼容） | 设备 OS 与 Incident 仍运行 |
| VistaRemote | 远程桌面人工介入 | 无远控深链时走现场 / 工单 |
| DataLuminary | 遥测大屏 embed | 控制台仍可用 |
| DoerFlow | 可选 commerce（默认关） | 关闭 offering / inbox |
| BlockyEdu | ESPHome / MQTT 课程 | 无运行依赖 |

### 降级方式

- commerce 默认关闭；对端不可达时 Incident 留在本库，**不**由外部 callback close
- 任何设备命令必须经过 Entitlement（若 enforce）+ Casbin + **Safety Kernel**；DoerFlow **不得**直接下发 RPC
- `identity` `fail_closed`；`ai=central` 禁止进入 pilot/production Manifest
- MQTT 出站可选；`care` 不上总线

### 数据所有权

设备、遥测、Incident / WorkOrder、Safety Kernel 与设备 RPC。VistaCast 拥有摄像头与视觉 ack；DoerFlow 拥有 Job / Receipt。DataLuminary 只观察，不成为 Safety Kernel。

### 不得宣称上线的 lab·stub

- **不得**宣称全硬件通用兼容（部分型号）
- VistaCast MQTT 出站 **不是** ThingsBoard 遥测，也 **不是** 本产品生产消费路径（生产消费 = 签名 Webhook）
- DoerFlow 适配默认关闭、未打生产 tag
- 中央 `ai=central` 为 lab；不自建 IoT LLM 栈也不把 lab 网关当生产

## 8. 相关文档

- 实现仓：`spec/platform-vision.md`、`spec/architecture.md`
- 权益：[subscription-and-entitlement.md](../subscription-and-entitlement.md)（`productCode=syncrobrain` 默认可配置、不可售、无 Trial）
- 生态：[domain-and-branding.md §4.5](../domain-and-branding.md#45-syncrobrain--syncrobraincom)
