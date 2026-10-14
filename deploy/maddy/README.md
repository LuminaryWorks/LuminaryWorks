# Maddy（只发信）

Docker Compose 跑在 OVH `15.204.83.204`（`~/luminary-maddy`），只开放提交端口 **587**。不监听 25，不开 IMAP。

SMTP 账号 `notify` 可以代发：

- `auth@luminaryworks.dev`（登录 / 注册验证码）
- `report@dataluminary.dev`（DataLuminary 订阅推送）

主机名是 `mail.luminaryworks.dev`。密码只放在服务器 `data/` 和本机 `.env`，不要提交。

## DNS

`*.luminaryworks.dev` 目前被 Cloudflare 代理。SMTP 不能走橙色云。需要一条 **DNS only** 记录盖过泛解析：

| 类型 | 名称 | 内容 |
|------|------|------|
| A | `mail.luminaryworks.dev` | `15.204.83.204`（灰色云） |
| TXT | `luminaryworks.dev` | SPF 含 `ip4:15.204.83.204`（去掉旧腾讯云 `43.154.60.121`） |
| TXT | `default._domainkey.luminaryworks.dev` | 以服务器 `data/dkim_keys/luminaryworks.dev_default.dns` 为准（重建 Maddy 后会变） |
| TXT | `default._domainkey.dataluminary.dev` | 以服务器 `data/dkim_keys/dataluminary.dev_default.dns` 为准 |
| TXT | `dataluminary.dev` | SPF 含 `ip4:15.204.83.204` |

## 反向解析（OVH）

OVH 的 PTR 不另收费。顺序：

1. `mail.luminaryworks.dev` 灰色云 A → OVH 发信 IP。
2. OVH 后台该 IP 的 PTR → `mail.luminaryworks.dev`。一个 IP 只有一条 PTR。
3. 发信服务器对外身份保持 `mail.luminaryworks.dev`（Maddy `hostname`）。全产品共用这一条。
4. 其他产品域名在自己的 DNS 发布 SPF / DKIM，授权本机代发。

## TLS

提交口目前用自签证书（`data/tls/`）。客户端需 `SMTP_TLS_REJECT_UNAUTHORIZED=false`，或后续换成 Let's Encrypt 后改为严格校验。

## 本机启动

```bash
cd ~/luminary-maddy && docker compose up -d
```
