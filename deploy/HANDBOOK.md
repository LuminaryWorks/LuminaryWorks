# LuminaryWorks 客户部署手册

本文给 **实施人员 / 客户运维**：如何把 LuminaryWorks 装到公网 SaaS、或装到内网实体服务器。  
架构规范以 [`spec/composable-deployment.md`](../spec/composable-deployment.md) 为准。实验室口令与内部脚本见 [`OPERATOR.md`](OPERATOR.md)（不是客户合同）。

---

## 1. 先选形态，再动手

六个产品 **各自独立可售、独立部署**。也可以按场景 **组合部署**。  
共享的是登录与契约，**不是**共享业务数据库，也 **不是**把六个产品捏成一个巨型 Compose。

| 你怎么卖 / 怎么用 | 选什么 | 最小安装 |
|---|---|---|
| 只买 / 只上一个产品 | **独立部署** `standalone` | 该产品安装包 + 自有数据库 |
| 告警 → 工单 → 付费任务 | **组合** `agent-commerce` | VistaCast + SyncroBrain + DoerFlow（控制面可选） |
| 再加远程介入与报表 | **组合** `smart-site` | 上面三个 **不要重装**，再叠加 VistaRemote + DataLuminary；BlockyEdu 仅培训入口，可不上 |
| 只要统一登录 / 套餐 | **控制面** `control-plane` | Identity + Auth Gateway + Entitlement（可选） |
| 机房断网 | **断网** `air-gapped` | 任意独立或组合；镜像 U 盘导入；不用中央云 AI |

**公网 SaaS 与内网私有化是同一套安装包。** 差别只有：域名、TLS、是否出网、用你们的 IdP 还是自带 Identity、License 在线还是离线。不要为私有化再做一套安装程序。

```text
独立：  只 load 一个产品的镜像 → 只 up 一个 Compose 工程
组合：  load 多个产品的镜像     → 每个产品仍是独立 Compose 工程，用场景顺序 up
禁止：  把六个产品的 compose 文件合并成一个 project（会撞名、共库、一台故障拖垮全栈）
```

---

## 2. 六个产品（均可单独上线）

| 产品 | 独立时干什么 | 组合时在链路里的位置 |
|---|---|---|
| **VistaCast** | 摄像头、视觉事件、告警 | 发出 `alert.v1` |
| **SyncroBrain** | 设备、遥测、Incident / WorkOrder | 吃告警，出工单 |
| **DoerFlow** | 目录、Job、authorize / capture / void | 付费任务 |
| **VistaRemote** | 远程会话（须人工点 deep link） | 远程介入；回调只作证据，不自动关单、不 RPC |
| **DataLuminary** | 报表、看板、导出 / embed | 只观察，不做 Safety / 结算权威 |
| **BlockyEdu** | 课程、演练 | 培训链接；**不是**生产运行依赖 |

每个产品独占：业务库、迁移、Casbin、领域密钥、发布版本。  
产品之间禁止共用一张业务表、禁止一个 `.env` 装完全部密钥。

可选 **控制面**（不是产品）：

| 组件 | 作用 | 独立部署时 |
|---|---|---|
| Identity（默认 Logto） | 登录、OIDC | 可改成客户 IdP：`identity=external_oidc` |
| Auth Gateway | 浏览器走网关，JWT `iss` 仍是 IdP | 可不上 |
| Entitlement | 套餐 / License | 可 `off` 或 `offline_license` |
| Control Console | 目录 / 支付 / 法律超管 SPA（不是 Logto Admin） | 随控制面上；需 `entitlement:admin` |

`ai=central` 仅实验室，**生产禁止**。生产用 `ai=off` 或产品内 `local_byok`。

---

## 3. 环境要求（云主机与实体机相同）

