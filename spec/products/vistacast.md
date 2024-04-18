# VistaCast 产品规划 · 视界云遥

> **组织**：[github.com/VistaCast](https://github.com/VistaCast) · **MetaRepo**：[VistaCast/vistacast](https://github.com/VistaCast/vistacast) · **域名**：[vistacast.dev](https://vistacast.dev)  
> **Slogan**：AI Visual Autopilot — 把线下店铺变成数字化数据流。  
> **实现状态**：📋 **D0 规划 / 文档阶段**（M1 编码排在 DataLuminary、BlockyEdu P0 之后）  
> **详细 spec**：`D:\www\vistacast\spec\` · [GitHub](https://github.com/VistaCast/vistacast/tree/main/spec)

## 1. 定位

**纯软件 AI Visual Autopilot** — 兼容海康、大华、小米、TP-Link 等 ONVIF/RTSP 摄像头，不做硬件。把固定摄像头变成结构化安全与运营事件源。

| 维度 | 说明 |
|------|------|
| 独立价值 | 仓储防盗、门店客流、工厂危险区域告警 — 安全与资产类 SaaS |
| 生态角色 | **视** — 线下视觉数据流 + AI 事件源 |
| 受众 | 连锁零售、仓储物流、中小工厂、物业安防 |
| 差异化 | 开源可私有化、事件优先（非全量录像）、LuminaryWorks 生态组合 |

与 **[VistaRemote](./vistaremote.md)** **并存**：VistaRemote = WebRTC 人工触达；VistaCast = 固定摄像头 AI 分析。

## 2. 战略摘要（麦肯锡视角）

| 维度 | 结论 |
|------|------|
| Beachhead | P0：连锁奶茶/快餐客流；P0：仓储防盗 |
| TAM/SAM | 全球 SMB 视频 AI 大市场；华语区 ONVIF 存量升级 ~$2–5B SAM |
| 竞争 | 闭源 NVR 云贵且锁定；VistaCast 切开源私有化 + 垂直场景 |
| GTM | D0 设计伙伴 → M1 试点 5 站 → M2 可复制商业化 |
| 关键风险 | AI 误报、隐私合规、ONVIF 兼容性 |

完整分析：[VistaCast/spec/strategic-analysis.md](https://github.com/VistaCast/vistacast/blob/main/spec/strategic-analysis.md)

## 3. 目标场景

| 优先级 | 场景 | AI 能力 |
|:------:|------|---------|
| P0 | 仓储防盗 | 陌生人脸、夜间异动、越界 |
| P0 | 奶茶店/快餐出餐口 | 客流、排队、时段分布 |
| P1 | 工厂危险区域 | 未授权进入、跌倒/烟雾/打架 |
| P2 | 物业多站点 | 统一看板（M3） |

## 4. 版本路线（产品经理视角）

| 里程碑 | 代号 | 主题 | 核心交付 |
|:------:|------|------|----------|
| **D0** | Blueprint | Spec 定稿 | 战略、产品、架构、SDD（当前） |
| **M1** | Horizon | 单场景 MVP | ONVIF + Admin + 客流/陌生人告警 + Docker |
| **M2** | Sentinel | 规则 + 异常 GA | 规则引擎、跌倒/打架/烟雾、Webhook/MQTT |
| **M3** | Nexus | 生态集成 | Re-ID β、DataLuminary 模板、SyncroBrain 联动 |

完整 FR/US：[product-roadmap.md](https://github.com/VistaCast/vistacast/blob/main/spec/product-roadmap.md)

### M1 核心功能（摘要）

- 多租户、站点、ONVIF 发现与注册、摄像头健康
- 陌生人脸告警、客流计数与报表、基础规则引擎
- Admin 仪表盘、实时事件流、Docker 私有化部署

## 5. AI 能力矩阵

| 能力 | 里程碑 |
|------|:------:|
| 人脸识别 / 陌生人告警 | M1 |
| 客流统计 | M1 |
| 区域入侵 | M1 |
| 异常检测（摔倒/打架/冒烟） | M2 |
| 员工监管（可关闭） | M2 |
| 跨摄像头 Re-ID | M3 |

## 6. 技术栈（规划）

NestJS + Fastify + TypeORM + PostgreSQL · ONVIF/RTSP · WebSocket · Rsbuild + React · `@luminaryworks/auth-core`

工作流：**Spec → artifacts/contracts → repos/**（见 [SDD spec](https://github.com/VistaCast/vistacast/blob/main/spec/spec-driven-development-spec.md)）

## 7. 兄弟产品集成

| 产品 | 场景 | 里程碑 |
|------|------|:------:|
| DataLuminary | 告警/客流大屏、数据集 API | M2–M3 |
| SyncroBrain | 设备台账、MQTT 事件 | M2 |
| DoerFlow | 视觉事件触发 Skill | M3 |
| BlockyEdu | 安防实训 | M2 |
| VistaRemote | 告警后人工远程介入 | M3 |

## 8. 编码启动前置

- DataLuminary、BlockyEdu P0 完成
- M1 beachhead 场景确认
- 2+ 设计伙伴意向

## 9. 相关文档

| 文档 | 路径 |
|------|------|
| 产品 spec 仓 | [VistaCast/vistacast/spec](https://github.com/VistaCast/vistacast/tree/main/spec) |
| 路线图 | [ROADMAP.md](https://github.com/VistaCast/vistacast/blob/main/ROADMAP.md) |
| 实现状态 | [implementation-status.md](https://github.com/VistaCast/vistacast/blob/main/spec/implementation-status.md) |
| 兄弟产品 | [vistaremote.md](./vistaremote.md) |
| 品牌 | [domain-and-branding.md §4.4](../domain-and-branding.md) |
