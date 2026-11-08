# Notification Service

Logto 的 HTTP Email connector 只调用 `POST /internal/logto/email`。Resend、Brevo、SMTP 和某家企业自己的发信凭据都在这个服务里选路。

产品报表邮件仍走 `@luminaryworks/notification` 的 SMTP，不进这条链。

数据面使用控制面共享 Postgres（`control-plane-db` 上的 `notification` 库），不再起独立 DB 容器。

```bash
# from MetaRepo root — shared Postgres on 127.0.0.1:5433
cp deploy/env/control-plane.env.example deploy/env/control-plane.env   # once; fill secrets
pnpm notify:up   # alias: node scripts/control-plane-db.mjs up

cd services/notification
cp env.example .env
# set NOTIFICATION_DATABASE_URL password = NOTIFICATION_DB_PASSWORD from control-plane.env
pnpm install
pnpm migration:run
pnpm start:dev
```

Logto connector 配置：

- endpoint: `http://notification:3055/internal/logto/email`（控制面 Compose DNS；本机调试可用 `http://127.0.0.1:3055/...`）
- authorization: `Bearer <NOTIFICATION_SERVICE_KEY>`

`EMAIL_AUTH_ENABLED=0` 时 webhook 返回 503。内网私有化用这个开关，同时 Identity bootstrap 不安装 connector。

企业 profile：`POST /internal/mail-profiles`，同样带 Bearer。响应里没有凭据明文。`matchDomains` 不能是 gmail.com 这类公共邮箱。`verified` 本期由操作员置位后才会被选路。

### EntFunHub

- 注册验证码由 EntFunHub `platform-api` 调本服务（`type=Register`，`organization.id=entfunhub`，`application.name=EntFunHub`）。
- 建 org profile：`scope=organization`，`organizationId=entfunhub`，`fromAddress=notify@EntFunHub.com`，`usage=auth`，`verified=true`，凭据优先 Resend。
- **BYO 选路顺序**：该 profile → 平台 Resend/Brevo/Mailgun → **自建 SMTP（最后）**。全局 Logto 平台链仍是「有 SMTP 则 SMTP 优先」（D-N8），不变。
- Cloudflare DNS（SPF / DMARC / DKIM）见 EntFunHub `docs/EMAIL_DNS.md`。
