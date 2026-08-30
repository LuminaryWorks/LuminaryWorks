# VistaCast 产品规划 · 视界云遥

> **组织**：[github.com/VistaCast](https://github.com/VistaCast) · **MetaRepo**：[VistaCast/VistaCast](https://github.com/VistaCast/VistaCast) · **域名**：[vistacast.dev](https://vistacast.dev)  
> **Slogan**：AI Visual Autopilot — 把线下空间变成可编程的视觉数据流。  
> **实现状态**：M1 切片已编码 + 本机 lab（**未**打 `vistacast-v0.1.0`）；M2 必须切片 + P1 已编码（**未**打 `v0.2.0`）。检测默认 stub，预览为 JPEG。M3 P0 非生产试点技术已验收；M3.1 设备 claim / 家庭成员 / HMAC ICE 已编码；M3.2 共享 coturn / lab-jpeg / 双平面 OTA 已编码。**白牌 / NRE / 真机 NAT / 刷 ROM / 生产 tag 仍阻塞。** **不再**等待 DataLuminary / BlockyEdu P0。  
> **详细 spec**：[VistaCast/spec](https://github.com/VistaCast/VistaCast/tree/main/spec) · 手册：[m1](https://github.com/VistaCast/VistaCast/blob/main/spec/m1-commercial-playbook.md) · [m2](https://github.com/VistaCast/VistaCast/blob/main/spec/m2-sentinel-playbook.md) · [m3 P0](https://github.com/VistaCast/VistaCast/blob/main/spec/m3-guardian-playbook.md) · [m3.1](https://github.com/VistaCast/VistaCast/blob/main/spec/m3-1-ecosystem-playbook.md) · [m3.2](https://github.com/VistaCast/VistaCast/blob/main/spec/m3-2-ice-soc-playbook.md) · 诚实矩阵：[implementation-status.md](https://github.com/VistaCast/VistaCast/blob/main/spec/implementation-status.md)

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
| **D0** | Blueprint | Spec 定稿 | 战略、产品、架构、artifacts | 🟡 待签字 |
| **M1** | Horizon | 第一商业版 | ONVIF + 客流/入侵/离线 + P2P + Docker | 🟡 切片已编码；**未**打 tag（stub / 非真机） |
| **M2** | Sentinel | 规则质量 + 工厂语义 | 分级/AND-OR/审计/报表/导出/MQTT/渠道；工厂 kind+stub；人脸/员工默认关 stub；签名 OTA；camera 绑定字段 | 🟡 必须+P1 已编码；**未**打 tag；F1/OEM 未勾 |
| **M3** | Embedded | OEM / 看护 | SDK、级联通知 | 🟡 P0 试点 + M3.1 claim/ICE/成员 + M3.2 coturn/lab-jpeg/双平面；⬜ 商业/白牌/真机 NAT/刷 ROM/tag |
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
- **仍阻塞**：白牌品牌/域名/push/商店（FR-OEM-02）、OEM 付费 NRE、真机 SoC 刷写 / 真机 NAT 首帧、看护 F1、`vistacast-v0.3.0`。

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
| VistaRemote | 告警后人工远程介入 | M4 | 深链未做 |
| DoerFlow | 视觉事件触发 Skill | M4 | 未做 |
| BlockyEdu | 安防实训 | M2 | FR-ECO-06 未做 |

集成方式：**HTTP / OIDC / MQTT / Webhook**，禁止跨仓 runtime import。

## 9. 编码启动前置

- **不再要求** DataLuminary / BlockyEdu P0 完成后再编码
- 2 家 ToB 付费试点争取，**不锁编码**
- 打 `vistacast-v0.1.0` / `v0.2.0` 须创始人显式确认；**禁止**把 stub / JPEG / 非真机写成生产就绪

## 10. 相关文档

| 文档 | 路径 |
|------|------|
| 产品 spec 仓 | [VistaCast/VistaCast/spec](https://github.com/VistaCast/VistaCast/tree/main/spec) |
| 用户文档 | [docs.vistacast.dev](https://docs.vistacast.dev) |
| 路线图 | [ROADMAP.md](https://github.com/VistaCast/VistaCast/blob/main/ROADMAP.md) |
| 实现状态 | [implementation-status.md](https://github.com/VistaCast/VistaCast/blob/main/spec/implementation-status.md) |
| MQTT topic | [mqtt-topics.md](../mqtt-topics.md) |
| 兄弟产品 | [vistaremote.md](./vistaremote.md) · [syncrobrain.md](./syncrobrain.md) |
| 品牌 | [domain-and-branding.md §4.4](../domain-and-branding.md) |
