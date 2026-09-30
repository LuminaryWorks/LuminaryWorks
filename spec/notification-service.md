# LuminaryWorks Notification（一期：共享邮件模块）

> **状态**：Accepted（一期） · **范围**：平台级消息能力抽象  
> **相关**：[ecosystem-refactoring.md](./ecosystem-refactoring.md) · [migration-matrix.md](./migration-matrix.md) · [subscription-and-entitlement.md](./subscription-and-entitlement.md)（Trial T-3 / T-1 / 到期事件由 Entitlement outbox 投递）

## 0. 决策摘要

| # | 决策 | 落地 |
|---|------|------|
| D-N1 | Notification 是**平台级**能力，不属于任一产品后台 | `@luminaryworks/notification` |
| D-N2 | **一期**：共享 NestJS 代码包，随产品进程部署 | `LuminaryWorks/shared/packages/notification` |
| D-N3 | **认证邮件**提前做成独立 HTTP 服务；产品报表 SMTP 仍走共享包 | `services/notification`；Logto 只配一个 HTTP Email connector |
| D-N4 | 一期 Email + 群机器人 **WeCom / Feishu / DingTalk**（`sendImWebhook`，无 Nest）；Slack / Teams / 通用 Webhook / SMS 仍仅枚举 | 扩展点不写死实现 |
| D-N5 | 认证邮件服务自有 Postgres（profile / 幂等 / 额度）。**不引入** BullMQ。产品报表路径仍无独立 DB | `services/notification` |
| D-N6 | SMTP / API 凭据只进环境变量、Secret 或加密列，**禁止**写入源码或示例真实值 | 见 §5 |
| D-N7 | **Logto 拥有验证码状态机**；Notification 只负责投递 | 六个产品不自建 OTP |
| D-N8 | 认证信 Provider 链：Resend → Brevo → Mailgun → SMTP（SES 槽位）。平台发件人与显示名只读 `MAIL_FROM` / `MAIL_FROM_NAME`；Mailgun 域名只读 `MAILGUN_DOMAIN`。用到日/月额度 **95%** 换下一家。超时不 failover，幂等键禁止双发 | `@luminaryworks/notification` auth-mail |
| D-N9 | `EMAIL_AUTH_ENABLED=false` 关闭认证邮件（内网私有化）。SaaS 企业可存自带 Brevo / Resend / Mailgun / SMTP，未配置走平台链，发件人取 `MAIL_FROM` | `mail_profiles` |

## 1. 目标架构

```text
                 LuminaryWorks

           @luminaryworks/notification
              NotificationModule
                     |
              NotificationService
                     |
        +------------+------------+
        |                         |
      Email                    Future
        |                         |
  @nestjs-modules/mailer    Slack/Teams/Webhook/SMS
        |
   SMTP (SES Mail Manager)
        |
   report@… / product From
```

一期产品侧典型接入：

```text
DataTalk ReportModule
  └─ MailService（产品适配：业务 HTML / 截图 / PDF）
       └─ NotificationService.sendEmail()
```

## 2. 职责边界

### 2.1 共享包负责（传输层）

- 通道抽象与 `isConfigured(channel)`
- Email：SMTP 投递（HTML / text / 附件 / CID）
- 稳定公开契约（不暴露 Nodemailer / Mailer 类型）
- 配置由宿主 `forRoot` / `forRootAsync` 注入（**不**直接读 `process.env`）

### 2.2 产品侧负责（业务层）

- Cron / 策略 / 收件人解析
- 业务 HTML、截图、PDF、领域审计日志（如 `report_send_log`）
- Casbin 等资源授权
- 环境变量绑定（如 `SMTP_*` → 模块 options）

### 2.3 明确不在本模块

| 能力 | 归属 |
|------|------|
| 注册 / 找回 / MFA **验证码状态机** | Logto Experience（不自建第二套 OTP） |
| 上述邮件的 **投递** | `services/notification` ← Logto HTTP Email connector |
| 仪表盘订阅策略与 Puppeteer 渲染 | DataLuminary DataTalk |
| 告警规则与 IoT 事件语义 | 各产品（如 VistaCast） |

## 3. 公开契约（一期）

```ts
type NotificationChannel = "email" | "slack" | "teams" | "webhook" | "sms";

interface EmailMessage {
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
    cid?: string;
  }>;
}

class NotificationService {
  isConfigured(channel?: NotificationChannel): boolean;
  sendEmail(message: EmailMessage): Promise<SendEmailResult>;
}
```

- 未配置 Email 时：`isConfigured("email") === false`；`sendEmail` 抛 `NotificationChannelNotConfiguredError`（**禁止**假成功）。
- 发送失败向上抛错，由产品侧写业务日志；一期无队列 / DLQ。

## 4. SMTP / SES Mail Manager 约定

