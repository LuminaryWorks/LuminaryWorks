# LuminaryWorks 首次安装：环境变量

真实值在解压后的 `.env` 里（chmod 600）。**不要**写进 `site.json`。

先看 `START-HERE.md`。配置可以走 **安装配置页** 或 **直接改这些文件**；表单打开时从 env 读默认值。

## 公网登录密码

`identity/ACCOUNTS.product.env` 里的 `*_PASSWORD`：表单或 env **未填则随机生成**，已有值不覆盖。装完到该文件或 CSV 查找。

| 文件 | 做什么 |
|---|---|
| `site.json` | 勾选 `products.*.enabled`、`publicHost`、各产品 `hosts`（不要写密码） |
| `identity/ACCOUNTS.product.env` | 超管 / 各产品 admin 的邮箱、用户名、密码 |

`CONTROL_CONSOLE_IDP_CLIENT_ID` 在 Identity 完成应用注册后再填；空着时控制台页面能开，OIDC 登录还不可用。

## 已随机生成（不对公网）

这些服务没有宿主机端口，或只绑在 `127.0.0.1`。打包时已写入随机值；`install.sh` 发现仍为空才会再生成，**已有值不覆盖**。

需要排障时打开文件查找即可。不要在向导里改成弱口令。

| 文件 | 典型项 |
|---|---|
| `deploy/env/control-plane.env` | `IDENTITY_DB_PASSWORD`、`ENTITLEMENT_DB_PASSWORD`、服务 API key / pepper |
| `identity/.env` | `LW_LOGTO_ADMIN_PASSWORD`（Admin 仅 `ssh -L 3002:127.0.0.1:3002`） |
| `products/<产品>/` 下的 `.env` | 该产品自己的库口令 |

## 域名

`site.json` 的 `hosts` 是浏览器主机名。打包默认：

| 产品 | 主机名 |
|---|---|
| 控制面 / Identity | luminaryworks.dev |
| DataLuminary | dataluminary.dev |
| BlockyEdu | blockyedu.com |
| DoerFlow | doerflow.dev |
| VistaCast | vistacast.dev |
| **VistaRemote** | **vistaremote.vistacast.dev**（无独立主域，挂在 vistacast.dev） |
| SyncroBrain | syncrobrain.com |

当前包仍按端口发布。`.dev` 在浏览器里强制 HTTPS；没有证书时先用 `http://IP:端口` 验收。

## 安装脚本会改的 URL（一般不用手改）

`install.sh` 会按 `publicHost` 写成：

| 变量 | 值 |
|---|---|
| `CONTROL_PLANE_BIND_ADDR` | `0.0.0.0` |
| `CONTROL_PLANE_ADMIN_BIND_ADDR` | `127.0.0.1` |
| `IDENTITY_ENDPOINT` | `http://<publicHost>:3001` |
| `IDENTITY_ADMIN_ENDPOINT` | `http://127.0.0.1:3002` |
| `AUTH_GATEWAY_PUBLIC_URL` | `http://<publicHost>:3010` |
| `ENTITLEMENT_OIDC_ISSUER` | `http://<publicHost>:3001/oidc` |
| `CONTROL_CONSOLE_*` URL | 指向 `:3050` / `:3040` / `:3001` |

## 勾选产品

`site.json` 里六个产品：`dataluminary`、`blockyedu`、`doerflow`、`vistaremote`、`vistacast`、`syncrobrain`。  
BlockyEdu 课包用 `products.blockyedu.seed`，不要写到 Identity 账号文件里。

勾选 BlockyEdu 时默认：

- `EDU_SEED_PROFILE=full-demo` — AI 口语 / 英语演示课 + Python 等 LMS 演示目录
- `EDU_SEED_PACKS=syncrobrain,dataluminary,vistacast,doerflow,vistaremote` — 平台 Markdown 课包（已打进 kit 的 `products/blockyedu/edu-server/content/course-packs/`）

只要 `packs: []` 才不导入课包。`profile: none` 关闭演示目录，但仍可只导入课包。

## 不要开

对象存储、`--profile ai`、`--profile observability`。`AISTOR_*` 保持空。

## 安全组

配置页默认走 **TCP 80**（被占用才用 8080 / 8099），`install.sh` 会自动放行本机 `ufw` / firewalld / iptables。

云厂商安全组**不能**从虚机内部改写（没有 API 密钥）。因此：

| 厂商 | 配置页策略 |
|---|---|
| 腾讯云 / 阿里云 / AWS | 默认用 80，控制台默认安全组一般已放行 |
| OVH | 通常没有额外安全组，本机防火墙即可 |
| GCP / Azure | 默认 80；若 VPC/NSG 没放行 80，在控制台补一条 |

装完后产品还需要：`22`、`80`、`443`、`3001`、`3010`、`3040`、`3050`。  
**不要**放行 `3002`。数据库和 Redis 没有宿主机端口。向导绑 `0.0.0.0`，自动探测公网 IP，没有公网才用局域网。在运维电脑浏览器打开终端打印的地址。
