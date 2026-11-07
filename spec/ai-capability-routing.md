# AI 能力路由与契约 v2

> **状态**：Accepted（设计）· **决策**：[2026-11-unified-ai-platform.md](./decisions/2026-11-unified-ai-platform.md) D-AI-10 / D-AI-11  
> **关联**：[ai-platform.md](./ai-platform.md) · [ai-provider-and-vault.md](./ai-provider-and-vault.md) · [ai-wallet-and-billing.md](./ai-wallet-and-billing.md)  
> **兼容**：v1（`/v1/chat/complete` 等）保持可用；v2 为新增，产品按阶段迁移。

## 1. 能力与档位

| 能力 | 形态 | 主要使用方 |
|------|------|------------|
| `chat.text` | 同步 / 流式 | 全部 |
| `chat.code` | 流式，需 tools | BlockyEdu 编程 Agent |
| `chat.reasoning` | 流式 | DataLuminary 配图规划、洞察 |
| `embed` | 同步 | DataTalk Semantic RAG、BlockyEdu 课程 RAG |
| `stt` | 同步 / 流式 | BlockyEdu |
| `tts` | 同步 / 流式，可缓存 | BlockyEdu |
| `voice.turn` | 流式管线（STT → LLM → 按句 TTS） | BlockyEdu 口语 |
| `speech.assess` | 同步，返回发音评分 | BlockyEdu 口语 |
| `image.generate` | async job | 预留 |
| `vision.understand` | 同步 / async job | VistaCast、DataLuminary 渲染后自检 |

档位：`economy` · `standard` · `premium`。产品请求 `(capability, tier)`，不带 provider / model。

`supportedPurposes`（[ai-provider-and-vault.md §2](./ai-provider-and-vault.md)）只声明 **adapter 已接通** 的能力；未实现的能力不得出现在 Route 表。

## 2. Route 表

```typescript
interface Route {
  id: string;
  capability: Capability;
  tier: "economy" | "standard" | "premium";
  candidates: Array<{
    providerType: string;
    model: string;
    connectionUid: string;   // 平台 Vault 内的连接
    priority: number;        // 越小越优先
    enabled: boolean;
    healthy: boolean;        // 由 health probe 与近期错误率维护
  }>;
  fallbackPolicy: "next_candidate" | "fail";
  latencyBudgetMs?: number;  // voice.turn 首包预算
  rateCardId: string;        // 指向 ai-wallet-and-billing.md Rate Card
}
```

规则：

1. 选择 = 过滤 `enabled && healthy` → 按 `priority`；失败且 `fallbackPolicy=next_candidate` 时换下一个。
2. **流式已开始输出后不换候选**（避免重复内容），只能终止并在结算中标记 `partial`。
3. 同一次请求的 `traceId` 贯穿所有候选尝试；每次尝试都写计量事件，只有成功那次计费。
4. 路由变更（上线新模型、下线、切换优先级）只改平台配置，**不要求产品发版**。
5. Route 表由平台管理台维护，变更写审计日志。

## 3. 产品策略（`allowedModels`）

```typescript
interface ProductAiPolicy {
  productCode: "blockyedu" | "dataluminary" | "vistacast" | string;
  allowedCapabilities: Capability[];
  defaultTier: Record<Capability, Tier>;
  // 用户可选模型（Cursor 式选择器）；缺省 = 只能用档位默认
  userSelectable?: Array<{
    capability: Capability;
    options: Array<{ label: string; routeId: string; multiplier: number }>;
  }>;
  contentSafety: "none" | "standard" | "k12";
  logPrompts: false;           // D-AI-17：恒为 false
  perUserDailyCreditCap?: number;
}
```

- `multiplier` 是展示用的倍率（premium 模型扣更多额度），真实扣费以 Rate Card 为准。
- `contentSafety=k12` 时平台对输入输出过审核，命中则拒绝并返回 `CONTENT_BLOCKED`；BlockyEdu 必须使用此值。

## 4. 请求契约 v2

```typescript
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; url?: string; base64?: string; mime?: string }
  | { type: "audio"; base64: string; mime: string };

interface ChatMessageV2 {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolCallId?: string;
}

interface ChatRequestV2 {
  capability: "chat.text" | "chat.code" | "chat.reasoning" | "vision.understand";
  tier?: "economy" | "standard" | "premium";
  routeId?: string;                 // 必须在产品 allowedModels 内
  messages: ChatMessageV2[];
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  toolChoice?: "auto" | "none" | { name: string };
  responseFormat?: { type: "json_schema"; schema: Record<string, unknown>; strict?: boolean };
  maxTokens?: number;               // 预占额度的上限依据，必填
  cache?: { prefixKey?: string };   // 上游支持 prompt cache 时使用
  // 计费与审计
  productCode: string;
  subjectId: string;
  organizationId?: string;
  feature?: string;
  conversationUid?: string;
  idempotencyKey: string;           // 必填；重试不得重复扣费
}
```

响应在 v1 基础上增加：`toolCalls`、`usage.cachedTokens`、`usage.reasoningTokens`、`routeId`、`attempts[]`、`costCredits`（实际结算额度）。

流式事件：`delta` · `tool_call` · `usage` · `done` · `error`，`error` 带稳定 `code`（见 §8）。

## 5. 异步 Job（视觉 / 图像）

```text
POST /v2/jobs            { capability, input, callbackUrl?, idempotencyKey } → { jobId }
GET  /v2/jobs/:jobId     → { status: queued | running | succeeded | failed | cancelled, result?, costCredits? }
```

- 创建时预占额度；完成时结算；失败退回预占。
- `callbackUrl` 必须是产品登记的域名；回调带平台签名。
- VistaCast：边缘只上传 **关键帧或事件片段**；每设备每日额度上限由产品策略 `perUserDailyCreditCap` 的设备级等价项承担。

