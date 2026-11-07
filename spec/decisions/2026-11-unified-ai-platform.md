# ADR：统一 AI 平台 —— 能力路由 + 钱包账本 + 平台级 Provider（2026-11）

> **状态**：Accepted（设计）· **决策日**：2026-11-06 · **实现**：未开始（按 §6 分阶段）  
> **修订**：[ai-platform.md](../ai-platform.md) D-AI-1 / D-AI-4 · [ai-metering.md](../ai-metering.md) §1  
> **新增契约**：[ai-capability-routing.md](../ai-capability-routing.md) · [ai-wallet-and-billing.md](../ai-wallet-and-billing.md)

## 1. 背景

- 邮件（`services/notification`）、支付（`services/entitlement` payments）、登录（`services/auth-gateway`）已在 LuminaryWorks 集中；**AI 仍是各产品各配一份**。
- DataTalk 有 `AiSettingsService` / `AiVaultService` / `AiProviderAdapter`；BlockyEdu 有 `provider-settings.service` 并自己拼 STT/TTS endpoint（与 `ai-client/speech.ts` 重复）。同一个 DeepSeek key 要在每个产品里重配。
- `services/ai-platform` 当前是 lab 原型：连接存 JSON 文件、用量存进程内存、无鉴权、无 entitlement 校验（[ai-platform.md §7](../ai-platform.md) 五个 gate 全 false）。
- 网关契约只有 `messages` + `jsonSchema`，没有 tool calling、多模态内容块、图片 / 视觉 / 发音评测，无法承接 BlockyEdu 编程 Agent、DataLuminary 配图自检、VistaCast 视频理解。
- 业务目标：用户只在 LuminaryWorks 充值，由平台统一采购上游模型流量，用户在产品内选择模型（类 Cursor 体验）；一个余额跨产品使用。

## 2. 决策

| # | 决策 |
|---|------|
| D-AI-10 | **Provider / Vault / 路由由 LuminaryWorks 平台统一持有**。产品不再保存、枚举或加密 Provider 密钥；产品侧只保留一组 `LUMINARY_PLATFORM_*` 接入配置（base URL + 服务凭证）。 |
| D-AI-11 | **产品请求「能力 + 档位」，不请求模型名**。能力（`chat.text` / `chat.code` / `chat.reasoning` / `embed` / `stt` / `tts` / `voice.turn` / `speech.assess` / `image.generate` / `vision.understand`）与档位（`economy` / `standard` / `premium`）由平台 Route 表映射到有序 (provider, model) 列表。用户可选模型仅限产品 `allowedModels` 白名单。详见 [ai-capability-routing.md](../ai-capability-routing.md)。 |
| D-AI-12 | **钱进在 Entitlement，额度出在 AI Platform**。Entitlement 管订单、支付、退款；充值成功后发以 `orderId` 为幂等键的 grant 事件。AI Platform 用自有 Postgres 持有额度账本（预占 → 结算），因为这是高频路径。详见 [ai-wallet-and-billing.md](../ai-wallet-and-billing.md)。 |
| D-AI-13 | **额度是带限制的 grant**（产品 / 能力 / 有效期），不是裸余额。BlockyEdu 口语分钟 = 限定 `voice.*` 的 grant，内部统一按额度扣，对外仍显示分钟，**不新增第二套账**。 |
| D-AI-14 | **Rate Card 带版本**：`售价 = 上游成本 × 加价系数 (+ 固定费)`；上游调价触发告警，禁止静默吃掉毛利。 |
| D-AI-15 | **公共 API 前期开放，必须 day-1 按「可关闭」设计**（见 §3）。 |
| D-AI-16 | **fail closed**：Entitlement / 账本无法确认时，托管路径拒绝；BYOK 路径不受影响。 |
| D-AI-17 | 平台默认**不存 prompt / 响应正文**，只存元数据（沿用 D-AI-5）。K12 产品（BlockyEdu）输出必须过内容审核。 |
| D-AI-18 | 私有化交付不依赖中央平台：`ai=local_byok` 继续存在，本地适配器与中央平台共用 `@luminaryworks/ai-client` 同一契约。 |

