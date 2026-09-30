# Notification Service

Logto 的 HTTP Email connector 只调用 `POST /internal/logto/email`。Resend、Brevo、SMTP 和某家企业自己的发信凭据都在这个服务里选路。

产品报表邮件仍走 `@luminaryworks/notification` 的 SMTP，不进这条链。

```bash
docker compose up -d
cp .env.example .env   # 填 NOTIFICATION_SERVICE_KEY / NOTIFICATION_SECRET_KEY，以及要用的供应商 key
pnpm install
pnpm start:dev
```

Logto connector 配置：

- endpoint: `http://host.docker.internal:3050/internal/logto/email`（Logto 在容器内时）
- authorization: `Bearer <NOTIFICATION_SERVICE_KEY>`

`EMAIL_AUTH_ENABLED=0` 时 webhook 返回 503。内网私有化用这个开关，同时 Identity bootstrap 不安装 connector。

企业 profile：`POST /internal/mail-profiles`，同样带 Bearer。响应里没有凭据明文。`matchDomains` 不能是 gmail.com 这类公共邮箱。`verified` 本期由操作员置位后才会被选路。