| 项 | 要求 |
|---|---|
| 操作系统 | Debian 12/13 或 Ubuntu 22.04/24.04，x86_64（amd64）或 ARM64，与安装包架构一致 |
| 运行时 | **Docker Engine + Compose 插件**。目标机 **不要** 装 Node、不要 `docker compose build` |
| 磁盘 | 系统盘建议 ≥ 80 GiB；镜像 + 数据卷另计。组合全开建议预留 ≥ 200 GiB |
| 内存 | **演示（空闲、几乎无用户）**见下表。生产/带摄像头与远程会话仍按组合加大 |
| CPU | 演示 4 核；生产组合 8 核起 |
| 网络 | SaaS：公网 IP + 域名。内网：固定 IP 或内网 DNS。断网：安装后可完全不出网 |
| 时间 | 必须 NTP；OIDC 对时钟敏感 |

架构必须匹配安装包：`linux-amd64` 与 `linux-arm64` **不能混用**（Apple 虚拟机多为 arm64，Hetzner / 多数机房为 amd64）。

空闲 RSS 不是镜像体积。控制面在实验室实测合计约 **400 MiB**。演示全开时最大头是 SyncroBrain 的 ThingsBoard（默认堆 `-Xms512M -Xmx1536M`，内存紧可改为 `256M/768M`）和 VistaCast **AI**（演示请 `ai=off`）。

| 形态 | 演示最低（几乎无用户） | 演示舒适 | 生产 / 有负载 |
|---|---|---|---|
| 只控制面 | 4 GiB / 2 核 / 40 GiB 盘 | 8 GiB / 2 核 | 8 GiB |
| 单产品 + 可选控制面 | 8 GiB / 2–4 核 / 80 GiB 盘 | 8–12 GiB | 8–16 GiB |
| `agent-commerce`（三产品 + 控制面） | 12 GiB / 4 核（ThingsBoard 降堆） | 16 GiB | ≥ 16 GiB |
| `smart-site` 六产品全开 | **12 GiB / 4 核 / 120 GiB 盘**（AI 关、无 TURN、ThingsBoard 降堆） | **16 GiB / 4–8 核** | ≥ 32 GiB（摄像头 + 远程会话 + 可能的 AI） |

12 GiB 全套演示不要开：VistaCast `ai`、VistaRemote `turn` profile、ThingsBoard 默认 1.5 GiB 堆、多路实时视频。留 2–4 GiB 给页缓存和突发。

Hosted SaaS 若启用对象存储，另计 **120 GiB** 对象数据卷硬预算（CDN **不**减少磁盘占用）。该卷与系统盘分开规划。见 §13。

---

## 4. 交付介质（客户拿到什么）

套件可以 **一次提供全部六个产品包 + 可选控制面包**。客户 **勾选要装哪些**，不是必须一次全开。

```text
luminaryworks-suite-<arch>-<version>/
  control-plane/     install.sh + 镜像   （可选）
  vistacast/         install.sh + 镜像   （可独立）
  syncrobrain/       install.sh + 镜像   （可独立）
  doerflow/          install.sh + 镜像   （可独立）
  vistaremote/       install.sh + 镜像   （可独立）
  dataluminary/      install.sh + 镜像   （可独立）
  blockyedu/         install.sh + 镜像   （可独立，组合里 optional）
  manifests/         standalone / agent-commerce / smart-site / air-gapped
  HANDBOOK.md        本手册
```

每份产品包都是：预构建镜像（`docker save`）+ 该产品自己的 Compose + `install.sh`。  
目标机只做：`docker load` → 填 env → `docker compose up -d --no-build --pull never`。

**对象存储不在离线包内。** AIStor Free **禁止**再分发二进制或许可证。控制面包可能附带 overlay YAML 与说明，但 **不会** `docker save` `quay.io/minio/aistor/*`，也 **不会**放入 `minio.license`。客户须自行下载并接受许可证，或提供自有 MinIO 兼容 endpoint。旧 `minio/minio` 社区版已停止维护，禁止使用。

**包从哪来：** 不要在客户服务器上拉仓编译。由供应商 / CI 在能出网的打包机执行：

