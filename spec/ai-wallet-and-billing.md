# AI 钱包与计费

> **状态**：Accepted（设计）· **决策**：[2026-11-unified-ai-platform.md](./decisions/2026-11-unified-ai-platform.md) D-AI-12 ~ D-AI-16  
> **关联**：[ai-metering.md](./ai-metering.md) · [ai-capability-routing.md](./ai-capability-routing.md) · [payment-platform.md](./payment-platform.md) · [subscription-and-entitlement.md](./subscription-and-entitlement.md)

## 1. 职责切分

| 关心的事 | 权威 | 说明 |
|----------|------|------|
| 订单、支付、退款、税、对账 | **Entitlement** | 沿用 [payment-platform.md](./payment-platform.md)；本文不改动 |
| 套餐与 feature 开关（能不能用 AI） | **Entitlement** | 如 `ai.analysis`、`ai.voice` |
| 额度发放后的**消耗** | **AI Platform 账本** | 预占、结算、回收、流水 |
| 每月订阅赠送额度的发放规则 | Entitlement 定义，AI Platform 执行 | 以幂等 grant 事件传递 |

**Entitlement → AI Platform 只传事件，不在每次推理时回调。** 推理热路径只访问 AI Platform 自己的 Postgres。

## 2. 记账单位

- **Credit（额度）**：整数 `micro_credit`（1 credit = 1,000,000 micro_credit），避免浮点。
- 1 credit 对应的法币价值由 **Rate Card 与定价**决定，**不写在本文**；运营在上线前设定并存入配置（USD 与 CNY 各一套）。
- 用户界面可按产品展示为额度、分钟或次数；内部只有 micro_credit。

## 3. Grant（发放）

```typescript
interface CreditGrant {
  grantId: string;                 // 全局唯一
  walletId: string;
  kind: "topup" | "subscription" | "promo" | "trial" | "refund_reversal";
  amountMicro: bigint;             // 初始额度
  remainingMicro: bigint;
  expiresAt?: string;              // 订阅 / 促销 / 试用必须有；topup 由运营政策决定
  restrictTo?: {                   // 限定条件；全部缺省 = 通用
    productCodes?: string[];
    capabilities?: string[];       // 如 ["voice.turn","stt","tts","speech.assess"]
  };
  source: { type: "order" | "subscription_period" | "admin" | "promo"; id: string };
  createdAt: string;
}
```

- **幂等**：`source(type,id)` 唯一。同一 `orderId` 重复投递只发一次。
- **扣减顺序**（固定，写进代码与测试）：
  1. 限定且最快过期的 grant；
  2. 通用且最快过期的 grant；
  3. 无过期的 topup。
- BlockyEdu 口语分钟：`restrictTo.capabilities = voice.*`，`kind=subscription | topup | trial`。家长看到分钟 = `remainingMicro ÷ voice 单价` 的展示换算。

## 4. Wallet

```typescript
interface Wallet {
  walletId: string;
  ownerKind: "user" | "organization";   // space 不拥有钱包，由 organization 付费
  ownerId: string;
  currency: "USD" | "CNY";              // 记账币种，创建时确定，不可变
  status: "active" | "frozen" | "closed";
}
```

- 一个 owner 一个钱包，**跨产品共用**；限制通过 grant 的 `restrictTo` 实现，而不是多钱包。
- `frozen`（风控 / 争议）：拒绝新预占，进行中的流可结算完成。
- 组织场景：成员消耗扣组织钱包；可设 `perUserDailyCreditCap`。

## 5. 预占 → 结算

```text
1. reserve(requestId, walletId, estimateMicro)    -- estimate = maxTokens × 上限单价 (+ 音频/图片按上限)
   - 在单事务内按 §3 顺序锁定并"占用"若干 grant，写 hold 行
   - 不足 → INSUFFICIENT_CREDITS（不调用上游）
2. 调用上游（流式）
3. settle(requestId, actualUsage)
   - 由上游实际 usage + 当前 Rate Card 计算 actualMicro
   - actualMicro ≤ estimate：释放差额；> estimate：只多扣到钱包可用余额，缺口记 `overrun`，不使流中断
4. 失败或取消：release(requestId) 退回全部预占；已输出的部分按实际用量结算（partial）
```

不变量（必须有测试）：