## 6. `voice.turn`（BlockyEdu 口语）

目标：把现有「产品 → 平台 → STT」「产品 → 平台 → LLM」「产品 → 平台 → TTS」三次串行往返，收敛为一条流式管线。

```text
client audio → [STT stream] → partial/final transcript
             → [LLM stream, Teaching Engine 注入 system/context]
             → 按句切分 → [TTS stream] → client audio chunks
```

- 产品（Teaching Engine）通过 `onTranscript` 回调决定下一句 prompt，**教学策略仍在产品内**；平台只编排 STT / LLM / TTS 与计费。
- 首包预算 `latencyBudgetMs`（初值待 P0 评测基线后确定，不在本文写死）。
- 必须同时落 STT transcript（与 BlockyEdu 仓 `spec/edu-ai-platform-spec.md` 对 realtime 的要求一致：端到端 S2S 不得作为唯一输入输出）。
- TTS 缓存键：`provider+model+voice+locale+speed+normalizedText`（沿用 `ttsCacheKey`）。

## 7. `speech.assess`

```typescript
interface SpeechAssessRequest {
  audioBase64: string; mime: string;
  referenceText: string; locale: string;
  productCode: string; subjectId: string; idempotencyKey: string;
}
interface SpeechAssessResult {
  overall: number;                  // 0–100
  accuracy?: number; fluency?: number; completeness?: number; prosody?: number;
  words: Array<{ word: string; score: number; phonemes?: Array<{ ipa: string; score: number }> }>;
  providerType: string; model: string;
}
```

通用 STT（Whisper 类）**不产出**发音评分，不得冒充本能力。具体上游厂商由 P0 评测集在 Azure Speech、讯飞、SpeechSuper 等候选中选定，写入 Route 表，不写死在代码。

## 8. 错误码（稳定）

`AUTH_REQUIRED` · `FORBIDDEN` · `ENTITLEMENT_DENIED` · `INSUFFICIENT_CREDITS` · `MODEL_NOT_ALLOWED` · `CAPABILITY_NOT_ENABLED` · `ROUTE_UNAVAILABLE` · `CONTENT_BLOCKED` · `RATE_LIMITED` · `PROVIDER_ERROR` · `IDEMPOTENCY_CONFLICT` · `PUBLIC_API_DISABLED` · `VALIDATION_ERROR` · `EPHEMERAL_NOT_ALLOWED` · `VAULT_UNAVAILABLE` · `NOT_IMPLEMENTED`

| 码 | HTTP | 语义 |
|----|------|------|
| `AUTH_REQUIRED` | 401 | 无凭证或凭证无效 |
| `FORBIDDEN` | 403 | 已认证，但连接 / 资源超出调用者范围 |
| `ENTITLEMENT_DENIED` | 403 | feature 未授权，或 `subjectId` 与已认证用户不一致 |
| `ENTITLEMENT_DENIED` | 503 | Entitlement 不可达（fail closed，D-AI-16）；与 403 同码，靠 HTTP 状态区分 |
| `VALIDATION_ERROR` | 400 | 入参不合法（缺 `maxTokens` / `idempotencyKey` / `subjectId` 等） |
| `EPHEMERAL_NOT_ALLOWED` | 400 | 生产环境业务路径携带请求体密钥（仅 `/v1/providers/test` 允许） |
| `VAULT_UNAVAILABLE` | 503 | 缺 `AI_VAULT_MASTER_KEY`，拒绝保存密钥 |
| `NOT_IMPLEMENTED` | 501 | 已预留未实现（v2 骨架、`/v1/public/*` 开启后） |

## 8.1 调用者与信任模型（P1 评审结论）

| 调用者 | 凭证 | 身份来源 | 可管理的连接 |
|--------|------|----------|--------------|
| 产品 BFF（`kind=service`） | 服务凭证 | **请求体**的 `subjectId` / `organizationId`（必填，受信） | 全部（含 `deployment`、`space`） |
| 终端用户（`kind=user`） | OIDC JWT | **仅 token**；请求体不一致 → 403 | 仅 `ownerKind=user` 且 owner 为自己，或 `ownerKind=organization` 且 owner 为 token 中的 org |

- 用户 token **不能**直接使用托管（`deployment`）连接；托管路径只经产品 BFF。公共 API（D-AI-15）上线时需要自己的 principal 类型，不复用 `user`。
- OIDC 模式必须显式配置 issuer、audience、JWKS URI；算法白名单 `RS256` / `ES256`。`legacy`（HS256）仅在显式配置密钥时可用，**生产禁用**。
- **P2 前置要求（待办）**：当前所有产品共用一把服务凭证，任一产品的 BFF 可以声称自己是另一个产品。进入账本阶段前，服务凭证必须**绑定 `productCode`**，请求体里的 `productCode` 与凭证绑定值不一致则拒绝；否则扣费与 entitlement 归属可被伪造。

## 9. 产品接入变化

| 产品 | 删除 | 保留 |
|------|------|------|
| DataLuminary | DataTalk 本地 Provider 设置 / Vault / `AiProviderAdapter` 的密钥与模型枚举逻辑 | Semantic Layer、Chart 校验、ToolRegistry、Casbin |
| BlockyEdu | `provider-settings.service`、`voice-adapter.ts` 内自拼 endpoint 与 provider 排序 | Teaching Engine、Student Model、Lesson Report、ai-bridge 编排 |
| VistaCast | — | 边缘 CV、告警规则；新增对 `vision.understand` job 的调用 |

迁移期保留产品内「BYOK 设置页」，但存储改为调用平台 `ownerKind=user|space|organization` 的连接接口；产品库不再持有密文。