配置保持 **provider-neutral**（`host` / `port` / `user` / `pass` / `secure` / `requireTLS`）。

当前生产推荐：**Amazon SES Mail Manager authenticated ingress**：

| 项 | 建议 |
|----|------|
| Port | `587` |
| TLS | STARTTLS：`secure=false`，`requireTLS=true` |
| Auth | Ingress username + password（Secrets Manager / `.env`） |
| From | 已验证域名身份（如 `report@luminaryworks.dev`） |

AWS 侧前置：verified identity、退出 sandbox（或仅用允许收件人）、Mail Manager 规则含 **Send to internet**。

兼容变量名（产品侧，非包内硬编码）：

| 变量 | 说明 |
|------|------|
| `SMTP_HOST` | SMTP hostname |
| `SMTP_PORT` | 默认 `587`（Mail Manager）；历史默认可能为 `465` |
| `SMTP_USER` / `SMTP_PASS` | SMTP 凭据 |
| `SMTP_SECURE` | 可选；`true` 时 implicit TLS（465） |
| `SMTP_REQUIRE_TLS` | 可选；587 建议 `true` |
| `MAIL_FROM_OFFICIAL` | 产品官方发件人（业务侧） |

## 5. 安全

1. **禁止**将 SMTP 密码、Ingress 用户名写入 Git、README、spec 示例中的真实值。
2. 若凭据曾出现在工作区临时文件（如本地 `test.html`）：立即在 AWS 控制台**轮换 / 吊销**，再更新本机 `.env.local`。
3. 文档与 `.env.example` 仅保留空值或占位符。

## 6. 演进路径

| 阶段 | 形态 | 说明 |
|------|------|------|
| 一期 | 共享包 SMTP | 产品报表仍走 `NotificationService.sendEmail()` |
| 认证邮件（当前） | `services/notification` HTTP + Provider 链 | 只承接 Logto 认证信与企业发信 profile。报表不迁入，避免和验证码抢免费额度 |
| 后期 | 队列 / 产品信也进同一服务 | 契约保持 `EmailProvider`，再加 BullMQ |

## 7. 认证邮件

```text
Product SPA → Auth Gateway → Logto
                              │  HTTP Email connector（全租户只有这一个）
                              ▼
                    services/notification
                     POST /internal/logto/email
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
         组织 profile    部署 profile      平台链
         （已验证）      （私有化默认）   Resend → Brevo → Mailgun → SMTP
```

选路：

1. payload 里的 `organization.id` 命中已验证、已启用的组织 profile
2. 否则收件域名命中 profile 的 `matchDomains`（拒绝 gmail.com 等公共域）
3. 否则使用已验证的 `deployment` profile（私有化客户默认发信）
4. 否则走平台链。发件人与显示名取环境变量 `MAIL_FROM`、`MAIL_FROM_NAME`。Mailgun 使用 `MAILGUN_DOMAIN`，未设置则不加入链。

平台链按 `usage=auth|product` 分开计数。认证信默认 Resend 日 100 / 月 3000、Brevo 日 300。达到 **95%** 的新邮件走下一家，不等供应商把额度打满。OVH 上走供应商 HTTPS API（443），不用 25 端口。SMTP 槽位留给以后的 SES Mail Manager（587 + STARTTLS）和企业自带 SMTP。

幂等键 `sha256(to + type + code + link)`。已成功直接返回；`pending` / 超时 `unknown` **不再打第二家**。只有明确拒绝（4xx，不含超时）或额度用尽才 failover。Logto 只有在供应商接受后才收到 HTTP 200。

`EMAIL_AUTH_ENABLED=false`：服务对 webhook 返回 503；Identity bootstrap 卸下 `http-email` connector，注册不验证，Adaptive MFA 关闭。

企业凭据 AES-GCM 后入库，管理 API 只接受服务间 `Authorization: Bearer`，不进浏览器、不进六个产品。`verified` 本期由操作员置位。

部署 manifest `capabilities.notification`：

| 取值 | 含义 |
|------|------|
| `none` | 不启用认证邮件（内网） |
| `smtp` | 客户自带 SMTP（`deployment` profile） |
| `platform` | SaaS 平台链（Resend / Brevo / SMTP 槽位） |

凭据仍然不进 manifest。

## 8. 验收（一期）

- [x] `@luminaryworks/notification` 可 build / check / test
- [x] DataTalk 报表邮件经 `NotificationService` 发送，无直接 nodemailer 引用
- [x] 未配置 SMTP 时行为与现网一致（失败可观测，无假成功）
- [x] 无 BullMQ / 无独立 K8s 服务 / 无非 Email 通道实现
- [ ] 轮换后的 SMTP 凭据写入本机 `.env.local` 后，执行 `pnpm --dir packages/notification smoke:smtp` 完成联调