1. 同一 `idempotencyKey` 的 reserve / settle 重复调用结果相同，不重复扣费。
2. 任一时刻 `sum(grant.remaining) + sum(hold) + sum(settled) = sum(grant.amount)`（对账等式）。
3. 并发预占不得使可用余额为负（`SELECT … FOR UPDATE` 或等价序列化）。
4. hold 超时（默认 15 分钟）由回收 job 释放，并记审计。
5. 预占与结算都写 append-only 流水 `ledger_entries`；**禁止 UPDATE / DELETE 流水**，修正只能追加反向分录。

### 5.1 流式中途余额耗尽

预占已覆盖 `maxTokens` 上限，正常情况下不会中途耗尽。`overrun`（如上游多算 reasoning token）超过阈值（初值：预占的 20%）时，终止流并返回 `INSUFFICIENT_CREDITS` + `partial=true`，已输出部分按实际结算。

## 6. Rate Card

```typescript
interface RateCard {
  id: string;
  version: number;                 // 只增不改；改价 = 新版本
  effectiveFrom: string;
  lines: Array<{
    capability: string;
    providerType: string;
    model: string;
    unit: "1k_input_tokens" | "1k_output_tokens" | "1k_cached_input_tokens"
        | "audio_second_in" | "audio_second_out" | "image" | "assessment" | "video_second";
    upstreamCostMicroUsd: bigint;  // 上游成本（可由厂商价目手工录入）
    markupBps: number;             // 加价，基点；如 3000 = +30%
    fixedFeeMicro?: bigint;
  }>;
}
```

- 结算时记录 `rateCardId + version`，历史账单可复算。
- **上游调价检测**：管理台录入新上游成本时，若某 line 的毛利率低于 `minMarginBps`（运营设定），拒绝发布或要求二次确认。
- 缓存命中 token、reasoning token 必须有独立单价行，否则按最贵行结算并告警。
- 加价系数是**待验证的假设**，不在本文给定数值；上线前由运营用 P0 评测得到的真实成本验证。

## 7. 用量事件扩展

在 [ai-metering.md §2](./ai-metering.md) `AiUsageEvent` 基础上增加：`walletId`、`grantIds[]`、`rateCardId`、`rateCardVersion`、`upstreamCostMicroUsd`、`chargedMicro`、`routeId`、`attemptIndex`、`partial`、`surface`（`product` | `public`）、`apiKeyId?`。

- 事件进 Postgres（不得只在进程内存，对应 gate `persistentMetering`）。
- **`billed` 取值**：`byok`（不扣额度，只计量）· `managed`（扣额度）· `contract`（企业合同，按合同包量）。

## 8. Entitlement 集成

### 8.1 充值入账

```text
Entitlement: order paid → outbox event ai.credit.grant { orderId, walletOwner, amountMicro, expiresAt?, restrictTo? }
AI Platform: 验签 → 以 source=(order, orderId) 幂等创建 grant → 回执
```

- 回执失败时 Entitlement outbox 重试；AI Platform 重复接收返回已存在。
- **订单已支付但 grant 未创建**必须出现在对账报表里，超过 N 分钟告警。
- 实现：履约事务另写 outbox `ai.credit.grant`（全额退款 `ai.credit.revoke`）；额度只来自 `AI_CREDIT_GRANT_BY_SKU_JSON` 或 `AI_CREDIT_MICRO_PER_VOICE_SECOND` × 口语包秒数，未配置则跳过且不阻断支付履约。

### 8.2 退款

```text
Entitlement: refund → event ai.credit.revoke { orderId, amountMicro? }
AI Platform: 回收对应 grant 的 remaining；已消耗部分不可回收，写 refund_reversal 分录；
             若 remaining 不足，返回 shortfall，由运营决定是否冻结钱包或走人工
```

进行中的 hold **不**在 revoke 时强制取消（避免打断已在飞的上游调用）。随后 hold 的 `release` / `expire` / 部分 `settle` 归还额：

- 若 grant 尚未撤销 → 加回 `remaining_micro`（可再花）
- 若 grant 已有 `revoked_at` → **禁止**加回 `remaining`；改为 `revoked_micro += give`，并下调 `revoke_shortfall_micro`（clawback）。流水仍用 `refund_reversal`，`meta.fromHoldRelease=true`

`revokedAt != null` 的 grant 一律不可再被 `reserve` 选中（即使 residual remaining 因竞态非零）。

对账等式（revoke 之后，含随后的 clawback）：

`sum(grant.amount) = sum(remaining) + sum(pending holds) + sum(settled) + sum(revoked_micro)`

