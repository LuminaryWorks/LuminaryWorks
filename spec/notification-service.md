# LuminaryWorks Notification（一期：共享邮件模块）

> **状态**：Accepted（一期） · **范围**：平台级消息能力抽象  
> **相关**：[ecosystem-refactoring.md](./ecosystem-refactoring.md) · [migration-matrix.md](./migration-matrix.md)

## 0. 决策摘要

| # | 决策 | 落地 |
|---|------|------|
| D-N1 | Notification 是**平台级**能力，不属于任一产品后台 | `@luminaryworks/notification` |
| D-N2 | **一期**：共享 NestJS 代码包，随产品进程部署 | `LuminaryWorks/shared/packages/notification` |
| D-N3 | **后期**：独立 `notification-service`（K8s / HTTP / 事件） | 保持契约不变，换实现 |
| D-N4 | 一期只实现 **Email**；Slack / Teams / Webhook / SMS 仅保留通道枚举 | 扩展点不写死实现 |
| D-N5 | **不引入** BullMQ、独立 DB、独立 HTTP 服务 | 用户量上来后再加队列 |
| D-N6 | SMTP 凭据只进环境变量 / Secret，**禁止**写入源码或示例真实值 | 见 §5 |

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
| 注册 / 找回 / MFA 邮件 | Logto Experience |
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
| 一期（当前） | `modules/notification` 共享包 | 逻辑独立、部署合并 |
| 二期 | + BullMQ / 重试 / 限流 | 用户量上升后 |
| 三期 | 独立 `notification-service` | 产品改依赖为 HTTP/事件客户端，契约尽量不变 |

## 7. 验收（一期）

- [x] `@luminaryworks/notification` 可 build / check / test
- [x] DataTalk 报表邮件经 `NotificationService` 发送，无直接 nodemailer 引用
- [x] 未配置 SMTP 时行为与现网一致（失败可观测，无假成功）
- [x] 无 BullMQ / 无独立 K8s 服务 / 无非 Email 通道实现
- [ ] 轮换后的 SMTP 凭据写入本机 `.env.local` 后，执行 `pnpm --dir packages/notification smoke:smtp` 完成联调
