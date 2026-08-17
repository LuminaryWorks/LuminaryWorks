# AI 计量与计费

> **状态**：Accepted · **关联**：[ai-platform.md](./ai-platform.md) · [subscription-and-entitlement.md](./subscription-and-entitlement.md)

## 1. 计费模式（混合）

| 阶段 | 谁付钱 | 计量 |
|------|--------|------|
| MVP | 客户 BYOK | 只记 token / 次数，用于审计与配额展示 |
| 后期 | LuminaryWorks managed credits | 中央扣减额度；产品只展示余额 |
| 企业 | 合同 feature + 可选包量 | Entitlement quota + usage_counters |

**禁止** 把 token 用量写进 JWT。商业开关仍是 Entitlement feature（如 `ai.analysis`）。

## 2. 用量事件

```typescript
interface AiUsageEvent {
  productCode: string;
  subjectId: string;
  organizationId?: string | null;
  spaceUid?: string;
  conversationUid?: string;
  providerType: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  billed: "byok" | "managed";
  at: string;
}
```

产品本地可落 `ai_usage` 表；中央平台后期接收同一事件。

## 3. 与 Entitlement 的关系

- Feature 决定 **能不能用 AI**。
- Quota（后期）决定 **还能用多少托管额度**。
- BYOK 默认不消耗托管 quota，但仍受 feature 与产品 ACL 约束。
- fail closed：Entitlement 不可确认时拒绝付费 AI 路径。