D-AI-1（「只做模型网关」）修订为：**模型网关 + 钱包账本 + 路由**。仍然**不**判断产品资源 ACL（D-AI-3 不变）。D-AI-4 修订为：**托管为默认**，BYOK 为可选。D-AI-9（不自建 GPU）不变：转售云 API 不是自托管。

## 3. 公共 API：前期开放 → 规模后关闭

产品决策：早期开放公共 OpenAI 兼容入口以获取增长，用户规模达到阈值后关闭。为使「关闭」不是一次重构，约束如下：

1. **独立入口与独立 Surface**：公共 API 走 `/v1/public/*`，使用独立的 API key 类型（`surface=public`）；产品内部调用用服务凭证（`surface=product`）。两者共享路由与账本，**不共享**限流与预算。
2. **功能开关**：`PUBLIC_API_ENABLED`（运行时可热切换）。关闭后 `/v1/public/*` 返回 404（不泄露能力存在），**产品内调用不受影响**。
3. **每 key 预算与限流**：每个 public key 必须有额度上限与 RPM / TPM 上限；无上限的 key 不允许创建。
4. **用户条款在开放第一天就写明**：公测性质、可能调整或关闭、关闭时的余额处理（退款或迁移为产品内额度）及有效期。余额处理规则不得事后补写。
5. **关闭阈值需量化并记录**：由运营在上线前填入 `ai-wallet-and-billing.md` §9 的阈值表（活跃 key 数、月毛利、上游成本占比、违规率）。
6. **上线前合规检查（运营 / 法务，非代码门禁）**：上游厂商条款是否允许转售；国内生成式 AI 备案与实名要求；预付费余额的退款与有效期规则；所选支付渠道是否允许销售「额度」。**这些是公共 API 对外开放的前置条件**，未确认前公共入口保持 `PUBLIC_API_ENABLED=false`，产品内托管路径可先行。

## 4. 影响与取舍

| 取舍 | 说明 |
|------|------|
| 平台成为关键路径 | 所有托管 AI 依赖它。因此 P1 先翻转 §7 的五个 gate，再接计费 |
| 账本双源风险 | 钱（Entitlement）与额度（AI Platform）分两库。用 orderId 幂等 + 对账 job 控制；退款回收走显式事件 |
| 契约破坏 | `CompleteChatInput` 加 tools / content parts 是 v2，**v1 保持可用**，产品按阶段迁移 |
| 毛利暴露 | 上游调价、缓存命中、reasoning token 都会改变真实成本，必须按实际 usage 结算而非预估 |

## 5. 不做

- 不在平台判断 space / dashboard / dataset / device 权限。
- 不自建 GPU / Ollama / vLLM 作为生产默认。
- 不把额度写进 JWT。
- VistaCast 实时 CV 不经网关（D-AI 既有边界不变）。

## 6. 分阶段

| 阶段 | 内容 | 门禁 |
|------|------|------|
| P0 | 口语评测集 + 配图评测集，拿基线 | 有基线数字 |
| P1 | 平台加固：Postgres、服务鉴权、Vault、`/ready`、Entitlement 校验；契约 v2 | `AI_CENTRAL_HARDENING_GATES` 全 true |
| P2 | 账本：grant / reserve / settle、Rate Card、Entitlement 充值入账、最小管理台 | Sonnet 评审幂等与退款 |
| P3 | DataLuminary 迁移 + 配图改进 | 配图评测集不低于基线 |
| P4 | BlockyEdu 迁移 + `voice.turn` + `speech.assess` | 口语评测集达标 |
| P5 | VistaCast `vision.understand` 异步 job | 单设备成本上限生效 |
| P6 | BYOK、企业合同、模型选择 UI、毛利看板、公共 API 关闭开关演练 | |