### 8.3 订阅月度额度

订阅周期开始时 Entitlement 发 `kind=subscription` grant（有 `expiresAt` = 周期末），`source=(subscription_period, periodId)`。

### 8.4 feature 校验

托管路径入口仍须检查 Entitlement feature（如 `ai.voice`、`ai.analysis`）。**额度够但没有 feature**也拒绝。Entitlement 不可达时按 D-AI-16 fail closed；校验结果可用短 TTL 缓存（初值 60 秒），缓存键含 `subjectId + feature`。

## 9. 公共 API 的计费与关闭阈值

- public key 绑定钱包；每个 key 必须设置 `budgetMicroPerDay` 与 RPM / TPM。
- 关闭前提：先宣布 → 停止新建 key → 到期关闭入口；余额按条款退款或转为产品内 grant。
- **阈值表（运营在上线前填写，本文不设数值）**：

| 指标 | 阈值 | 动作 |
|------|------|------|
| 活跃 public key 数 | 待填 | 评估关闭 |
| 月上游成本 / 月收入 | 待填 | 评估关闭或提价 |
| 违规 / 滥用率 | 待填 | 收紧或关闭 |
| 毛利率 | 待填 | 调整加价或关闭 |

## 10. 风控

- 试用额度（如 BlockyEdu 注册 300 秒）以 `kind=trial` grant 发放，每账号一次，叠加设备 / IP 频率限制；全局试用预算上限用完后停止发放。
- 支付争议（PayPal dispute）→ 钱包 `frozen`，已消耗部分计入坏账统计。
- 异常消耗（短时间超过 `perUserDailyCreditCap` 的数倍）→ 自动 `frozen` + 通知运营。

## 11. 管理台最小范围（P2）

- Route 表与 Rate Card 的查看、编辑、版本发布、审计。
- Wallet 查询、grant 明细、手工发放 / 回收（`source.type=admin`，必须填写原因，写审计）。
- 毛利看板：按能力 / 产品 / 模型的收入、上游成本、毛利率；每活跃学员每 10 分钟成本；试用预算消耗。
- 对账报表：已支付未入账、已退款未回收、hold 超时、等式不平衡。

## 12. 数据与安全

- Postgres，append-only 流水；`ledger_entries` 不得 UPDATE / DELETE（用数据库权限强制，不只靠代码约定）。
- 平台不存 prompt / 响应正文（D-AI-17）；`traceId` 可关联上游日志。
- 上游密钥只在 Vault（[ai-provider-and-vault.md §3](./ai-provider-and-vault.md)）；管理台读不到明文。

## 13. 运营控制台

Control Console 的 `/ai` 只对平台操作者开放（`entitlement:admin` 或 `ai:admin`）。浏览器只带操作者的 OIDC access token。`AI_PLATFORM_BASE_URL` 与 `AI_PLATFORM_INTERNAL_SERVICE_KEY` 只存在于控制台 Fastify 进程，经 `/bff/ai/*` 转发，不进入 `/config.json`，也不回给浏览器。

AI Platform 下列接口只接受内部服务凭证（`assertInternalService`）：

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/v1/internal/admin/wallets?ownerKind&ownerId` | 钱包、对账等式（granted = remaining + holds + settled + revoked）、grant 明细 |
| GET | `/v1/internal/admin/usage?from&to&productCode&limit` | 按产品与能力汇总 calls、charged micro、upstream cost micro USD、毛利 |
| GET | `/v1/internal/admin/rate-cards` | 版本与行。发布仍走 `POST /v1/internal/rate-cards`，版本只增 |
| GET | `/v1/internal/admin/connections` | `ownerKind=deployment` 的连接，不含 ciphertext |
| GET | `/v1/internal/admin/settings` | `PUBLIC_API_ENABLED` 生效值、钱包强制开关、hardening gate 的运行时观察 |
| PUT | `/v1/internal/admin/settings/public-api` | `{ enabled: boolean, reason?: string }` 写入 `platform_settings` 并记审计。无记录时仍读环境变量 |

手工发放不改现有入账契约：控制台生成 `orderId=admin:<uuid>`，`kind=promo` 且带 `expiresAt`，调用 `POST /v1/internal/credits/grant`（`sourceType` 仍为 `order`）。回收调用 `POST /v1/internal/credits/revoke`。原因在 BFF 必填；该契约本身不落 reason。部署连接的启用、停用、轮换走既有 `POST/PATCH /v1/providers`。
