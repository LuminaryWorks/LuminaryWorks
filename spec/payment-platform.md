# LuminaryWorks 支付平台契约（Payment Platform）

> **状态**：Accepted · **决策日**：2026-09-07 · **实现**：已落地（adapter + 迁移 + webhook + 测试齐备；**活体商户凭证仍属运营**）· **修订**：2026-09-16 新增 `creem` / `doerflow_credit` 与付款方类型  
> **关联**：[subscription-and-entitlement.md](./subscription-and-entitlement.md) · [decisions/2026-09-storage-doris-payment.md](./decisions/2026-09-storage-doris-payment.md) · [legal/README.md](./legal/README.md) · [identity-and-permissions.md](./identity-and-permissions.md) · [DoerFlow PAYMENT_ARCHITECTURE.md](https://github.com/AgentSkillMesh/DoerFlow/blob/main/spec/PAYMENT_ARCHITECTURE.md) · [DoerFlow GEO_PORTABILITY.md](https://github.com/AgentSkillMesh/DoerFlow/blob/main/spec/GEO_PORTABILITY.md)

本文是中央 Entitlement **支付编排**的唯一权威：adapter 合同、订单状态、定价、验签回调、幂等、查询 / 对账 / 退款、密钥、地理市场与 provider 能力矩阵。产品仓不得另立平行支付事实源。

**内置能力 ≠ 运营启用。** 代码存在 adapter 只表示 *capability*；`enabled=true` 且凭证通过 healthCheck 才表示 *operationally enabled*。没有 sandbox / live 凭证的渠道不得对用户展示为可用。

## 0. 决策摘要

| # | 决策 |
|---|------|
| D-PAY-P1 | 支付编排在 Entitlement；产品只带 `offeringId` 发起结算并执行本地履约 / 清理 |
| D-PAY-P2 | 价格、币种、期限以服务端 catalog revision 为准；拒绝客户端 `amountCents` 作为权威金额 |
| D-PAY-P3 | 公开回调先对 **原始 body** 验签，再幂等落库，最后事务性完成订单与订阅 |
| D-PAY-P4 | Provider 配置含市场、币种、优先级、能力与信封加密凭证；超管可更新 / 轮换，**不得回显明文** |
| D-PAY-P5 | Hosted SaaS：`CN` 默认已启用支付宝；海外展示全部已启用渠道；加密渠道双重检查 IP 与 billing country |
| D-PAY-P6 | Manual 是一等 provider（人工确认），不是后门改价 |
| D-PAY-P7 | **个人运营阶段**：资质门槛最低的三条通道并行 —— `paypal`（已实现）、`creem`（MoR 代扣代缴）、`doerflow_credit`（链上自托管收款）。需 KYB / 营业执照的渠道保持 disabled |
| D-PAY-P8 | MoR 供应商是**记录商户**：金额含税，回传 gross/tax/net；履约比对用 **gross**，`net` 仅入对账。必须处理 MoR 侧发起的退款 |
| D-PAY-P9 | `doerflow_credit` 金额只由本服务定价；DoerFlow 侧 `ledger_operations` 与本服务 `provider_webhook_events` **双向幂等且幂等键可关联** |
| D-PAY-P10 | 付款方区分 `individual` / `business`；`billing_profiles` 承载税号与地址，供 MoR 税区判定与企业开票 |
| D-PAY-P11 | `PAYMENTS_ENABLED=false` 时 `PaymentsModule` 不注册、公开 webhook 路由不挂载（404）。私有交付不含 PSP 面 |

## 1. 边界

| 在范围内 | 不在范围内 |
|----------|------------|
| Checkout 创建、webhook 验签、订单查询、退款、对账、市场路由 | 卡号 / CVV 直连采集（Stripe 只用托管 Checkout） |
| SKU / offering / 30·365 天期限 | DoerFlow 协议费、Job 单价、Escrow、Gas |
| Provider 凭证信封加密与轮换 | 把支付密钥写入产品 env 或前端 |
| 地理展示与下单拒绝 | 将 IP 单独当作加密支付合规证明 |
| Manual 人工确认 | 客户端自报已支付 |

私有化：客户可只启用 Manual + 自有已签约渠道，或关闭 hosted 默认市场规则。不得把本平台的支付宝 / 微信商户号复用到客户部署。

**整体摘除**（D-PAY-P11）：私有化交付若完全不需要支付，置 `PAYMENTS_ENABLED=false`。此时 `PaymentsModule` 整体不注册，`POST /v1/payments/webhooks/*` 与 `/v1/admin/payments/*` **不挂载**（返回 404 而非 403，不泄露能力存在），`POST /v1/orders` 返回 `PAYMENT_PROVIDER_UNAVAILABLE`。权益改由 `ENTITLEMENT_MODE=offline_license` + Ed25519 License 决定。

不存在 `commerce` compose profile：支付跑在 entitlement 进程内，而 entitlement 是会员权威必须默认启动，没有可单独下线的支付 sidecar。`PAYMENTS_ENABLED` 就是唯一开关。运维细节见 [deploy/PAYMENTS.md](../deploy/PAYMENTS.md) §私有交付。

## 2. Provider 中立 Adapter

所有渠道实现同一接口。新增渠道 = 新 adapter + 配置行，不改订单状态机。

```ts
type ProviderId =
  | "alipay_f2f"
  | "paypal"
  | "wechat_pay_v3"
  | "unionpay_quickpass"
  | "stripe_checkout"
  | "coinbase_commerce"
  | "okx_onchain"
  | "bitpay"
  | "creem"           // Merchant of Record：代扣代缴 VAT，个人可开户
  | "doerflow_credit" // DoerFlow 链上 USDT/USDC 余额
  | "manual";

interface PaymentAdapter {
  readonly provider: ProviderId;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  verifyWebhook(
    rawBody: Uint8Array,
    headers: Record<string, string>,
    config: ProviderConfig,
  ): Promise<VerifiedWebhook>;
  queryPayment(providerRef: string, config: ProviderConfig): Promise<PaymentQueryResult>;
  refund(input: RefundInput, config: ProviderConfig): Promise<RefundResult>;
  healthCheck(config: ProviderConfig): Promise<HealthStatus>;
}
```

| 方法 | 合同 |
|------|------|
| `createCheckout` | 只接受服务端已定价的 `orderId`；返回 hosted URL / QR / Manual 待确认指令。金额、币种从订单快照读取，adapter 不得改价 |
| `verifyWebhook` | **必须**使用原始请求字节验签。禁止先 `JSON.parse` 再对对象序列化验签。失败抛稳定错，不落业务履约 |
| `queryPayment` | 主动向渠道查询；对账 job 与「webhook 只作触发器」的渠道（BitPay）必须走此路径 |
| `refund` | 原路退款；部分退款须渠道能力为 true，否则拒绝 |
| `healthCheck` | 检查凭证形状、证书有效期、sandbox/live 一致性；不泄漏 secret |

公开回调路径冻结：

```text
POST /v1/payments/webhooks/:provider/:configId
```

处理顺序：

1. 按 `configId` 加载配置；禁用 / 未知则 404，不泄露是否存在。
2. 读取 **raw body** + 渠道签名头，调用 `verifyWebhook`。
3. 以 `(provider, configId, eventId)` 幂等写入 `provider_webhook_events`。重复事件返回 200 且不再履约。
4. 事务：更新 `payment_attempts` → 订单 → 订阅 / grant；投递 outbox。
5. 验签失败返回 4xx；渠道要求的成功应答格式按 adapter 映射，但业务失败不得伪装成支付成功。

内部管理查询 / 退款走 admin scope，不走公开 webhook。

### 2.1 创建结账输入（示意）

客户端 `POST /v1/orders` 只允许：

```json
{
  "offeringId": "off_…",
  "productCode": "dataluminary",
  "interval": "month",
  "providerHint": "alipay_f2f",
  "returnUrl": "https://app.example/billing/return"
}
```

禁止字段：`amountCents`、`currency`、`endsAt`、`planCode` 直接指定超集、任意折扣金额。服务端根据 **已发布** `catalog_revisions` + `offerings` 写入订单快照。`providerHint` 仅当该 provider 对当前市场 *operationally enabled* 时采纳，否则按优先级选择或返回 `PAYMENT_PROVIDER_UNAVAILABLE`。

## 3. 订单与支付状态

```text
Order:
  created
    → pending_payment   （checkout 已创建）
    → paid              （渠道已确认）
    → fulfilled         （订阅 / grant 已写入）
    → failed | canceled | expired
  paid / fulfilled
    → refund_pending
    → partially_refunded | refunded

PaymentAttempt:
  created → pending → succeeded | failed | canceled | expired
```

| 规则 | 值 |
|------|-----|
| 一单可有多次 attempt（换渠道 / 重试），同时最多一个 `pending` | |
| 履约只在 attempt = `succeeded` 且订单金额 / 币种 / 商户号与渠道查询一致后发生 | |
| 订阅期限 | 新购：`startsAt=now`，`endsAt=now+30d` 或 `now+365d`；续费：`startsAt` 不变，`endsAt=max(now,currentEndsAt)+interval` |
| 过期未支付 | 订单 `expired`；不发放权益 |
| 退款 | 按政策级联撤销同源 grant；部分产品保留须显式配置（与 Bundle 撤销一致） |
| Manual | 超管确认等同 `succeeded`；必须记录操作者、原因、ticket；不得用 Manual 改写 catalog 价格 |

`orders.status` 实现值与 [subscription-and-entitlement.md §11](./subscription-and-entitlement.md) 对齐时，以**已支付且已履约**为用户可见 Pro/Ultra 的前提。`pending` 订单不授予付费 feature。

## 4. 服务端权威定价

- `offerings` 绑定 `(productCode, planCode, interval, currency, amountMinor, catalogRevisionId)`。
- 发布走 catalog revision：草稿 → 发布 → 可回滚到上一 revision；已创建订单锁定当时快照，不受后续改价影响。
- 零价、负价、未知 currency、未发布 revision：**拒绝下单**（防零价订单）。
- Trial 不是 SKU，不经支付创建；`trialPolicy=disabled` 的产品任何入口都不得生成 `planCode=trial`。
- 不可售产品（`sellable=false`，如就绪前的 VistaCast / SyncroBrain）：`POST /v1/orders` 返回 `PRODUCT_NOT_SELLABLE`。
- 不存在永久 Free offering。

## 5. 原始 body 验签与幂等

| 要求 | 说明 |
|------|------|
| Raw body | Fastify 对 webhook 路径注册独立 content-type parser，保留原始字节。禁止 Nest Express `rawBody` 模式 |
| 签名 | 按渠道头验证（见 §9 矩阵）。时间窗外、重放、商户号 / 金额 / 币种不匹配一律拒绝 |
| 幂等键 | Webhook：`(provider, configId, eventId)`。下单：`Idempotency-Key`。退款：`refundIdempotencyKey` |
| 重放 | 已处理事件返回成功应答但不重复履约 |
| 并发 | 同一 `orderId` 履约使用行锁；与 `trial.purge` 互斥（已付费则取消清理） |

## 6. 查询、对账、退款

| 作业 | 行为 |
|------|------|
| 主动查询 | `pending` attempt 超过阈值（建议 2–15 分钟，按渠道）调用 `queryPayment` |
| 对账 | 按日拉取渠道已成功支付，与 `orders` / `payment_attempts` 比对；差异入审计，不自动改价 |
| BitPay | IPN 只触发查询；invoice 到 `complete` 才履约 |
| 退款 | 仅 `paid` / `fulfilled`；金额不超过净支付；成功后撤销权益并写 audit |
| 失败降级 | 渠道 5xx：attempt 保持 pending 并重试查询；用户侧不显示「已开通」 |

## 7. 密钥加密与轮换

- 表 `payment_provider_configs` 存 ciphertext。数据密钥由环境变量 `PAYMENT_CONFIG_MASTER_KEY` 做 envelope encryption（密钥不入库）。
- 超管 API：写入 / 轮换 / 禁用；GET 只返回 `lastFour`、指纹、过期时间、`rotatedAt`，**永不回显明文**。
- 轮换：写入新密文 → healthCheck → 标记旧密钥 `retiring` 直至签名窗口结束 → 销毁。
- 微信平台证书、支付宝公钥等同属凭证，走同一轮换流程。
- 日志、审计、前端 **禁止**打印 secret、私钥 PEM、webhook signing secret。

## 8. 地理市场政策

地域解析顺序（Hosted SaaS）：

1. 仅当请求来自**已配置的可信代理**（CDN / Caddy）时，读取其注入的 `CF-IPCountry` 或等价头。
2. 否则使用连接 IP 的本地 GeoIP。
3. **丢弃**客户端自报的 `X-Forwarded-For` / `CF-IPCountry`（直连伪造）。

| 市场 | 展示与下单 |
|------|------------|
| `CN` | 默认仅 *operationally enabled* 的 `alipay_f2f`。超管可人工确认例外，须审计 |
| `GLOBAL`（非 CN） | 全部 *operationally enabled* 的非受限渠道 |
| 加密渠道（Coinbase / OKX / BitPay） | IP **或** 账户 billing country 为 CN → UI 隐藏且 `createCheckout` 拒绝。两者都非 CN 才允许 |
| 未知地域 | 保守：按 GLOBAL 展示非加密渠道；加密渠道在 billing country 明确前拒绝 |

IP 只控制 UI / 渠道路由，**不是** KYC、制裁或加密支付合规的充分证明。私有化部署可覆盖默认市场表，但不得削弱验签与服务端定价。

## 9. Provider 能力 / 凭证矩阵

「内置」= adapter 合同已规定，实现工作包必须覆盖 sandbox 或录制 fixture。「运营启用」= 超管 `enabled=true` + 有效凭证 + healthCheck 通过。下表 Hosted 列是 **个人 SaaS 的默认意图**，不是自动打开。

| Provider | `provider` | 内置能力 | 运营启用前提 | 结账形态 | 验签 | 查询 | 退款 | Hosted 默认意图 |
|----------|------------|----------|--------------|----------|------|------|------|-----------------|
| 支付宝当面付 | `alipay_f2f` | 创建 QR、异步通知、订单查询、退款、RSA2 | 实际签约成功的 appId + 商户私钥 + 支付宝公钥 | Face-to-face QR | RSA2 异步通知；验签原始表单 / JSON 字节 | 已提供 | 已提供 | **CN 默认渠道**（仅当凭证就绪） |
| PayPal | `paypal` | Checkout 或 Subscriptions、webhook、查询、退款 | REST Client ID/Secret；webhook ID | Hosted Checkout | 官方 webhook 验签 | 已提供 | 已提供 | GLOBAL 可启用 |
| 微信支付 API v3 | `wechat_pay_v3` | Native/JSAPI 按配置、回调、查询、退款 | 商户号 + 商户私钥 + API v3 key + 平台证书 | Native QR / JSAPI | 平台证书 + AES-256-GCM 解密回调 | 已提供 | 已提供 | 有商户号才启用；默认关闭 |
| 云闪付 / 银联 | `unionpay_quickpass` | 下单、`backUrl`、查询、退款 | 入网商户号 + 签名证书 | Hosted / QR 按入网产品 | `backUrl` 验签 | 已提供 | 已提供 | 未入网则禁用 |
| Stripe Checkout | `stripe_checkout` | 托管 Checkout Session；不接触卡号 | Secret key + webhook signing secret | Stripe-hosted Checkout | `Stripe-Signature` + **raw body** | Session / PaymentIntent | 已提供 | GLOBAL 可启用 |
| Coinbase Business Checkout | `coinbase_commerce` | Checkout、sandbox、查询、退款 | Coinbase Business + webhook secret | Hosted crypto checkout | `X-Hook0-Signature`（以官方文档为准） | 已提供 | 已提供 | GLOBAL；CN 双重阻断 |
| OKX Pay / Onchain OS | `okx_onchain` | 官方 SDK 验证并结算 x402；不自实现链上签名 | OKX 商户 / Onchain OS 凭证 | Hosted / x402 | 官方 SDK | 已提供 | 按官方能力 | GLOBAL；CN 双重阻断 |
| BitPay | `bitpay` | Invoice、IPN 触发、查询至 `complete` | Merchant token + HMAC secret | Invoice URL | IPN HMAC **后必须** `queryPayment` | **强制** | 按官方能力 | GLOBAL；CN 双重阻断 |
| Merchant of Record | `creem` | Hosted 结算页、含税定价、webhook、查询、退款 | MoR 账户（**个人 / 自然人可开户，需实际验证**）+ webhook signing secret | MoR-hosted Checkout | vendor 专属签名头 + **raw body** | 已提供 | 已提供（含 MoR 侧发起） | **GLOBAL 主力**；CN 阻断 |
| DoerFlow 链上余额 | `doerflow_credit` | 服务间扣款、HMAC 回调、查询、账本内退款 | DoerFlow `X-Service-Key` + webhook HMAC secret + 商户账户标识 | 无跳转；账本内即时扣款 | `x-lw-signature: v1=` HMAC-SHA256 over `ts.nonce.rawBody` | 已提供 | 账本内可用余额范围内 | GLOBAL；**CN 双重阻断** |
| 人工确认 | `manual` | 超管标记已收款 | 无需渠道密钥；需 admin scope | 银行转账 / 对公 / 线下说明 | 无 webhook；以审计日志为证 | n/a | 人工退款工单 | 始终可作为运营后备 |
| 企业合同 | `contract` | 超管按合同 / PO 确认 | 无需渠道密钥；需 admin scope | 合同 / PO | 无 webhook | n/a | 人工 | 企业渠道常备 |

### 9.2 MoR 与直连 PSP 的语义差异

`creem` 不是"又一个 Stripe"。适配器必须正确映射四处差异，否则会算错钱：

| 差异 | 要求 |
|------|------|
| 买家看到的商户名是 MoR，不是 LuminaryWorks | 结算页与条款须披露记录商户身份 |
| 金额含税，回传 gross / tax / net | 与订单快照比对用 **gross**；`net` 只入对账表，**不得**作为履约判据 |
| 退款可能由 MoR 侧发起（买家直接找 MoR） | webhook 必须处理非本平台发起的 refund 事件，并级联撤销同源 grant |
| 结算周期 T+N，非即时到账 | 履约以 webhook `succeeded` 为准，**不等实际打款** |

### 9.3 `doerflow_credit` 资金不变量

唯一可能造成真实资金损失的通道，约束不得放宽（完整版见 [DoerFlow PAYMENT_ARCHITECTURE.md](https://github.com/AgentSkillMesh/DoerFlow/blob/main/spec/PAYMENT_ARCHITECTURE.md) §3.2）：

| 不变量 | 要求 |
|--------|------|
| 服务端定价 | DoerFlow 只接受本服务传入的 `amountMinor` + `currency` + `asset` 并与 `orderId` 绑定；DoerFlow 不查目录、不算价 |
| 扣款原子性 | payer 扣减与商户入账同一 Postgres 事务，对 `(account, asset)` 行 `SELECT … FOR UPDATE`。禁止先扣后记 |
| 余额不得为负 | 不足返回 `LEDGER_INSUFFICIENT_FUNDS`，**不部分扣款** |
| 双向幂等 | DoerFlow 侧 `ledger_operations.idempotencyKey` 唯一；本服务侧 `(provider, configId, eventId)` 唯一；`eventId` 由 `idempotencyKey` **确定性派生** 以便对账 |
| 失败方向安全 | 扣款成功而回调投递失败 → durable outbox 重投。**绝不**先履约后扣款 |
| 金额复核 | 收到回调后仍比对订单快照金额 / 币种 / 商户，不符返回 `PAYMENT_AMOUNT_MISMATCH` |

微信证书轮换、支付宝公钥轮换必须可在不中断验签窗口的情况下完成。OKX **禁止**手写链上签名或自造 x402 结算。

### 9.1 凭证字段（逻辑，不入库明文）

| Provider | 典型密钥材料（加密存储） |
|----------|--------------------------|
| `alipay_f2f` | `appId`, merchant private key, Alipay public key, `notifyUrl` |
| `paypal` | client id/secret, webhook id, sandbox\|live |
| `wechat_pay_v3` | mchid, serial, private key, api v3 key, platform certs |
| `unionpay_quickpass` | merchant id, sign cert, password, `frontUrl`/`backUrl` |
| `stripe_checkout` | secret key, webhook signing secret |
| `coinbase_commerce` | API key, webhook secret |
| `okx_onchain` | 官方 SDK 所需商户凭证 |
| `bitpay` | merchant token, ipn HMAC secret |
| `creem` | API key, webhook signing secret, store/product id 映射 |
| `doerflow_credit` | DoerFlow base URL, `X-Service-Key`, webhook HMAC secret, `merchantAccount` |
| `manual` | 无；指令文案与收款账户由运营配置（非支付密钥） |

## 10. 稳定错误码（支付族）

| `code` | HTTP | 含义 |
|--------|------|------|
| `PAYMENT_PROVIDER_UNAVAILABLE` | 402 | 当前市场无可用 enabled provider |
| `PAYMENT_PROVIDER_FORBIDDEN_MARKET` | 403 | 地理 / billing 政策拒绝该渠道（含加密 CN 阻断） |
| `PAYMENT_PRICE_MISMATCH` | 400 | 客户端试图提交金额 / 币种 |
| `PAYMENT_OFFERING_INVALID` | 400 | offering 未发布或与产品不匹配 |
| `PRODUCT_NOT_SELLABLE` | 402 | 产品目录存在但不可售 |
| `PAYMENT_WEBHOOK_INVALID` | 400 | 验签失败 / 时间戳过期 |
| `PAYMENT_AMOUNT_MISMATCH` | 409 | 渠道金额 / 币种 / 商户与订单快照不符 |
| `PAYMENT_REFUND_UNSUPPORTED` | 409 | 渠道或订单状态不允许退款 |
| `LEDGER_INSUFFICIENT_FUNDS` | 402 | `doerflow_credit` 账本可用余额不足；不部分扣款 |
| `PAYMENT_BILLING_PROFILE_INCOMPLETE` | 400 | `payerType=business` 缺 `companyName` / `countryCode`，或 MoR 税区判定所需地址缺失 |

与权益不足的 `ENTITLEMENT_*` 区分：未付钱走支付/权益 402；验签伪造走 400；市场政策拒绝走 403 且 **不是** Casbin 资源拒绝。

## 11. 数据模型（形状冻结）

| 表 | 用途 |
|----|------|
| `catalog_revisions` | 目录版本；发布 / 回滚 |
| `offerings` | 可售 SKU 快照源 |
| `orders` | 锁定价格的订单 |
| `payment_attempts` | 一次渠道尝试 |
| `payment_provider_configs` | 启用、市场、加密凭证 |
| `provider_webhook_events` | 原始事件幂等与审计 |
| `refunds` | 退款单与渠道引用 |
| `billing_profiles` | 付款方类型、税号、地址（见 §11.1） |

实现列可增，不得静默改变「服务端定价、先验签后履约、密钥不回显」语义。

### 11.1 付款方档案（`billing_profiles`）

个人与企业付款方共用一张表，由 `payerType` 区分：

| 列 | 类型 | 约束 |
|----|------|------|
| `payerType` | `'individual' \| 'business'` | 默认 `individual` |
| `companyName` | `string \| null` | `business` **必填** |
| `taxId` | `string \| null` | VAT ID / 统一社会信用代码。只做**形状校验**，不做真实性核验 |
| `addressLine1` · `city` · `postalCode` | `string \| null` | MoR 税区判定必需 |
| `country` | `string` | **已存在列**，ISO 3166-1 alpha-2。`business` 时必填；**不得**另加 `countryCode` 重复列 |

`country` 同时参与 §8 地域路由，与 IP 构成加密渠道的双重检查。缺字段返回 `PAYMENT_BILLING_PROFILE_INCOMPLETE`。

### 11.2 权益表不得承载渠道 / 链上标识

`subscriptions` / `grants` **不得**新增 `providerId`、`txHash`、`walletAddress`、金额、币种等列。

已存在的 `source` + `sourceRef` 是例外且**仅此一处**：`source="order"` 时 `sourceRef` 即 `orders.id`。它是不透明内部 UUID，不含渠道身份，可以保留；但跨区权益断言投影时必须剥离。

这条性质是大陆分站权益可携带性的前提（见 [DoerFlow GEO_PORTABILITY.md](https://github.com/AgentSkillMesh/DoerFlow/blob/main/spec/GEO_PORTABILITY.md) FR-GEO-001），由 `test/geo-portability.spec.ts` 守卫——否则将来任何人为了对账方便加一列，就会静默摧毁跨区可携带性，且要到建大陆站时才会发现。

## 12. 相关文档

- [subscription-and-entitlement.md](./subscription-and-entitlement.md)（订阅、Trial、配额）
- [decisions/2026-09-storage-doris-payment.md](./decisions/2026-09-storage-doris-payment.md)
- [legal/terms 中文](./legal/zh/terms.md) · [Terms](./legal/en/terms.md)
- [products/index.md](./products/index.md)
