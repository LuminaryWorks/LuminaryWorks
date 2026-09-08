# 支付渠道运营手册（Alipay / PayPal / WeChat / UnionPay / Stripe / Coinbase / OKX / BitPay）

> 契约权威：[`spec/payment-platform.md`](../spec/payment-platform.md)。  
> 本文只写 **凭证、沙箱/生产、回调、商户开通**。不要把密钥写进产品 env 或前端。

**内置 adapter ≠ 对用户开放。** `enabled=true` 且 `POST /v1/admin/payments/providers/:id/test` 通过才算运营启用。个人商户是否已通过支付宝/PayPal/微信/银联/Stripe 审核，代码 **不会** 假设；未签约就不要 `enable`。

信封密钥：`PAYMENT_CONFIG_MASTER_KEY`（32 字节 hex 或 standard base64）。生产在已启用 provider 配置时必填。GET / 审计 / 日志永不回显明文。

公开回调（原始 body 先验签）：

```text
POST /v1/payments/webhooks/:provider/:configId
```

`:configId` 是 Entitlement 里该渠道配置行的 UUID。禁用或未知一律 404，不枚举。

买家回站后的服务端确认（PayPal 捕获 / 支付宝查单）：

```text
POST /v1/orders/:id/complete
```

需登录。忽略客户端金额与支付状态。PayPal **仅批准（APPROVED）不算已付**。Stripe `success_url`、银联 `frontUrl`、微信扫码回跳 **都不履约**。

本文 **没有** 对真实商户网关做过 live 验证；联调只在各渠道沙箱/验收工具中进行。

---

## 支付宝当面付 `alipay_f2f`

### 运营前提

1. 开放平台应用已创建；**当面付 / 预下单** 产品已签约（个人商户常见未开通，此时保持 `enabled=false`）。
2. 应用 `appId`、商户应用私钥（RSA2）、支付宝公钥。
3. 异步通知 URL 必须是 **HTTPS** 公网地址，指向上面的 webhook 路径。
4. 订单快照币种必须是 **CNY**；金额按分（minor）→ `x.xx` 元，两位小数。

Gateway 由 `environment` 选择，**禁止**在凭证里自定义网关（防 SSRF）：

| environment | 官方地址 |
|---|---|
| `sandbox` | `https://openapi-sandbox.dl.alipaydev.com/gateway.do`（兼容别名 `openapi.alipaydev.com`） |
| `live` | `https://openapi.alipay.com/gateway.do` |

### 凭证字段（写入 admin API，加密入库）

| 字段 | 说明 |
|---|---|
| `appId` | 8–32 位数字 |
| `merchantPrivateKey` | 商户 RSA 私钥 PEM 或开放平台单行 base64 |
| `alipayPublicKey` | 支付宝公钥 PEM 或单行 base64 |
| `notifyUrl` | HTTPS 异步通知 URL（须含本配置 `configId`） |
| `sellerId` | 可选 PID；用于与 notify `seller_id` 比对 |

`merchantId` 列建议填 PID（`sellerId`），以便核心比对商户号。

### 行为

- 下单：`alipay.trade.precreate`，返回 QR。`out_trade_no` = `attemptId`，`passback_params` = `orderId`。
- 验签：对 **form-urlencoded 原始 body** 做 RSA2；排除 `sign` / `sign_type`。失败不履约。
- 状态：`WAIT_BUYER_PAY` → pending；`TRADE_SUCCESS` / `TRADE_FINISHED` → 成功；`TRADE_CLOSED` → 失败。
- 幂等：`notify_id`。重复事件 HTTP 200，body 纯文本 `success`，不再履约。
- 查询 / 退款：`alipay.trade.query` / `alipay.trade.refund`。应答 `code=10000` 为业务成功。
- Health：校验 appId / 密钥可解析 / 公私钥未对调 / HTTPS notify；**默认不访问网络**。Admin test 才允许远程 probe。Health **不**把个人商户标成已开通。

### 沙箱

开放平台沙箱应用与沙箱买家账号。`environment=sandbox`。沙箱通过 **不等于** 生产已签约当面付。

---

## PayPal `paypal`

### 运营前提

1. REST App：Client ID / Secret。Sandbox 与 Live **分两套**，对应 `environment`。
2. Webhook 订阅到同一 `POST /v1/payments/webhooks/paypal/:configId`，保存 **Webhook ID**。
3. 需要的传输头：`PAYPAL-TRANSMISSION-ID` / `TIME` / `SIG` / `CERT-URL` / `AUTH-ALGO`。验签走官方 `POST /v1/notifications/verify-webhook-signature`。
4. 一次性 Checkout（Orders v2 `intent=CAPTURE`）已完整实现。订阅 Plan / Product ID **可以写入凭证并映射 webhook**，但 **不会** 创建 PayPal Subscription，也不要把 Checkout 假装成周期扣款。