```bash
# 发版机：拉最新仓并构建（六个独立 tar，不是一个巨型 compose）
node scripts/pack-release.mjs --target all --git-pull
```

`--git-pull` 只发生在打包机。客户拿到的 `MANIFEST.json` 里有当时的 git SHA，升级 = 换一份新包，不是在现场 `git pull`。

目标机 Docker：bootstrap 会先探测官方 Hub，被墙再用 `https://docker.m.daocloud.io`。已经用离线包 `docker load` 的机器不需要 Hub。

---

## 5. 公网 SaaS 部署

典型：Hetzner / 云厂商一台 Linux，前面加 TLS 反代（Caddy / Nginx）。产品 Compose **不负责 Let's Encrypt**。

### 5.1 准备

1. 购买 amd64 云主机，安全组先只放行 `22`。
2. 解析：`id.example.com`、`app.example.com` 等 A 记录到该 IP。
3. SSH 公钥登录；不要把口令写进仓库。
4. 安装 Docker（仅首次）：

```bash
# 用交付介质里的 bootstrap，或按 Docker 官方文档安装 Engine + Compose 插件
sudo bash remote-host-bootstrap.sh --user deploy
```

5. 把对应架构的套件 `scp` 到主机，解压。

### 5.2 只上一个产品（独立）

```bash
cd vistacast    # 例：只卖 VistaCast
sudo bash install.sh --public-host app.example.com --protocol https
```

该产品 env：

- `identity=external_oidc` 或接控制面 / 自带 local（按合同）
- `entitlement=offline_license` 或接中央 Entitlement
- `ai=off` 或 `local_byok`
- 业务库口令、JWT、摄像头/链上/TURN 等 **只写在该产品 env**，不要写进控制面 env

反代把 `https://app.example.com` 转到产品发布的本地端口（见 §9）。Compose 的 `BIND_ADDR` 建议 `127.0.0.1`，只让反代访问。

### 5.3 上统一登录（可选控制面）

```bash
cd control-plane
sudo bash install.sh --public-host id.example.com --protocol https
```

| 变量 | SaaS 建议 |
|---|---|
| `CONTROL_PLANE_BIND_ADDR` | `127.0.0.1`（前面 TLS 反代） |
| `CONTROL_PLANE_ADMIN_BIND_ADDR` | **必须** `127.0.0.1`，Admin 不对公网 |
| `IDENTITY_ENDPOINT` | `https://id.example.com`（浏览器能打开的 OIDC 根，无尾斜杠） |
| `AUTH_GATEWAY_PUBLIC_URL` | `https://auth.example.com` |
| `ENTITLEMENT_OIDC_ISSUER` | 与 JWT `iss` 完全一致，一般为 `{IDENTITY_ENDPOINT}/oidc` |
| `CONTROL_CONSOLE_PUBLIC_URL` | `https://console.example.com`（TLS 反代到 loopback `:3050`） |
| `ENTITLEMENT_CORS_ORIGINS` | 仅控制台 origin；生产留空则关闭浏览器 CORS |
| `CONTROL_CONSOLE_IDP_CLIENT_ID` | `identity/registered-apps.json` 里 Control Console 的公开 client id |

Logto Admin：`ssh -L 3002:127.0.0.1:3002 deploy@主机` 后打开 `http://127.0.0.1:3002`。  
业务 Control Console：**不是** Logto Admin。给操作员 Entitlement API 资源 `https://entitlement.luminaryworks.dev` 的 `entitlement:admin`，并在 Logto 为生产 hostname 追加 `/auth/callback`（apps.json 只列 localhost）。启用支付渠道：控制台里 Test 通过后再 enable，见 [`PAYMENTS.md`](PAYMENTS.md)。

产品 SPA 的 `VITE_IDP_ISSUER` / `IDP_ISSUER` 必须与 discovery 文档里的 `issuer` **逐字相同**。

### 5.4 组合（SaaS）

按顺序，**每个产品仍单独 up**：

