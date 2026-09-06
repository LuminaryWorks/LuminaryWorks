# VistaCast 产品规划 · 视界云遥

> **组织**：[github.com/VistaCast](https://github.com/VistaCast) · **MetaRepo**：[VistaCast/VistaCast](https://github.com/VistaCast/VistaCast) · **域名**：[vistacast.dev](https://vistacast.dev)  
> **Slogan**：AI Visual Autopilot — 把线下空间变成可编程的视觉数据流。  
> **实现状态**：M1 切片已编码 + 本机 lab（**未**打 `vistacast-v0.1.0`）；M2 必须切片 + P1 已编码（**未**打 `v0.2.0`）。检测默认 stub，预览为 JPEG。M3 P0–M3.5 已编码（门店盒子 + Electron/RN 窗口 YOLO/Chat WASM）。**商店 App / 云端视觉大模型（延期） / NRE / 真机 NAT / 刷 ROM / 生产 tag 仍阻塞。** **不再**等待 DataLuminary / BlockyEdu P0。  
> **详细 spec**：[VistaCast/spec](https://github.com/VistaCast/VistaCast/tree/main/spec) · 手册：[m1](https://github.com/VistaCast/VistaCast/blob/main/spec/m1-commercial-playbook.md) · [m2](https://github.com/VistaCast/VistaCast/blob/main/spec/m2-sentinel-playbook.md) · [m3 P0](https://github.com/VistaCast/VistaCast/blob/main/spec/m3-guardian-playbook.md) · [m3.1](https://github.com/VistaCast/VistaCast/blob/main/spec/m3-1-ecosystem-playbook.md) · [m3.2](https://github.com/VistaCast/VistaCast/blob/main/spec/m3-2-ice-soc-playbook.md) · [m3.3](https://github.com/VistaCast/VistaCast/blob/main/spec/m3-3-golive-branding-playbook.md) · [m3.4](https://github.com/VistaCast/VistaCast/blob/main/spec/m3-4-on-device-packaging-playbook.md) · [m3.5](https://github.com/VistaCast/VistaCast/blob/main/spec/m3-5-client-infer-playbook.md) · 诚实矩阵：[implementation-status.md](https://github.com/VistaCast/VistaCast/blob/main/spec/implementation-status.md)

与 **[VistaRemote](./vistaremote.md)** **并存**：VistaRemote = WebRTC **远程桌面**；VistaCast = 固定摄像头 AI 事件 + 按需预览信令。P2P 预览不是远程桌面。

## 1. 定位

**视觉事件平台** — 兼容已有 ONVIF/RTSP 摄像头，在边缘完成检测，用结构化事件驱动 ToB 安防/运营；（后期）OEM / 家庭看护为第二产品线。不做默认全量云录像。

| 维度 | 说明 |
|------|------|
| 独立价值 | 门店客流、仓储防盗、工厂危险区告警 — 不依赖兄弟产品即可部署 |
| 生态角色 | **视** — 线下视觉数据流 + AI 事件源 |
| 受众 | 连锁零售、仓储物流、中小工厂、物业安防；OEM 看护后置 |
| 差异化 | 开源可私有化、事件优先、边缘推理、P2P 预览 |

两条产品线共用同一平台，不建两套后端。**第一商业版只卖 Enterprise。**

## 2. 战略摘要

| 维度 | 结论 |
|------|------|
| Beachhead | 连锁奶茶/快餐客流；仓储防盗 |
| 竞争 | 闭源 NVR 云贵且锁定；VistaCast 切开源私有化 + 垂直场景 |
| GTM | 设计伙伴 → ToB 试点 → OEM 商务门闩后才做 Guardian |
| 关键风险 | 误报、隐私、ONVIF 兼容、TURN/NAT |

完整分析：[VistaCast/spec/strategic-analysis.md](https://github.com/VistaCast/VistaCast/blob/main/spec/strategic-analysis.md)

## 3. 目标场景

| 优先级 | 场景 | AI 能力 | 版本 |
|:------:|------|---------|:----:|
| P0 | 奶茶店/快餐过线客流 | 过线计数、时段分布 | M1 |
| P0 | 仓储防盗 | 区域入侵、离线告警 | M1 |
| P1 | 工厂危险区域 | 闯入、跌倒/烟雾 kind（非 F1） | M2 |
| P2 | 员工离岗/玩手机 | 默认可关；非主叙事 | M2 |
| — | OEM / 家庭看护 | SDK、级联通知 | M3（商务门闩） |

## 4. 版本路线

| 里程碑 | 代号 | 主题 | 核心交付 | 编码 |
|:------:|------|------|----------|:----:|
| **D0** | Blueprint | Spec 定稿 | 战略、产品、架构、artifacts | ✅ 2026-08-31 已签字 |
| **M1** | Horizon | 第一商业版 | ONVIF + 客流/入侵/离线 + P2P + Docker | 🟡 切片已编码；**未**打 tag（stub / 非真机） |
| **M2** | Sentinel | 规则质量 + 工厂语义 | 分级/AND-OR/审计/报表/导出/MQTT/渠道；工厂 kind+stub；人脸/员工默认关 stub；签名 OTA；camera 绑定字段 | 🟡 必须+P1 已编码；**未**打 tag；F1/OEM 未勾 |
| **M3** | Embedded | OEM / 看护 | SDK、级联通知 | 🟡 P0–M3.5 窗口 YOLO/Chat WASM；⬜ 商业/商店 App/云端视觉 LLM（延期）/真机 NAT/tag |
| **M4** | Nexus | 生态 | DataLuminary 模板、Re-ID β | ⬜ |
| **M5** | Module | 模组 | 按需 | ⬜ |

完整 FR/US：[product-roadmap.md](https://github.com/VistaCast/VistaCast/blob/main/spec/product-roadmap.md)

### M1 第一商业版（编码已齐，非生产 tag）

- 多租户、站点、ONVIF L1 发现、摄像头健康 / `device.offline`
- 过线客流、区域入侵、基础规则、Webhook、确认/误报
- Admin：仪表盘、规则画区、事件流、P2P 预览（DataChannel JPEG，非 H264 RTP）
- Docker Compose 私有化；Logto Headless 统一登录 + 本地账密回退；Casbin `cast.*`

**M1 不含**：人脸库、跌倒看护、自动 120、白牌 App、模组、DataLuminary 模板、跨摄 Re-ID。

### M2 Sentinel（必须+P1 已编码，非生产 tag）

- 规则分级、同摄扁平 AND/OR、审计、客流日/周/月、REST 导出
- 可选 MQTT 出站（topic 见 [mqtt-topics.md](../mqtt-topics.md)）；邮件/企微/钉钉渠道
- 工厂 `fall`/`fight`/`smoke` **kind + stub**（**禁止**用 stub 勾 F1 > 0.75）
- 人脸名单库存 + `face.stranger`（默认关，stub，非生产识别）
- 员工 `staff.away`/`staff.phone`（默认关，stub，非生产监管）
- Ed25519 模型 OTA 回滚（非 TPM / 固件 / 生产 PKI）
- 边缘节点 hashed token；camera `syncrobrainDeviceId` 写入告警 payload（非 SB 生产消费）

### M3 Guardian（非生产）

- P0：独立 household、级联、30–60s 确认、同意 fail-closed、OEM 激活计量；AI 只发候选。
- M3.1：HMAC 短期 TURN（信令仍私有）、`POST /v1/oem/devices/claim`、家庭成员。ICE DTO 可被 VistaRemote / BlockyEdu 消费，**不**统一信令。
- M3.2：一份 coturn 模块（HMAC 前缀 `vc:`/`vr:`/`be:` + 配额）、`lab-jpeg` adapter、`POST /v1/oem/soc-intake/validate`、固件/模型双平面。lab JPEG **不是**真机 NAT；固件暂存 **不是**刷 ROM。
- M3.3：生产 Compose overlay（回环绑定、env 门闩、pg_dump、Caddy 示例）、租户品牌 overlay（`GET /v1/public/branding`）、`@vistacast/sdk` thin 客户端。**不是**商店 App，**不是** APNs，**未** npm publish。
- M3.4：门店盒子一键包（`install-store-box.mjs`）、Electron 宿主、RN LAN WebView 壳。RTSP 检测仍在本机 `ai`（默认 stub）。**不是**商店上架。
- M3.5：窗口内 YOLO / Chat（`client-infer` WASM，Electron/RN 加载）。**云端视觉大模型延期**。**不是**生产 F1，**不是** VistaCast 云 GPU。
- **仍阻塞**：商店 App / 域名+push 证书（FR-OEM-02 余量）、云端视觉大模型（待规模）、OEM 付费 NRE、真机 SoC 刷写 / 真机 NAT 首帧、看护 F1、`vistacast-v0.3.0`。

## 5. AI 能力矩阵（诚实）

| 能力 | 里程碑 | 现状 |
|------|:------:|------|
| 客流统计 / 区域入侵 | M1 | 几何 + stub 可演示；非零售级精度 |
| 本地 ONNX Provider | M1 | 接口 + stub；真权重可选 |
| 工厂异常（跌倒/打架/烟雾） | M2 | kind + `STUB_ANOMALY`；**非** F1 |
| 人脸 / 陌生人 | M2 | 默认关；名单库存；`STUB_FACE`；**非**生产识别 |
| 员工离岗/玩手机 | M2 | 默认关；`STUB_STAFF`；**非**生产监管、非主叙事 |
| 跨摄像头 Re-ID | M4 | 未做 |

实时 CV **不走** LuminaryWorks LLM 网关。告警叙事等文本推理可后期接中央 AI 平台。

## 6. 技术栈

NestJS + **Fastify** + TypeORM + **PostgreSQL** · ONVIF/RTSP · WebSocket · Rsbuild + React + Zustand + Sass Modules/BEM · Node ≥ 24 · 推理仅 `ai` 仓 · `@luminaryworks/auth-core`

工作流：**Spec → artifacts → shared → server / ai / web**（见 [SDD](https://github.com/VistaCast/VistaCast/blob/main/spec/spec-driven-development-spec.md)）

## 7. 身份与权限

| 层 | 技术 |
| --- | --- |
| AuthN | Logto Experience Headless（`LuminaryWorks/identity`） |
| AuthZ | 产品内 Casbin（`cast.*`）；不入 JWT |
| 共享库 | `@luminaryworks/auth-core` / `@luminaryworks/auth-react` |

## 8. 兄弟产品集成

| 产品 | 场景 | 里程碑 | 诚实边界 |
|------|------|:------:|----------|
| DataLuminary | 告警/客流 REST 导出（无 DL 账号也可拉） | M2 | DataTalk 模板仍是 M4 |
| SyncroBrain | MQTT `alert.v1`；payload 可选 `syncrobrainDeviceId` | M2 | **不是** SB 生产消费 / TB 遥测 |
| VistaRemote | 告警后人工 **远程桌面** 介入 | M4 | 深链未做；VistaRemote ≠ 本产品 |
| DoerFlow | 双向 commerce：告警证据/客流报表 Skill + `alert.v1`→任务 | M4 Nexus | 中央 M2M/OIDC 已登记；产品适配器 lab，**未**生产 tag |
| BlockyEdu | 安防实训 | M2 | FR-ECO-06 未做 |

集成方式：**HTTP / OIDC client_credentials / HMAC CloudEvents / MQTT**，禁止跨仓 runtime import 或共享 DB。

### 8.1 DoerFlow（视觉事件 ≠ 远程桌面）

VistaCast 是 **固定摄像头 AI 事件** 平台。P2P 预览与告警不是 VistaRemote 远程桌面会话。

| 项 | 合同 |
|----|------|
| 卖方 offering | `vistacast.alert-evidence.v1`、`vistacast.footfall-report.v1`（有诚实证据的能力）；stub / 人脸 / staff / fall-smoke **默认不可变现**，**禁止**把 stub 标成生产变现 |
| 处置 | 满足租户策略、severity、预算的 `alert.v1` 经 M2M 提交 DoerFlow Task；回调只记录外部处置，ack/resolve 仍走本产品 Casbin |
| 身份 | Logto M2M `VistaCast Service` → audience `https://api.doerflow.local`；scopes `integration.provider.register`、`integration.event.submit`、`integration.callback.read` |
| 商业 | **不**在中央 Entitlement 增加 VistaCast 面向用户价格方案；用量走 DoerFlow `integration.*` feature/quota（Pro 不开放 provider/event 写）。协议费 / Job 单价 / Escrow / Gas 不属于套餐 |
| 隐私 | 禁止原始视频、人脸模板、RTSP 凭据出站；只传引用、摘要、hash、短期授权 URL |
| 协议 | 仅 REST + OIDC client_credentials + HMAC CloudEvents；禁止跨仓 runtime import / 共享 DB |

## 9. 可组合部署边界

权威：[composable-deployment.md](../composable-deployment.md)。VistaCast 是 `agent-commerce` / `smart-site` 的视觉事件源，但 **不依赖**兄弟产品即可部署。

### 最小独立依赖

- 自有 PostgreSQL、Casbin `cast.*`、ONVIF/RTSP 凭据、边缘 `ai` 仓
- 身份：Logto Headless 或外部 OIDC；本地账密仅开发回退
- 权益：本产品**不是**中央 ToC `productCode`；可完全不连 Entitlement `:3040`
- AI：实时 CV **不走**中央 LLM；`ai=off` / 边缘 stub / 本地 ONNX

### 可选兄弟产品

| 产品 | 场景 | 关闭后 |
|------|------|--------|
| SyncroBrain | MQTT `alert.v1`（可选 `syncrobrainDeviceId`） | 告警闭环留在本产品 |
| DataLuminary | REST 导出 | 无 DL 账号也可拉；DataTalk 模板仍是 M4 |
| VistaRemote | 告警后远程桌面介入（深链未做） | 不得展示「一键介入」 |
| DoerFlow | 双向 commerce（适配器 **lab**） | 关闭 offering / inbox |
| BlockyEdu | 安防实训（FR-ECO-06 未做） | 无运行依赖 |

### 降级方式

- 检测默认 stub：几何演示可开，**不得**静默换成「生产模型已就绪」
- `identity` `fail_closed`；`ai=central` 禁止进入本产品 pilot/production Manifest
- DoerFlow / MQTT 对端不可达：事件留在本库，outbox 可观察，不丢本地 ack
- 无 VistaRemote 深链时，人工介入走本产品工单 / 电话，不假装已接通

### 数据所有权

摄像头、视觉事件、告警状态与 ack。原始视频帧 / 截图 / 人脸模板 / RTSP **禁止**出站。P2P 预览不是 VistaRemote 远程桌面。

### 不得宣称上线的 lab·stub

- 客流 / 入侵 / 工厂 kind / 人脸 / staff / fall-smoke：**stub 或默认关**，禁止标成生产变现能力
- JPEG DataChannel 预览 **不是** H.264 RTP；lab-jpeg **不是**真机 NAT
- **未**打 `vistacast-v0.1.0` / `v0.2.0` / `v0.3.0`；商店 App / 云端视觉大模型 / 真机刷 ROM 仍阻塞
- 中央 `ai=central` 为 lab；实时 CV 经中央 LLM **禁止**

## 10. 编码启动前置

- **不再要求** DataLuminary / BlockyEdu P0 完成后再编码
- 2 家 ToB 付费试点争取，**不锁编码**
- 打 `vistacast-v0.1.0` / `v0.2.0` 须创始人显式确认；**禁止**把 stub / JPEG / 非真机写成生产就绪

## 11. 相关文档

| 文档 | 路径 |
|------|------|
| 产品 spec 仓 | [VistaCast/VistaCast/spec](https://github.com/VistaCast/VistaCast/tree/main/spec) |
| 用户文档 | [docs.vistacast.dev](https://docs.vistacast.dev) |
| 路线图 | [ROADMAP.md](https://github.com/VistaCast/VistaCast/blob/main/ROADMAP.md) |
| 实现状态 | [implementation-status.md](https://github.com/VistaCast/VistaCast/blob/main/spec/implementation-status.md) |
| MQTT topic | [mqtt-topics.md](../mqtt-topics.md) |
| 兄弟产品 | [vistaremote.md](./vistaremote.md) · [syncrobrain.md](./syncrobrain.md) |
| 品牌 | [domain-and-branding.md §4.4](../domain-and-branding.md) |
