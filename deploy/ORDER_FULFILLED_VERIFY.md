# order.fulfilled 一次验证清单（Entitlement → VistaRemote）

工程侧已完成：履约 outbox 写入 `sku` / `paidAt` / `products[]`，并 HMAC 投递到 `ENTITLEMENT_ORDER_FULFILLED_TARGETS`（缺失 target **不会**静默标 sent）。

**范围：** 沙箱 mock 收银 → 产品侧 `User.plan` 经 webhook 同步。  
**不在本清单：** 微信/支付宝生产商户进件、公网 DNS、live PSP 真收款（owner-ops，见 `deploy/PAYMENTS.md`）。

---

## 0. 前置（一次配齐）

在 **LuminaryWorks** `deploy/env/control-plane.env`：

```bash
# 与 VistaRemote server 的 ENTITLEMENT_WEBHOOK_SECRET 必须逐字相同
ENTITLEMENT_ORDER_FULFILLED_TARGETS={"vistaremote":{"url":"http://host.docker.internal:3000/api/v1/commerce/webhooks/entitlement","secret":"<SHARED_HMAC_SECRET>"}}
```

在 **VistaRemote** server env：

```bash
ENTITLEMENT_MODE=enforce
ENTITLEMENT_WEBHOOK_SECRET=<SHARED_HMAC_SECRET>
# 不要在 VistaRemote .env.prod 写 ENTITLEMENT_ORDER_FULFILLED_TARGETS（assert:prod-env 会失败）
```

重启 Entitlement（读到新 env）与 VistaRemote server。确认：

- [ ] Entitlement `GET /ready` 200
- [ ] VistaRemote API 可达；登录用户已有 `users.logtoSub`（与支付 Act-As 一致）
- [ ] 沙箱有 enabled `mock` payment config（dev 会自动 seed）

Docker Desktop 上 VistaRemote 在宿主机 `:3000` 时，Entitlement 容器用 `host.docker.internal`；若同 compose 网络，改成产品 service 名 + 端口。

---

## 1. 沙箱买会员（Client）

1. 用已绑定 Logto 的账号打开 Client → **Membership**
2. 选 **Pro** 或 **Ultra** → 选 **mock**（或 CN 列表中的 mock）→ 下单
3. 点完成支付 / 等轮询到 paid（mock `completeCheckout`）
4. 刷新权益：本地套餐应变为 Pro/Ultra

- [ ] UI 显示已购计划
- [ ] Admin Users（或 DB）`User.plan` 已更新

---

## 2. 验证是 webhook 路径（不只是 complete 直写）

complete/status 也会 sync plan；要确认 **outbox fan-out** 也成功：

```sql
-- Entitlement DB
SELECT id, event_type, status, attempts, last_error, payload
FROM outbox_events
WHERE event_type = 'order.fulfilled'
ORDER BY created_at DESC
LIMIT 5;
```

- [ ] 最新行 `status = sent`（不是 `failed` / `dead`）
- [ ] `payload` 含非空 `sku`、`paidAt`、`products`
- [ ] `last_error` 为空

VistaRemote DB（或日志）：

- [ ] `commerce_webhook_acks`（或等价表）出现对应 `eventId`（形如 `{outboxId}:vistaremote`）
- [ ] 无 `INVALID_SIGNATURE` / `WEBHOOK_USER_NOT_FOUND` / `INVALID_PAYLOAD`

可选强制投递：`POST /v1/admin/outbox/poll`（需 admin 凭证）。

---

## 3. 负向（确认不会假成功）

- [ ] 临时改错 `TARGETS.vistaremote.secret` → outbox 应变 `failed` 并重试，**不会** `sent`
- [ ] 改回正确 secret → 重试后 `sent`，产品侧幂等 ack

---

## 4. 通过标准

| 检查 | 通过 |
| :--- | :--- |
| mock 下单 → Membership 权益正确 | ☐ |
| `outbox_events` `order.fulfilled` = `sent` | ☐ |
| 产品侧有 HMAC ack / plan 投影 | ☐ |
| 错 secret 不标 sent | ☐ |

全部勾完即可认为 **商户回调链路（Entitlement → VistaRemote）沙箱一次验证成功**。  
生产微信/支付宝：在 Control Console 配真实 provider + `notifyUrl` 指 `POST /v1/payments/webhooks/:provider/:configId`，再按 `deploy/PAYMENTS.md` 做渠道沙箱；与本清单分开验收。