```text
1. （可选）control-plane
2. VistaCast
3. SyncroBrain
4. DoerFlow
# 若还要 smart-site：
5. VistaRemote
6. DataLuminary
7. BlockyEdu（可跳过）
```

跨产品 Inbox 走 Docker 网络名 `luminary-control-edge`（如 `http://doerflow-api:13008/...`），**禁止** `host.docker.internal`。  
HMAC、M2M 密钥 **按产品复制**，见场景包 `peers.secrets.env`（不入库）。

---

## 6. 内网私有化（实体服务器 / 机房虚拟机）

与 SaaS 同一套 `install.sh`。常见差别：

| 项 | 内网实体机 |
|---|---|
| 访问地址 | `http://192.168.x.x` 或 `https://lw.corp.local`（公司 CA / 内网证书） |
| `BIND_ADDR` | 无反代时可 `0.0.0.0`；有内网反代则 `127.0.0.1` |
| 身份 | 客户 IdP：`identity=external_oidc`；或自带控制面 Identity |
| 权益 | `entitlement=offline_license`（推荐）或 `off` |
| 出网 | 安装后可不访问 Docker Hub / npm；镜像必须事先 `docker load` |
| Admin | 仍只绑 loopback，运维走跳板机 SSH 隧道 |

### 6.1 实体机检查清单

1. 确认 CPU 架构：`uname -m` → `x86_64` 用 amd64 包，`aarch64` 用 arm64 包。  
2. 固定管理网 IP，关掉会 DHCP 换地址的网卡（OIDC 回调绑死主机名/IP）。  
3. 磁盘分区：系统与 Docker 数据盘分开更稳（`/var/lib/docker`）。  
4. 防火墙默认拒绝，只放行：SSH、反代 443、以及你明确要暴露的产品端口。  
5. 数据库 **不要** 对宿主机映射生产端口（控制面默认不映射）。  
6. 每个产品自己的备份：`pg_dump` / 产品文档中的卷；**禁止**跨产品一个 dump。

### 6.2 断网机房

1. 在能出网的打包机生成套件（或向我们索取对应 arch 的 tar）。  
2. U 盘 / 内网文件柜拷到服务器。  
3. `docker load` 后 `install.sh`。  
4. 能力：`ai≠central`；`entitlement∈{off, offline_license}`；身份优先客户 IdP。

---

## 7. 账号与密钥（客户必须改）

### 7.1 两套账号，不要混

| 账号 | 配置 | 登录哪里 |
|---|---|---|
| Identity **控制台操作员** | `LW_LOGTO_ADMIN_USERNAME` / `LW_LOGTO_ADMIN_PASSWORD` | 仅 Admin `:3002`（隧道） |
| **平台用户**（超管、各产品管理员） | `LW_SUPER_ADMIN_*`、`LW_ADMIN_<产品>_*` | **各产品登录页** |

控制台操作员不是产品 `superadmin`。产品管理员进不了 Logto Console。

生产环境：

- 所有密码自行生成，**禁止**使用实验室串 `LuminaryDev!234`
- `ACCOUNTS.product.env` 或 CI Secrets 注入；留空 / `CHANGE_ME` 时初始化必须失败
- 控制面 `IDENTITY_DB_PASSWORD`、`ENTITLEMENT_*` 密钥由安装脚本生成后放入 **仅 root/deploy 可读** 的 env（模式 `600`）

平台用户变量（私有化 / SaaS 自建 Identity 时要填）：

| 变量 | 含义 |
|---|---|
| `LW_LOGTO_ADMIN_USERNAME` | Console 用户名 |
| `LW_LOGTO_ADMIN_PASSWORD` | Console 密码 |
| `LW_SUPER_ADMIN_EMAIL` / `_USERNAME` / `_PASSWORD` | 生态超管 |
| `LW_ADMIN_DATALUMINARY_*` | DataLuminary 管理员 |
| `LW_ADMIN_BLOCKYEDU_*` | BlockyEdu 管理员 |
| `LW_ADMIN_DOERFLOW_*` | DoerFlow 管理员 |
| `LW_ADMIN_VISTAREMOTE_*` | VistaRemote 管理员 |
| `LW_ADMIN_VISTACAST_*` | VistaCast 管理员 |
| `LW_ADMIN_SYNCROBRAIN_*` | SyncroBrain 管理员 |

