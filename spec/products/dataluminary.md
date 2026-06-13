# DataLuminary 产品规划 · 数据明鉴

> **中文名**：数据明鉴 · **域名**：[dataluminary.dev](https://dataluminary.dev) · **组织**：[github.com/dataluminary](https://github.com/dataluminary)  
> **旧名**：DataLuminary / DataLuminary-Platform

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

### 2.3 AI 增强

- 自然语言 → 图表 / 报告 / 图表配置
- 异常检测与摘要（与 SyncroBrain 时序、VistaCast 视频 AI、VistaRemote 录制摘要联动）
- 一键生成分析叙事

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
| M2 | AI 报告 / 图表生成 GA |
| M3 | SyncroBrain / DoerFlow 标准数据集模板 |

## 6. 相关文档

- 实现仓：`spec/ecosystem.md`、`spec/index.md`
- 生态：[domain-and-branding.md §4.1](../domain-and-branding.md#41-dataluminary--dataluminarydev)
