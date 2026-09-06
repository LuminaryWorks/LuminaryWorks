# DataLuminary 产品规划 · 数据明鉴

> **中文名**：数据明鉴 · **域名**：[dataluminary.dev](https://dataluminary.dev) · **组织**：[github.com/DataLuminary](https://github.com/DataLuminary)  
> **MetaRepo**：[DataLuminary/DataLuminary](https://github.com/DataLuminary/DataLuminary) · **旧仓名**：DataLuminary-Platform

## 1. 定位

**用 AI 照亮数据，发现洞察。**

AI 原生数据洞察平台：低代码 / 无代码 BI、DataTalk 可视化大屏、AI 提示词一键生成报告与图表配置。

| 维度 | 说明 |
|------|------|
| 独立价值 | 任意行业 BI，不依赖 IoT 或兄弟产品 |
| 生态角色 | **析** — 将设备遥测、业务数据、Agent 日志变为可决策大屏 |
| 受众 | 企业数据团队、运营、硬件厂商（设备监控大屏） |

## 2. 核心能力

### 2.1 数据连接与建模

- 多源数据集：PostgreSQL、API、CSV、IoT 时序（可选 MQTT 接入）
- 字段 schema 与权限（RBAC + PAL）
- 混合查询（明细 + 聚合）

### 2.2 可视化与 BI

- **DataView**：自助分析、仪表盘
- **DataTalk**：大屏编排、实时刷新、iframe 嵌入（如 IoT 控制台）
- Less-code / No-code 拖拽配置

### 2.3 AI 增强（DataInsight）

- **一个**统一 AI 对话框：Copilot 配置与数据洞察是同一编排器的两种能力，不是两套服务。
- 逻辑名 DataInsight，物理位置 `DataTalk/src/modules/ai/`。
- 自然语言问数、可解释洞察、ChartIntent → 原生图表 / 仪表盘。
- 模型调用走 LuminaryWorks AI Platform 契约（本地 BYOK 适配器可先落地）。
- 异常检测与摘要可与 SyncroBrain 时序、VistaCast 视频 AI、VistaRemote 录制摘要联动（HTTP，不跨仓 import）。

## 3. 兄弟产品集成

| 源 | 场景 |
|----|------|
| SyncroBrain | 设备遥测大屏、数字孪生指标 |
| VistaCast | 摄像头告警、客流报表 |
| VistaRemote | 远程会话录制、AI 摘要报表 |
| DoerFlow | 链上交易、Agent 运行指标 |
| BlockyEdu | 数据分析课程实验数据 |

集成方式：**HTTP / OIDC / iframe JWT**，禁止跨仓 runtime import。

## 4. 技术栈

React、Ant Design、Sass · NestJS、TypeORM、PostgreSQL · VibeCode Spec-Driven

## 5. 里程碑（产品向）

| 阶段 | 目标 |
|------|------|
| M1 | DataView + DataTalk 核心闭环，独立商用 |
| M2 | AI 报告 / 图表生成 GA（见产品仓 `plan/ai-insights-roadmap.md`） |
| M3 | SyncroBrain / DoerFlow 标准数据集模板 |

## 6. 身份 · 权益 · 资源权限

接入顺序：**Logto AuthN → 中央 Entitlement → Casbin 资源 ACL**。权威规范：[subscription-and-entitlement.md](../subscription-and-entitlement.md)、[identity-and-permissions.md](../identity-and-permissions.md)。

| 层 | DataLuminary 要点 |
|----|-------------------|
| 身份 | Logto `sub` → DataTalk 本地用户；OIDC→本地 JWT exchange 与本地开发兼容可保留 |
| 权益 | ToC 每用户一次 7 天 Trial；Pro / Ultra；企业合同 + Space/Org seat；私有 License 不绕过 Casbin |
| 资源 | Casbin 继续判定 dashboard / space / dataset；高级分析、导出、容量、dashboard 数量等走 feature/quota |
| 迁移 | `ENTITLEMENT_MODE=shadow_read` 先行，再 `enforce`；Space ↔ Logto Organization 显式映射 |

接入实现：

- DataTalk：`@luminaryworks/entitlement-client` + `src/modules/entitlement/`（见产品仓 `spec/development/entitlement.md`）
- DataView：`#/account`、Trial 倒计时、402 升级 UX（见 `spec/development/entitlement-ui.md`）

## 7. 可组合部署边界

权威：[composable-deployment.md](../composable-deployment.md)。DataLuminary 出现在 `smart-site` 上层闭环里，但 **standalone 必须可售**。

### 最小独立依赖

- 产品 plane：DataTalk / DataView + **自有** PostgreSQL、迁移、Casbin（dashboard / space / dataset）
- 身份：`identity=external_oidc` 或 `local`（lab）；不强制中央 Logto
- 权益：`entitlement=off` 或 `offline_license`；不强制中央 Entitlement（`:3040`）
- AI：`ai=off` 或 `ai=local_byok`；**禁止**把 `ai=central` 写成生产依赖

### 可选兄弟产品

| 源 | 用法 | 关闭后 |
|----|------|--------|
| SyncroBrain | 遥测 / 孪生指标 REST 或 embed | 去掉对应数据集，核心 BI 仍可用 |
| VistaCast | 告警 / 客流导出 | 同上 |
| VistaRemote | 会话录制与摘要报表 | 同上 |
| DoerFlow | 交易 / Agent 运行指标 | 同上 |
| BlockyEdu | 课程实验数据 | 同上 |

集成仅 HTTP / OIDC / iframe JWT；禁止跨仓 runtime import 或共享 DB。

### 降级方式

- `identity`：仅 `fail_closed`（AuthN 永不匿名）
- `entitlement`：`fail_closed` / `offline_license`（`enforce` + `fail_open_local` 在 pilot/production **报错**）
- `ai`：`disable_feature` 或 `fallback_local_byok`；`ai=off` **不得**回退到 BYOK
- 兄弟产品不可达：关闭对应数据集 / embed，不阻塞本产品 `/ready`

### 数据所有权

报表、看板、导出与 embed。**不是**设备 Safety Kernel、DoerFlow 结算或源告警状态的权威；只消费 REST export / external-sync / embed。

### 不得宣称上线的 lab·stub

- 中央 AI Platform（`ai=central`）为 **lab**（无 AuthN / Entitlement 门禁 / 持久计量 / `/ready` / vault）
- AI 报告 / 图表 GA 以产品仓 roadmap 为准，未 GA 不得宣称已上线
- 不得宣称本产品可替代 SyncroBrain 设备控制或 DoerFlow 结算

## 8. 相关文档

- 实现仓：`spec/ecosystem.md`、`spec/index.md`
- 生态：[domain-and-branding.md §4.1](../domain-and-branding.md#41-dataluminary--dataluminarydev)
- 权益：[subscription-and-entitlement.md](../subscription-and-entitlement.md)