官方 API Host（不可自定义）：

| environment | Base |
|---|---|
| `sandbox` | `https://api-m.sandbox.paypal.com` |
| `live` | `https://api-m.paypal.com` |

### 凭证字段

| 字段 | 说明 |
|---|---|
| `clientId` / `clientSecret` | REST 凭证 |
| `webhookId` | Webhook 订阅 ID |
| `returnUrl` / `cancelUrl` | 可选；也可用订单 `returnUrl` |
| `paypalPlanId` / `paypalProductId` | 可选；仅存储 + 订阅类 webhook 映射 |
| `subscriptionWebhookEnabled` | 可选 `"true"`：映射 `PAYMENT.SALE.COMPLETED` 等为 `requiresQuery`，仍须查单确认 |

### 行为

- 创建：Orders v2，服务端金额、`custom_id=orderId`、`invoice_id=attemptId`。
- 用户批准后：前端调 `POST /v1/orders/:id/complete` → `POST /v2/checkout/orders/{id}/capture`。对账 job 遇到 `APPROVED` 也会捕获。
- 履约条件：`PAYMENT.CAPTURE.COMPLETED`（官方验签成功）**或** 查询到已捕获状态。`CHECKOUT.ORDER.APPROVED` 忽略。
- 退款：对 capture id 调用 refund。OAuth token 进程内缓存并按 `expires_in` 提前刷新。
- Health：默认只校验字段形状；**远程拉 token 仅 admin test**。`GET /v1/payments/methods` 不会打 PayPal 网络。

### 沙箱

