# DoerFlow · 智工网 跨产品 Spec

> **外部文档优先**：[doerflow.dev](https://doerflow.dev) · [docs.doerflow.dev](https://docs.doerflow.dev)。本文件为 MetaRepo 内 **LuminaryWorks** 视角的简报；**权威实现与合约以 `DoerFlow/DoerFlow` MetaRepo** 为准。

## 品牌与仓库

| 项 | 值 |
|----|-----|
| 品牌 | **DoerFlow** · 智工网 |
| 官网 | [doerflow.dev](https://doerflow.dev) |
| 文档 | [docs.doerflow.dev](https://docs.doerflow.dev)（Rspress） |
| DApp | [app.doerflow.dev](https://app.doerflow.dev) |
| 管理端 | [admin.doerflow.dev](https://admin.doerflow.dev) |
| GitHub 组织 | [github.com/DoerFlow](https://github.com/DoerFlow) |
| MetaRepo | [DoerFlow/DoerFlow](https://github.com/DoerFlow/DoerFlow)（历史品牌 **VibeAgent**；`luminaryworks-ecosystem.md`、`spec/CONVENTIONS`） |
| 协议 / 结算 | `spec/PROTOCOL.md`、`spec/SETTLEMENT.md`、`spec/PAYMENT_CHANNELS.md` 等（MetaRepo） |

## 在 LuminaryWorks 六产品中的角色

| 维度 | 说明 |
|------|------|
| 生态关键字 | **赚** — 自主执行体（Agent / Human）价值流动 |
| 一句话 | The Liquidity Protocol for Autonomous Agents — 任务发布、匹配、托管结算 |
| 独立商用 | 可单独服务 Web3 + AI 社区，不强依赖兄弟产品 |

```text
开发者 / 设备 ──► DoerFlow 网络 ──► 任务完成 ──► 链上结算
```

## 核心价值主张

| 价值 | 说明 |
|------|------|
| 任务市场 | 发布、接单、验收、争议与托管 |
| Agent 经济 | Skill / Worker 与链上身份、激励对齐 |
| 多链结算 | 合约仓 `repos/contracts`；详见 MetaRepo `spec/` |
| 可选跨产品 | 运行数据 → **DataLuminary**；设备遥测/Incident → **SyncroBrain**；视觉事件/报表 → **VistaCast**；远程桌面调试 → **VistaRemote** |

## 兄弟产品与集成

| 产品 | 官网 | 场景 |
|------|------|------|
| [DataLuminary](https://dataluminary.dev) | [dataluminary.dev](https://dataluminary.dev) | Agent 运行与交易数据可视化 |
| [BlockyEdu](https://blockyedu.com) | [blockyedu.com](https://blockyedu.com) | 智能合约与 Agent 开发课程 |
| [SyncroBrain](https://syncrobrain.com) | [syncrobrain.com](https://syncrobrain.com) | 设备 Agent、遥测摘要 / Incident 报表 Skill；Incident→任务 |
| [VistaRemote](https://remote.vistacast.dev) | [remote.vistacast.dev](https://remote.vistacast.dev) | WebRTC **远程桌面**调试 Worker / 边缘设备（不是摄像头 AI） |
| [VistaCast](https://vistacast.dev) | [vistacast.dev](https://vistacast.dev) | **视觉事件**平台：告警证据 / 客流报表 Skill；`alert.v1`→任务 |

集成原则（MetaRepo）：跨产品仅 **REST + OIDC client_credentials + HMAC CloudEvents**；禁止 runtime import、共享 DB、原始视频/人脸模板/RTSP 或 ThingsBoard MQTT 直通。链上逻辑留在 `repos/contracts`。生态叙事详见 [DoerFlow `spec/luminaryworks-ecosystem.md`](https://github.com/DoerFlow/DoerFlow/blob/main/spec/luminaryworks-ecosystem.md)。

## 跨产品 commerce（中央视角）

DoerFlow 拥有目录、Job、Receipt authorize/capture/void、账本与 Merkle 事实；VistaCast / SyncroBrain 拥有各自事件、数据授权与最终 ack/resolve。双向价值流：

| 方向 | 契约 | 调用方 |
|------|------|--------|
| 卖方 | 版本化 offering：`vistacast.alert-evidence.v1`、`vistacast.footfall-report.v1`、`syncrobrain.telemetry-digest.v1`、`syncrobrain.incident-report.v1` | 买家 → DoerFlow quote/Job → 签名调用供应方 HTTP |
| 处置 | VistaCast `alert.v1` / SyncroBrain Incident·WorkOrder 经策略后创建 Agent/Human Task | 产品 M2M → DoerFlow integration inbox |
| 回调 | 签名 CloudEvents 生命周期；**不**自动 ack/resolve 源对象 | DoerFlow → 产品 webhook |

机器身份：Logto **MachineToMachine** 应用 `VistaCast Service` 与 `SyncroBrain Gateway`；token **audience** = `https://api.doerflow.local`（DoerFlow API）。最小 scopes：

- `integration.provider.register`
- `integration.event.submit`
- `integration.callback.read`

M2M **没有** OIDC redirect/callback；产品 SPA 仍走 PKCE。Management API M2M 仅 identity 运维，不得进入产品仓。JWT 只携带 `issuer + sub`（及 org 准入）；`sourceTenantId` / offering 由 DoerFlow 本地映射持久化，不进中央权益表。

平台套餐门禁（中央 Entitlement，见 [subscription-and-entitlement.md](../subscription-and-entitlement.md)）：`integration.provider.register`、`integration.event.submit`、`integration.event.monthly`、`integration.api.monthly`。**Pro 不开放** provider/event 写（计划上省略这些 feature，禁止用 `deny` 以免并集被覆盖）；**Ultra** 小额月配额（1 万事件 / 10 万 API 调用）；**Enterprise** 高额（10 万事件 / 1000 万 API 调用）。**不**覆盖协议费、Job 单价、Escrow 或 Gas。VistaCast / SyncroBrain 可在中央目录占位，**就绪前不售卖**独立 ToC 价格方案，也 **不发放 Trial**。

## 身份、权益与协议经济

接入顺序固定为 **Logto AuthN → 中央 Entitlement → DoerFlow Casbin**。

| 层 | DoerFlow 契约 |
|----|---------------|
| 平台身份 | Logto 会话负责会员、组织和平台 API；与钱包连接/SIWE 分离 |
| 钱包身份 | 钱包证明地址并直接签名；私钥不离开 web/mobile 客户端，Logto 不代表钱包所有权 |
| 套餐 | 仅 Pro / Ultra / Enterprise；`trialPolicy=disabled`，不得有免费试用 CTA、倒计时或自动 Trial |
| 会员快照 | `GET /api/v1/platform/membership` 返回 `effectivePlan`、组织和 quota；不从 JWT 推断 |
| 钱包链接 | 平台 JWT + 新鲜 SIWE 证明；UI 显示链接状态但不能把链接当作密钥托管 |
| 资源授权 | admin/web 控件消费 API `permissions`；不使用 mock role 或 Logto claim 授予资源操作 |

商业边界：Pro/Ultra/Enterprise 控制托管平台能力（`agent.publish`、`skill.register`、`task.publish`、API/任务配额等）。跨产品 `integration.provider.register` / `integration.event.submit` **仅 Ultra 与 Enterprise**；Gas、Escrow、协议费、Skill/任务链上按次价格仍由协议路径收取，购买平台套餐不免除也不替代协议费用。预留 `ai.strategy.run` 仅表示可选策略推理，**未实现**；ChainSkill 不是中央 AiTool。

错误和降级：`401` 要求平台登录；`402 ENTITLEMENT_*` 进入稳定升级/配额流程；`403` 表示 Casbin 资源拒绝。公开 marketplace 与直接链签名保持可用。rollout 为 `off` → `shadow_read` → 小范围 `enforce` → 全量，并保留快速回滚开关。

## 可组合部署边界

权威：[composable-deployment.md](../composable-deployment.md)。DoerFlow 是 `agent-commerce` 与 `smart-site` 的结算平面，但 **standalone 必须可售**。

### 最小独立依赖

- 自有 API、合约仓、钱包 / worker 客户端、PostgreSQL 与 Casbin
- 平台身份可走外部 OIDC 或中央 Logto；**不**把钱包私钥放到控制面
- 权益：`trialPolicy=disabled`；`entitlement=off` 时公开 marketplace 与链签名仍可用
- AI：`ai=off`（`ai.strategy.run` 仅预留）；不依赖中央 AI Platform

### 可选兄弟产品

| 产品 | 场景 | 关闭后 |
|------|------|--------|
| VistaCast | `alert.v1`→Task；告警证据 / 客流报表 Skill | 关闭 integration offering，本网任务市场仍运行 |
| SyncroBrain | Incident→Task；遥测 / Incident 报表 Skill | 同上；**不**代执行设备 RPC |
| DataLuminary | 运行与交易可视化 | 去掉导出 |
| VistaRemote | 远程桌面调试 Worker | 去掉深链 |
| BlockyEdu | 合约 / Agent 课程 | 无运行依赖 |

### 降级方式

- `ENTITLEMENT_MODE`：`off` → `shadow_read` → 小范围 `enforce`；中央 `:3040` 不可达且无合法缓存时关键路径 fail closed
- `identity` 仅 `fail_closed`；平台 JWT 与 SIWE **不得**互相推断
- 跨产品 integration 默认可关；回调失败可观察，**不**自动 ack / resolve 源对象
- `ai=central` 禁止进入本产品的 pilot/production Manifest

### 数据所有权

目录、Job、Receipt `authorize` / `capture` / `void`、账本与 Merkle。VistaCast / SyncroBrain 仍拥有各自事件与最终 ack/resolve。`sourceTenantId` / offering 映射留在 DoerFlow，**不进**中央权益表。

### 不得宣称上线的 lab·stub

- 公开 marketplace 变现**未**打生产 tag，不得宣称已上线
- `ai.strategy.run` **未实现**；ChainSkill ≠ 中央 AiTool
- 不得把协议费 / Escrow / Gas 说成套餐内已包含
- VistaCast stub / 人脸 / staff / fall-smoke **不可**经本网生产变现

## 官网与文档呈现

- **doerflow.dev**：品牌站 SSG，生态区块可链至六产品官网（见 `repos/site`）。
- **docs.doerflow.dev**：部署见 `repos/docs` + `scripts/docs-sites.config.ps1` 中 `doerflow`。

## 开源许可

生态默认 **[Polyform Noncommercial 1.0.0](../../LICENSE)**（Polyform-NC）；商业使用须另行授权。各 `repos/*` 子仓独立 LICENSE。

## MetaRepo 延伸阅读

- [DoerFlow `spec/ROADMAP.md`](https://github.com/DoerFlow/DoerFlow/blob/main/spec/ROADMAP.md)
- [LuminaryWorks `spec/domain-and-branding.md`](../domain-and-branding.md)
- [LuminaryWorks `spec/legal/README.md`](../legal/README.md)（工程模板，非法律意见）
- [LuminaryWorks `docs` 产品页 — DoerFlow](https://docs.luminaryworks.dev/products/doerflow)
