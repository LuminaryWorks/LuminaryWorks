# Maddy（只发信）

Docker Compose 跑在 `43.154.60.121`，只开放提交端口 **587**。不监听 25，不开 IMAP。

SMTP 账号 `notify` 可以代发：

- `auth@luminaryworks.dev`（登录 / 注册验证码）
- `report@dataluminary.dev`（DataLuminary 订阅推送）

主机名是 `mail.luminaryworks.dev`。密码只放在服务器 `data/` 和本机 `.env`，不要提交。

## DNS

`*.luminaryworks.dev` 目前被 Cloudflare 代理。SMTP 不能走橙色云。需要一条 **DNS only** 记录盖过泛解析：

| 类型 | 名称 | 内容 |
|------|------|------|
| A | `mail.luminaryworks.dev` | `43.154.60.121`（灰色云） |
| TXT | `luminaryworks.dev` | 现有 SPF 中加入 `ip4:43.154.60.121` |
| TXT | `default._domainkey.luminaryworks.dev` | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtw2NZhW+5Pj8Dn6DrwiDGJH/rUDItF+qkHd4qrJA8ayCh1GBS0QfovmNklctL3GoJ9/lG8XJsziVlW2P1PddpCVh/MHoDSO6mxl1EJNmfWBOcaniSdmUsPvPY6wke/MEhwZOpKg0OX+0kglFToTadVfuEJQd4CyXV9XEghDi3pEQGnBjX9i0m/WaTZLNdifFvefEo5ztmAUN+ghrTOpC7p6kP5KoziPcBWqfAEJ7NGLhjywW8xfxtDdvk7ZODdB/aIL8qn2ORTo7+LUFAVzPrUIiZ808dF/RYyBQiMKBLosiEUGkqrEui7xoGCyz5Pbwmf1CmrC+ChciBFZK/TZIzwIDAQAB` |
| TXT | `default._domainkey.dataluminary.dev` | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsvl+QJpO2XH+pO5x4H07UnQdzcM/mmCqWUyEarbIMcwSwwrb8D5pcVwXtZSjbTmHE2ggsYri1BL+J8SdRp6mVEggQXDDbXQqFSo/v/wKb05fGKog/O6QsL1Q9YuUzuHc4ZTxIU1zU8ujQU0qYx0hKAq3z93BABQiLBIYN4eNJs4WzEiedq5UcrxTpiFWq5VXCGh6bP26YzNtjEMpjtF/HOc3KtMB1MLsKK8U6k/uw9O4AYmdRw81wZVgz9vIggkMPwSHpmP8XYL466kx5zfqU5eW4YRse1cxndlzxe/wgCPRkPSV3SpwvyNIJHgmhBhuJF6YmXG4u6WPq0nCZPIDNwIDAQAB` |
| TXT | `dataluminary.dev` | 该域 SPF 加入 `ip4:43.154.60.121` |

测试机 `43.154.60.121` **不做 PTR**。腾讯云反向解析 300 元/条/年，这台只做前期测试。没有反向解析时，Outlook 仍可能把信放进垃圾箱。Gmail 可能在 SMTP 250 之后把信丢掉且不退信，服务端这时视为已发送，不会改走别的服务。

## 上线 OVH 时的反向解析

OVH 的 PTR 不另收费。现在还不能配：`mail.luminaryworks.dev` 的 A 记录仍指向 `43.154.60.121`。迁到 OVH 时按这个顺序做，不要提前在 OVH 上填 PTR。

1. 把 `mail.luminaryworks.dev` 的灰色云 A 记录改到 OVH 的发信 IP。
2. 在 OVH 后台把该 IP 的 PTR 设为 `mail.luminaryworks.dev`。一个 IP 只有一条 PTR。
3. 发信服务器对外身份保持 `mail.luminaryworks.dev`（Maddy 的 `hostname` 已是这个值）。LuminaryWorks 旗下产品共用这一条，不为每个产品域名再做一条 PTR。
4. 其他产品域名（如 `blockyedu.com`）在自己的 DNS 里发布 SPF 和 DKIM，授权 `mail.luminaryworks.dev` 代发。发件地址可以仍是该产品自己的邮箱。

在这条 A 记录生效之前，客户端用 `43.154.60.121:587`，TLS 服务器名仍是 `mail.luminaryworks.dev`。证书在 DNS 记录可解析到这台机器之前是自签的，`SMTP_TLS_REJECT_UNAUTHORIZED=false`。
