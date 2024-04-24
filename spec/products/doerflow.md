# DoerFlow · 智工网 跨产品 Spec

> **外部文档优先**：[doerflow.dev](https://doerflow.dev) · [docs.doerflow.dev](https://docs.doerflow.dev)。本文件为 MetaRepo 内 **LuminaryWorks** 视角的简报；**权威实现与合约以 `doerflow/VibeAgent` MetaRepo** 为准。

## 品牌与仓库

| 项 | 值 |
|----|-----|
| 品牌 | **DoerFlow** · 智工网 |
| 官网 | [doerflow.dev](https://doerflow.dev) |
| 文档 | [docs.doerflow.dev](https://docs.doerflow.dev)（Rspress） |
| DApp | [app.doerflow.dev](https://app.doerflow.dev) |
| 管理端 | [admin.doerflow.dev](https://admin.doerflow.dev) |
| GitHub 组织 | [github.com/doerflow](https://github.com/doerflow) |
| MetaRepo | [doerflow/VibeAgent](https://github.com/doerflow/VibeAgent)（历史品牌 **VibeAgent**；`luminaryworks-ecosystem.md`、`spec/CONVENTIONS`） |
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
| 可选跨产品 | 运行数据 → **DataLuminary**；设备 Agent → **SyncroBrain**；远程调试 → **VistaRemote** |

## 兄弟产品与集成

| 产品 | 官网 | 场景 |
|------|------|------|
| [DataLuminary](https://dataluminary.dev) | [dataluminary.dev](https://dataluminary.dev) | Agent 运行与交易数据可视化 |
| [BlockyEdu](https://blockyedu.com) | [blockyedu.com](https://blockyedu.com) | 智能合约与 Agent 开发课程 |
| [SyncroBrain](https://syncrobrain.com) | [syncrobrain.com](https://syncrobrain.com) | 设备注册 Agent、遥测触发推理 |
| [VistaRemote](https://remote.vistacast.dev) | [remote.vistacast.dev](https://remote.vistacast.dev) | 远程调试 Worker / 边缘设备 |
| [VistaCast](https://vistacast.dev) | [vistacast.dev](https://vistacast.dev) | 视觉 Skill（规划） |

集成原则（MetaRepo）：跨产品仅 REST + OIDC（`@luminary/auth-core`）；链上逻辑留在 `repos/contracts`。生态叙事详见 [doerflow `spec/luminaryworks-ecosystem.md`](https://github.com/doerflow/VibeAgent/blob/main/spec/luminaryworks-ecosystem.md)。

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

商业边界：Pro/Ultra/Enterprise 控制托管平台能力（`agent.publish`、`skill.register`、`task.publish`、API/任务配额等）；Gas、Escrow、协议费、Skill/任务链上按次价格仍由协议路径收取，购买平台套餐不免除也不替代协议费用。

错误和降级：`401` 要求平台登录；`402 ENTITLEMENT_*` 进入稳定升级/配额流程；`403` 表示 Casbin 资源拒绝。公开 marketplace 与直接链签名保持可用。rollout 为 `off` → `shadow_read` → 小范围 `enforce` → 全量，并保留快速回滚开关。

## 官网与文档呈现

- **doerflow.dev**：品牌站 SSG，生态区块可链至六产品官网（见 `repos/site`）。
- **docs.doerflow.dev**：部署见 `repos/docs` + `scripts/docs-sites.config.ps1` 中 `doerflow`。

## 开源许可

生态默认 **[Polyform Noncommercial 1.0.0](../../LICENSE)**（Polyform-NC）；商业使用须另行授权。各 `repos/*` 子仓独立 LICENSE。

## MetaRepo 延伸阅读

- [doerflow `spec/ROADMAP.md`](https://github.com/doerflow/VibeAgent/blob/main/spec/ROADMAP.md)
- [LuminaryWorks `spec/domain-and-branding.md`](../domain-and-branding.md)
- [LuminaryWorks `docs` 产品页 — DoerFlow](https://docs.luminaryworks.dev/products/doerflow)