[PayPal Developer](https://developer.paypal.com/) sandbox app + sandbox 买家。Webhook 在沙箱同样要配 ID。不要用沙箱 secret 开 `environment=live`。

---

## 微信支付 API v3 `wechat_pay_v3`

### 运营前提

1. 微信商户平台已开通 **Native 扫码支付**；有商户号 `mchid`、商户 API 证书（私钥 + 证书序列号）、APIv3 密钥。
2. 配置微信平台证书 **或** 微信支付公钥（公钥 ID 以 `PUB_KEY_ID_` 开头）。轮换时把新旧 serial/PEM 同时写入（`platformCertPemPrevious` / `platformCertificatesJson`），验签按 `Wechatpay-Serial` 选钥。
3. 异步通知必须是 **HTTPS**，指向 `POST /v1/payments/webhooks/wechat_pay_v3/:configId`。
4. 订单快照币种必须是 **CNY**；金额为分。`out_trade_no` 使用 attempt id（UUID 会去掉连字符以符合 32 位限制），`attach` 为 order id。

官方 Host（不可自定义；`apiRegion=hk` 才使用香港站点）：

| environment | apiRegion | Base |
|---|---|---|
| `sandbox` / `live` | `cn`（默认） | `https://api.mch.weixin.qq.com` |
| `sandbox` / `live` | `hk` | `https://apihk.mch.weixin.qq.com` |

v3 **没有** 独立沙箱域名；验收用测试商户号 + 同一 Host。`environment` 只区分运营意图，不接受自定义 `gatewayUrl`。

### 凭证字段

| 字段 | 说明 |
|---|---|
| `mchid` / `appid` | 商户号、公众号或应用 AppID |
| `merchantSerial` / `merchantPrivateKey` | 商户证书序列号 + RSA 私钥 |
| `apiV3Key` | 32 位 APIv3 密钥（回调解密） |
| `notifyUrl` | HTTPS 回调 |
| `wechatpayPublicKey` + `wechatpayPublicKeyId` | 公钥模式 |
| `platformCertPem` + `platformCertSerial` | 平台证书模式 |
| `platformCertPemPrevious` / `platformCertificatesJson` | 证书环，用于轮换 |
| `apiRegion` | 可选 `cn` \| `hk` |

### 行为

- 下单：`POST /v3/pay/transactions/native`，返回 `code_url` QR。
- 回调：先验 `Wechatpay-Signature` / Timestamp / Nonce / Serial（5 分钟窗），再 AES-256-GCM 解密 `resource`。校验 mchid/appid/金额/币种。
- 状态：`SUCCESS` 成功；`NOTPAY`/`USERPAYING` pending；`CLOSED`/`PAYERROR` 失败；`REVOKED` 失败；`REFUND` 忽略（退款走管理接口）。
- Ack：JSON `{ "code": "SUCCESS", "message": "成功" }`。
- 查询：`GET /v3/pay/transactions/out-trade-no/{out_trade_no}`；退款：`POST /v3/refund/domestic/refunds`。
- Health：默认只校验密钥与 notify HTTPS。Admin test 才 `GET /v3/certificates`。

### 沙箱

商户平台测试计划 / 测试商户。不要把测试 APIv3 密钥配成 `environment=live`。

---

## 云闪付 / 银联全渠道 `unionpay_quickpass`

本 adapter **只实现官方 5.1.0 网关**（`signMethod=01` RSA）。Hosted 前台消费（`bizType=000201`, `txnSubType=01`）或二维码消费（`bizType=000000`, `txnSubType=07`）。SM2、JSAPI、App 等未实现：写入这些能力会 **health 失败**，不会假装支持。

### 运营前提

1. 银联全渠道 / 云闪付已入网，有 15 位商户号、签名证书 `certId`、商户私钥、银联验签公钥。
2. `frontUrl`（买家回跳，**不履约**）与 `backUrl`（异步通知，先验签再查单）均为 HTTPS。`backUrl` 指向 `POST /v1/payments/webhooks/unionpay_quickpass/:configId`。
3. 仅 CNY（`currencyCode=156`），金额为分。`orderId` 由 attempt id 规范化为 8–40 位字母数字。

官方地址（不可自定义）：

| environment | 前台 | 后台 / 退款 | 查询 |
|---|---|---|---|
| `sandbox` | `https://gateway.test.95516.com/gateway/api/frontTransReq.do` | `.../backTransReq.do` | `.../queryTrans.do` |
| `live` | `https://gateway.95516.com/gateway/api/frontTransReq.do` | 同上生产 Host | 同上生产 Host |

### 凭证字段

| 字段 | 说明 |
|---|---|
| `merId` / `certId` | 商户号、证书 ID |
| `merchantPrivateKey` / `unionpayPublicKey` | 商户私钥、银联验签公钥 |
| `frontUrl` / `backUrl` | HTTPS |
| `checkoutMode` | **必填** `hosted` 或 `qr` |
| `protocolVersion` / `signMethod` | 默认 `5.1.0` / `01`；其他值拒绝 |
| `bizType` / `txnSubType` / `channelType` | 可选；必须与 checkoutMode 的官方组合一致 |

### 行为

- Hosted：本地签名后返回 `form_post` 到官方前台地址（不把回跳当支付成功）。
- QR：后台预下单，应答必须验签后才取 `qrCode`。
- `backUrl`：验签 + `respCode` 后 **再 query**；只有查询确认成功才履约。Ack 纯文本 `ok`。
- 查询 / 退款：`txnType=00` / `04`，退款需要 `origQryId`。部分退款能力未宣称（capabilities.partialRefund=false）。
- Health：默认不访问网络；Admin test 才查单探测。

### 沙箱

银联测试环境商户与测试密钥。测试通过 **不等于** 生产已入网。

---

## Stripe Checkout `stripe_checkout`

### 运营前提

1. Stripe 账户 + Secret Key。Sandbox 用 `sk_test_` 且 `environment=sandbox`；Live 用 `sk_live_` 且 `environment=live`。混用会 health 失败。
2. Webhook endpoint 指向 `POST /v1/payments/webhooks/stripe_checkout/:configId`，事件至少含 `checkout.session.completed`。保存 **Webhook signing secret**（`whsec_`）。
3. 只做 **托管 Checkout Session**（`mode=payment`）。不采集 PAN/CVV。

官方 Host：`https://api.stripe.com`（test/live 由密钥区分，禁止自定义 base）。

### 凭证字段

| 字段 | 说明 |
|---|---|
| `secretKey` | `sk_test_…` 或 `sk_live_…` |
| `webhookSecret` | `whsec_…` |
| `successUrl` / `cancelUrl` | 可选 HTTPS；也可用订单 `returnUrl` |

### 行为

- 创建：Checkout Session，服务端 `unit_amount`，`client_reference_id=orderId`，metadata 含 order/attempt，`Idempotency-Key=attemptId`。
- 履约：仅已验签的 `checkout.session.completed` 且 `payment_status=paid`，或查询到 Session/PaymentIntent 已支付。`success_url` 回站必须再 `POST /v1/orders/:id/complete`（内部查单），未支付保持 pending。
- 验签：官方 SDK `constructEvent`（原始 body + `Stripe-Signature`）。
- 退款：`refunds.create`，支持部分金额；带幂等键。
- Health：默认只校验密钥形态与 sandbox/live 匹配。Admin test 才 `GET /v1/account`。

### 沙箱

[Stripe Dashboard](https://dashboard.stripe.com/test) test 模式 + test webhook secret。不要用 `sk_test_` 开 `environment=live`。

---

## Coinbase Business Checkout `coinbase_commerce`

本 adapter 只实现 **Coinbase Business Checkouts API**（CDP JWT），不是 legacy Commerce Charge。CN IP 或 billing country 仍由服务端双重阻断。

### 运营前提

1. Coinbase Business + CDP Secret API Key（`apiKeyId` UUID + EC/Ed25519 `apiKeySecret`）。请求 JWT 由官方 `@coinbase/cdp-sdk` `generateJwt` 签发，有效期约 120 秒。
2. Webhook 订阅到 `POST /v1/payments/webhooks/coinbase_commerce/:configId`，保存 subscription `secret`。验签 `X-Hook0-Signature`（v1：timestamp + 官方 signed header list + raw body HMAC-SHA256，5 分钟重放窗，恒定时间比较）。
3. 结账为 **单次 Checkout**，结算网络 **Base**，金额与币种 **仅 USDC**。未安装官方 SDK/API fixture 证明前，不接受 USD/EUR/GBP/SGD 等法币入口。`successRedirectUrl` 不履约。金额核对以 Checkout `amount` + `currency=USDC` 为准，不以 `fiatAmount` / `fiatCurrency` 为准。
4. 元数据写入 `orderId` / `attemptId`。`X-Idempotency-Key` 为 UUID v4（由 attempt id 规范化）。

官方 Host（不可自定义）：

| environment | Base |
|---|---|
| `sandbox` | `https://business.coinbase.com/sandbox/api/v1/checkouts` |
| `live` | `https://business.coinbase.com/api/v1/checkouts` |

### 凭证字段

| 字段 | 说明 |
|---|---|
| `apiKeyId` / `apiKeySecret` | CDP 密钥；拒绝 Commerce Charge / 自定义 gateway |
| `webhookSecret` | Hook0 验签密钥 |
| `successRedirectUrl` / `failRedirectUrl` | 可选 HTTPS；也可用订单 `returnUrl` |

### 行为

- 创建：Checkouts API，服务端金额，metadata 含 order/attempt。
- 履约：已验签 `checkout.payment.success` 且 `COMPLETED`，或查询到 COMPLETED。失败/过期映射 failed。退款事件忽略（走管理退款）。
- 查询：`GET /checkouts/{id}`。退款：`POST /checkouts/{id}/refund`（异步；支持部分金额）。
- Health：默认本地签发 JWT；Admin test 才访问官方 Host。本文 **没有** live 商户验证。

### 沙箱

`environment=sandbox` 走 `/sandbox/api/v1/checkouts`。Webhook 订阅需 `sandbox: true` label。沙箱通过 ≠ 生产已开通 Business Checkout。

---

## OKX Onchain OS / x402 `okx_onchain`

使用官方 `@okxweb3/x402-core`、`@okxweb3/x402-evm`（以及已安装的 `@okxweb3/x402-fastify` 作为官方 Fastify 包存在性证明）。**不**手写 EIP-712 / 链上验签。没有常规支付 webhook：公开回调路径会拒绝。买家证明走已登录 `POST /v1/orders/:id/complete`（body `paymentSignature` 或头 `PAYMENT-SIGNATURE` / `paymentPayload`）。

createCheckout 返回 `action.type=x402`（`hostedUrl=false`），不是托管收银台 URL。挑战里的 `resource.url` 必须是可访问的公开 Entitlement HTTPS 基址拼出的 `/v1/orders/{orderId}/complete`：凭证 `resourceBaseUrl` 或安全 metadata `resourceBaseUrl` / `entitlementPublicBaseUrl`。拒绝 localhost、链路本地与 RFC1918 私网。不要写假域名。履约只使用库里已持久化的 `attempt.action` / `paymentRequired`；买家 `PAYMENT-SIGNATURE` / `paymentPayload` 里替换的 requirements 会被丢掉。`verifyPayment` 成功后才 `settlePayment`，仅成功结算证明履约并保存 tx hash。官方 SDK 无退款 API：`refund=false`，不要假装可退。默认 Facilitator Host：`https://web3.okx.com`（不可自定义）。ExactEvmScheme 内置默认资产仅覆盖 `eip155:196` / `eip155:1952`；其他链必须配置 `asset`。缺少公开 `resourceBaseUrl` 时 health **关闭**。

若官方包无法加载，health **关闭**，不会用假验证顶上。本文 **没有** live facilitator 验证。

### 凭证字段

| 字段 | 说明 |
|---|---|
| `apiKey` / `secretKey` / `passphrase` | OKX Facilitator HMAC |
| `payTo` | 收款地址 |
| `network` | CAIP-2，如 `eip155:196` |
| `asset` | 非默认网络时必填 token 地址 |
| `resourceBaseUrl` | 公开 Entitlement HTTPS 基址；也可用 metadata `entitlementPublicBaseUrl` |

---

## BitPay `bitpay`

### 运营前提

1. Dashboard POS token（创建发票）。退款必须走官方 `bitpay-sdk`（8.0.5）签名的 merchant facade：`privateKey`（secp256k1 hex）+ `merchantToken`。仅有 merchant token、没有私钥时 **不能退款**（`refund=false`，抛 `PAYMENT_REFUND_UNSUPPORTED`）。不要声称 token-only POST `/refunds` 可用于生产。
2. HTTPS `notificationURL` → `POST /v1/payments/webhooks/bitpay/:configId`。
3. BitPay **默认不签 IPN**。IPN 只作触发器，必须 `GET /invoices/:id` 后履约。仅发票状态 `complete` 成功；`paid` / `confirmed` 保持 pending。
4. 若配置了 `ipnHmacSecret`，则校验 `x-signature` HMAC。候选体是 **原始 raw body** 以及 `JSON.parse` 后再 `JSON.stringify` 的规范 JSON（保留字符串值里的空格）。不会做全局去空白。未配置则跳过 HMAC 但仍查单。

官方 Host：`sandbox` → `https://test.bitpay.com`；`live` → `https://bitpay.com`。`X-Accept-Version: 2.0.0`。Ack 纯文本 `Success`。本文 **没有** live 商户验证。

### 凭证字段

| 字段 | 说明 |
|---|---|
| `posToken`（或 `token`） | POS/发票 token |
| `notificationUrl` | HTTPS IPN |
| `merchantToken` | 可选；与 `privateKey` 一起才开放已签名退款 |
| `privateKey` | 可选；32 字节 secp256k1 hex。文件路径不接受 |
| `identity` | 可选；公钥 hex，仅诊断。签名身份由 SDK 从私钥导出 |
| `ipnHmacSecret` | 可选 HMAC |
| `redirectUrl` | 可选买家回跳（不履约） |

---

## Admin 写入示例（密钥勿提交）

```http
POST /v1/admin/payments/providers
Authorization: Bearer <admin>
```

支付宝：`providerId=alipay_f2f`，`environment=sandbox|live`，`marketScopes=["CN"]`，`currencies=["CNY"]`，`enabled` 先 `false`，test 通过后再 enable。

PayPal：`providerId=paypal`，`marketScopes=["GLOBAL"]`，`currencies=["USD"]`（或你目录里的币种）。

微信：`providerId=wechat_pay_v3`，`marketScopes=["CN"]`，`currencies=["CNY"]`。

银联：`providerId=unionpay_quickpass`，`checkoutMode` 先按入网产品选 `hosted` 或 `qr`。

Stripe：`providerId=stripe_checkout`，`marketScopes=["GLOBAL"]`，密钥前缀必须与 `environment` 一致。

Coinbase Business：`providerId=coinbase_commerce`，CDP `apiKeyId` + `apiKeySecret` + webhook secret；仅 USDC/Base。

OKX x402：`providerId=okx_onchain`，Facilitator HMAC 凭证 + `payTo` + `network` + 公开 `resourceBaseUrl`；买家用 `POST /v1/orders/:id/complete` 提交 PAYMENT-SIGNATURE。

BitPay：`providerId=bitpay`，POS token + HTTPS `notificationUrl`；IPN 只触发查单，发票 `complete` 才履约。退款还需 `privateKey` + `merchantToken` 走官方 SDK。

轮换：`POST /v1/admin/payments/providers/:id/rotate`。旧密钥在 retiring 窗口内仍可用于验签。

---

## 不要做的事

- 不要把支付宝/PayPal/微信/银联/Stripe/Coinbase/OKX/BitPay 密钥放进产品仓 `.env` 或浏览器。
- 不要用客户端 `amountCents` / 自报已支付。
- 不要在生产凭证里塞自定义 gateway / apiBase。
- 不要把 Hosted 支付宝商户号复用到客户私有化部署。
- 不要跑对本文件的 live smoke；联调在沙箱用真实商户工具，不在 CI 打真实网关。
- 本文不声称已对上述渠道做 live 商户验证。