独立部署且 `identity=external_oidc` 时：人在 **客户 IdP** 里建，不使用上表；产品只配 `IDP_ISSUER`。

### 7.2 控制面 env（若安装控制面）

必改 URL 见 §5.3。安装脚本会生成：

`IDENTITY_DB_PASSWORD`、`ENTITLEMENT_DB_PASSWORD`、`ENTITLEMENT_SERVICE_API_KEY`、`ENTITLEMENT_PARTNER_SECRET_PEPPER`、`ENTITLEMENT_PARTNER_TOKEN_SECRET`、`AI_VAULT_MASTER_KEY`（即使不上 AI 也需非空，否则 Compose 解析失败）。

已存在的 env **不会被覆盖口令**（避免把正在用的库锁死）。

---

## 8. 组合部署顺序与规则

### 8.1 agent-commerce

启动顺序（均为独立 project 名）：

1. `lw-control`（可选）  
2. `lw-vistacast`  
3. `lw-syncrobrain`  
4. `lw-doerflow`  

### 8.2 smart-site

**复用** 上面四个名字，不要再起一套库。然后：

5. `lw-vistaremote`  
6. `lw-dataluminary`（观察 / embed）  
7. `lw-blockyedu`（可选）

硬规则（合同级）：

- 远程控制必须人打开 deep link；API 不得代持 RTSP / MQTT / TURN 凭据  
- 回调不得自动 ack / 关单 / 设备 RPC  
- DataLuminary 不是 Safety Kernel，也不是账本权威  

跨产品 HTTP 状态：`401` 身份 · `402` 商业权益 · `403` Casbin。不要把 402 写成 403。

---

## 9. 浏览器端口（无统一域名时）

有反代时用域名；内网直连时用主机 IP + 端口：

| 入口 | 默认端口 |
|---|---|
| Identity OIDC | 3001 |
| Identity Admin（仅本机隧道） | 3002 |
| Auth Gateway | 3010 |
| Entitlement | 3040 |
| VistaCast API / Admin | 13100 / 13101 |
| SyncroBrain Gateway / Console | 13200 / 15180 |
| DoerFlow API / Web / Admin | 13008 / 5174 / 13011 |
| VistaRemote 会话 / Client / Admin | 3000 / 5173 / 5175 |
| DataLuminary DataView | 3003 |
| BlockyEdu LMS / Code | 18082 / 18081 |

安装后用产品自己的 `/ready`（或手册中的探针）验收。控制面：

```bash
curl -fsS https://id.example.com/oidc/.well-known/openid-configuration
curl -fsS https://auth.example.com/ready
curl -fsS https://entitlement.example.com/ready
```

内网把主机名换成 `http://<内网IP>:<端口>`。

---

## 10. 验收清单（客户签字用）

独立部署：

- [ ] 只启动了合同内的那一个产品；其它五个产品容器不存在也可以 `/ready` 为成功  
- [ ] 登录走约定 IdP；失败是 401，不是匿名放行  
- [ ] 该产品业务库在自己的卷里；未出现其它产品的库  

组合部署：

- [ ] 每个产品仍是独立 Compose project（`docker compose ls` 能看到多个名字）  
- [ ] 控制面与业务库没有装两份  
- [ ] 跨产品事件带 CloudEvents `id` / `source` / `type`；HMAC 按 peer 分开  
- [ ] VistaRemote 未自动开会话  

SaaS：

- [ ] 浏览器全程 HTTPS；Admin 未对公网开放  
- [ ] 证书由反代管理  
- [ ] 单 VPS 公网项按 [`HOSTED-SAAS.md`](HOSTED-SAAS.md) 勾完（支付回调、MinIO 水位、Doris Pilot、Trial 清理、N-1 回滚）  

私有化 / 断网：

- [ ] 安装过程未要求目标机访问 Docker Hub  
- [ ] `entitlement` 不是 `enforce` 却又没有中央 Entitlement（独立部署应用 `off` 或离线 License）  
- [ ] 备份按产品分别演练过 restore  

---

## 11. 常见问题

**Q. 能否一个 docker-compose.yml 起六个产品？**  
不能。组合 = 多个独立工程。套件介质可以一次给齐六个包，安装时勾选。

**Q. 内网没有域名怎么办？**  
用固定 IP，并把 `IDENTITY_ENDPOINT`、各产品 Public URL 写成 `http://IP:端口`。之后改域名等于改 issuer，需要显式迁移用户，不能靠邮箱静默合并。

**Q. 客户已有统一认证（OIDC/SAML）？**  
产品 `identity=external_oidc`，SAML 落在客户 IdP。不要给每个产品再装一套 Logto，除非合同就是买控制面。

**Q. 实体机是 Windows？**  
生产目标是 Linux + Docker。Windows 仅作运维终端（scp / 浏览器）。

**Q. 升级？**  
每个产品自己的镜像 tag / 迁移；不要六产品强制同一次发版。N-1 回滚按产品卷与库备份恢复。

---

## 12. 相关文件

| 文件 | 读者 |
|---|---|
| 本手册 | 客户、实施 |
| [`OPERATOR.md`](OPERATOR.md) | 实验室变量、示例口令（生产禁用） |
| [`README.md`](README.md) | 控制面 Compose 契约 |
| [`remote/README.md`](remote/README.md) | SSH / GitHub Actions |
| [`scenarios/agent-commerce/README.md`](scenarios/agent-commerce/README.md) | 组合编排细节 |
| [`scenarios/smart-site/README.md`](scenarios/smart-site/README.md) | 上层闭环 |
| [`HOSTED-SAAS.md`](HOSTED-SAAS.md) | 单 VPS 公网验收：TLS、支付回调、MinIO 水位、Doris Pilot、Trial 清理、回滚 |
| [`object-storage/README.md`](object-storage/README.md) | AIStor Free 对象存储、CDN、水位、迁移 |

---

## 13. 对象存储（Hosted SaaS · AIStor Free）

权威决策：[spec/decisions/2026-09-storage-doris-payment.md](../spec/decisions/2026-09-storage-doris-payment.md)。控制面 overlay 在本仓；产品仓用各自的 S3-compatible 适配器（不依赖未发布的 `@luminaryworks/object-storage`）。

- 官方镜像 `quay.io/minio/aistor/minio`，必须 **RELEASE 或 digest 固定**，禁止 `latest`，禁止旧 `minio/minio` CE。
- 单节点 standalone，许可证文件由运营方自行获取并 bind-mount；**无 HA / 无 SLA**。
- API 与 Console 默认只绑 `127.0.0.1`。产品走 Compose DNS `http://object-storage:9000`，各用各的 access key，**禁止**把 root 写进产品 env。
- 硬上限：各 bucket 的 AIStor `quota set --hard`，默认可配且合计 **≤ 120 GiB**（录像桶偏大）。配额命令失败则 bootstrap **失败**，不是警告。
- 宿主水位是第二道门（70/80/90%）。`df` 打在 Docker named volume 上时，常常量到的是 **整块 Docker 盘**，不是对象用量；不要把它当成配额。产品 `trial.purge` 仍是清理权威。
- 迁独立节点：停写 → 校验复制（checksum copy）→ 切换 endpoint → 回滚窗口。Free 档没有站点复制。

启用前：

```bash
node scripts/preflight-object-storage.mjs
```

缺许可证、未固定镜像、缺 root 或产品密钥时，预检与 Compose 会明确失败。机器可读水位：`node scripts/object-storage-status.mjs`。CDN / Caddy 示例见 [`object-storage/Caddyfile.example`](object-storage/Caddyfile.example)。
