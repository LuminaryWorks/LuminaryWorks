# LuminaryWorks 实验室操作笔记

**客户实施请先读 [`HANDBOOK.md`](HANDBOOK.md)。** 六个产品均可独立部署，也可按场景组合；套件介质一次可提供六份产品包 + 可选控制面包，由客户勾选。不要把六个 Compose 合成一个 project。

本文只记实验室打包命令、UTM 验证和 **示例口令**（生产禁用）。

规范：[`spec/composable-deployment.md`](../spec/composable-deployment.md)。Compose 契约：[`README.md`](README.md)。SSH / CI：[`remote/README.md`](remote/README.md)。公网单 VPS 验收：[`HOSTED-SAAS.md`](HOSTED-SAAS.md)。

## 1. 实验室交付物

| 包 | 含义 |
|---|---|
| 每个产品一份离线包 | 可只装这一个产品 |
| `control-plane` 离线包 | 可选 Identity + Gateway + Entitlement |
| 场景 | `agent-commerce` / `smart-site` = 多个独立 Compose 按顺序 `up` |

架构：UTM / Apple Silicon 用 **linux/arm64**；Hetzner / 多数机房用 **linux/amd64**。两套包不要混用。

## 2. 本机 / CI 打包（拉最新仓，不要在客户机上 build）

**每次发版**在能出网的打包机或 GitHub Actions 上：`git pull` 六个产品仓 + 本仓 → `docker compose build` → `docker save`。  
客户内网机只 `docker load`，**不要**在目标机 `git pull` / `pnpm install` / `docker compose build`。

```bash
# 控制面
node scripts/pack-release.mjs --target control-plane --git-pull

# 某一个产品（独立包）
node scripts/pack-release.mjs --target doerflow --git-pull

# 六个产品各打一份（不合成一个 compose）
node scripts/pack-release.mjs --target products --git-pull

# 控制面 + 六个产品
node scripts/pack-release.mjs --target all --git-pull --platform linux/amd64

# 只看会打哪些 compose，不 build
node scripts/pack-release.mjs --target products --dry-run
```

`--git-pull` 是 `git pull --ff-only`。工作区不干净会失败，这是故意的（打包要可复现 SHA，写进 `MANIFEST.json`）。

Docker Hub：打包时先 `docker pull` 官方名；失败再走 `docker.m.daocloud.io` 并 tag 回原名。不要默认改本机 daemon。

国内 npm 构建 Entitlement：

```bash
export NPM_REGISTRY=https://registry.npmmirror.com
```

## 3. 目标机只安装一次 Docker

库存 Debian（无 sudo）先用 root：

```bash
scp scripts/remote-host-bootstrap.sh USER@HOST:/tmp/lw-bootstrap.sh
ssh USER@HOST 'su -c "bash /tmp/lw-bootstrap.sh --user USER"'
```

已有 Docker 可跳过。Bootstrap **默认先探测官方 Docker Hub**（`registry-1.docker.io` 返回 200/401 即视为通）；不通（大陆常见）再写 `docker.m.daocloud.io`。离线安装包路径不依赖 Hub。

```bash
sudo bash scripts/remote-host-bootstrap.sh --user andy                  # auto
sudo bash scripts/remote-host-bootstrap.sh --user andy --registry-mirror none
```

## 4. 把包装到 Linux

```bash
# 从笔记本一键（推荐）
node scripts/remote-deploy.mjs \
  --host 192.168.64.3 \
  --user andy \
  --key ~/.ssh/id_ed25519_lw_lab \
  --pack dist/packs/luminaryworks-control-plane-linux-arm64-<gitsha>.tar \
  --public-host 192.168.64.3

# 或手工
scp luminaryworks-control-plane-*.tar andy@HOST:~/
ssh andy@HOST 'tar -xf luminaryworks-control-plane-*.tar && cd luminaryworks-control-plane-* && bash install.sh --public-host 192.168.64.3'
```

`install.sh` 会：

1. `docker load` 镜像
2. 若不存在则生成 `deploy/env/control-plane.env`（数据库口令、服务密钥随机；**已有文件不改密**）
3. `docker compose up -d --no-build --pull never`

## 5. 控制面变量（`deploy/env/control-plane.env`）

真实文件 gitignore，只提交 [`env/control-plane.env.example`](env/control-plane.env.example)。

### 5.1 绑定与 URL（必须改成这台机器）

| 变量 | 实验室（UTM） | 公网 SaaS |
|---|---|---|
| `CONTROL_PLANE_BIND_ADDR` | `0.0.0.0` | 反代后面可用 `127.0.0.1` |
| `CONTROL_PLANE_ADMIN_BIND_ADDR` | 固定 `127.0.0.1` | 同左（Admin 不要对公网） |
| `IDENTITY_ENDPOINT` | `http://192.168.64.3:3001` | `https://id.example.com` |
| `IDENTITY_ADMIN_ENDPOINT` | `http://127.0.0.1:3002` | 同左 + SSH/VPN |
| `AUTH_GATEWAY_PUBLIC_URL` | `http://192.168.64.3:3010` | `https://auth.example.com` |
| `ENTITLEMENT_OIDC_ISSUER` | `{IDENTITY_ENDPOINT}/oidc` | 与 JWT `iss` 一致 |
| `AUTH_GATEWAY_UPSTREAM_ISSUER` | `http://identity:3001/oidc` | Compose DNS，不要写成宿主机 IP |

SPA 的 `VITE_IDP_ISSUER` / `IDP_ISSUER` 必须与 discovery 里的 `issuer` **字符串完全一致**（不要混用 `localhost` 与 `127.0.0.1`）。

### 5.2 安装脚本会生成的密钥（不要用弱口令）

| 变量 | 用途 |
|---|---|
| `IDENTITY_DB_PASSWORD` | Logto PostgreSQL |
| `ENTITLEMENT_DB_PASSWORD` | Entitlement PostgreSQL |
| `ENTITLEMENT_SERVICE_API_KEY` | 产品适配器调用 Entitlement |
| `ENTITLEMENT_PARTNER_SECRET_PEPPER` | Partner HMAC 胡椒 |
| `ENTITLEMENT_PARTNER_TOKEN_SECRET` | Partner token |
| `PAYMENT_CONFIG_MASTER_KEY` | Entitlement 支付渠道凭证信封密钥（32 字节 hex/base64；生产在启用 provider 配置时必填） |
| `AI_VAULT_MASTER_KEY` | 仅 `ai` profile；compose 解析仍需要非空 |

生成：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 5.3 镜像名（包内已 save 的 tag）

`POSTGRES_IMAGE=postgres:16-alpine` · `REDIS_IMAGE=redis:7-alpine` · `IDENTITY_IMAGE=svhd/logto:latest` · `AUTH_GATEWAY_IMAGE=luminaryworks/auth-gateway:local` · `ENTITLEMENT_IMAGE=luminaryworks/entitlement:local`

生产不要长期用 `latest`；preflight 在 `pilot`/`production` 会拒绝浮动 tag。

## 6. 三套入口（不要混用）

| 谁 | 配置文件 | 登录入口 | 实验室默认（必须改密后才能上生产） |
|---|---|---|---|
| **Logto Admin Console 操作员** | `identity/.env` 的 `LW_LOGTO_ADMIN_*` | SSH 隧道后 `http://127.0.0.1:3002` | 用户名 `logto_admin` / 密码 `LuminaryDev!234` |
| **业务 Control Console 超管** | `CONTROL_CONSOLE_IDP_CLIENT_ID` + Logto 中 `entitlement:admin` | 控制面 `:3050`（或公网 hostname + TLS） | 用生态超管账号登录；**不是** :3002 |
| **生态超管 + 六产品管理员 + 试用用户** | `identity/ACCOUNTS.dev.env`（dev）或 `ACCOUNTS.product.env` / `LW_*` | **各产品登录页**，不是 :3002 | 见下表 |

Logto Admin **不会**自动变成 Entitlement 超管。Control Console **不能**替代 Logto Admin（用户/应用/连接器仍在 :3002）。

渠道启用：Control Console → Payment providers → 写入凭证（成功后文本框清空）→ Test → 输入 `ENABLE` 才 enable。控制台不臆造 enabled / HA。

模板（可入库）：

- [`identity/.env.example`](../identity/.env.example)
- [`identity/ACCOUNTS.dev.env.example`](../identity/ACCOUNTS.dev.env.example)
- [`identity/ACCOUNTS.product.env.example`](../identity/ACCOUNTS.product.env.example)

真实 `ACCOUNTS.*.env`、`identity/.env` **不要提交**。

### 6.1 Logto Console 操作员

```bash
# identity/.env（或安装后注入同名环境变量）
LW_LOGTO_ADMIN_USERNAME=logto_admin
LW_LOGTO_ADMIN_PASSWORD="LuminaryDev!234"   # 实验室；生产必须换成强密码
LW_LOGTO_ADMIN_EMAIL=logto.admin@luminaryworks.local
# LW_LOGTO_ADMIN_RESET_PASSWORD=1          # 已存在用户时强制改密
```

打开控制台（本机 **3002 必须空闲**，与 `ADMIN_ENDPOINT=http://127.0.0.1:3002` 一致。不要把隧道接到 13002 之类的端口，Logto 会 `oidc.invalid_client`）：

```bash
ssh -i ~/.ssh/id_ed25519_lw_lab -L 3002:127.0.0.1:3002 andy@192.168.64.3
# 浏览器：http://127.0.0.1:3002
```

首次控制面 `compose up` **不会**自动创建 Console 操作员。离线包装完后在笔记本执行（会在 **Identity 容器内**调 Admin API，不占用本机 3002）：

```bash
node scripts/remote-deploy.mjs \
  --host 192.168.64.3 --user andy --key ~/.ssh/id_ed25519_lw_lab \
  --skip-bootstrap --skip-sync --skip-up --skip-probe --init-identity
```

这会：创建 `logto_admin`、写入默认租户 Management M2M、`register-apps`、按 `ACCOUNTS.dev.env` seed 平台用户。产物在 gitignore 的 `dist/identity-lab/`（不要提交）。本机已有 Logto 占用 3001/3002 时也可以跑，因为 seed 走 `http://192.168.64.3:3001`。

缺 `LW_LOGTO_ADMIN_PASSWORD` 或仍是 `CHANGE_ME` 时脚本会直接失败（没有 Welcome 页手建兜底）。

### 6.2 平台用户（产品登录）— 实验室 dev 表

`IDENTITY_ACCOUNTS_PROFILE=dev` 时 seed 下列账号。实验室模板密码均为 **`LuminaryDev!234`**。生产 profile（`product`）密码必须全部自填，留空会失败。

| 角色 | 用户名 | 邮箱（dev 模板） |
|---|---|---|
| 生态超管 | `superadmin` | `superadmin@luminaryworks.local` |
| DataLuminary 管理员 | `admin_dataluminary` | `admin.dataluminary@luminaryworks.local` |
| BlockyEdu 管理员 | `admin_blockyedu` | `admin.blockyedu@luminaryworks.local` |
| DoerFlow 管理员 | `admin_doerflow` | `admin.doerflow@luminaryworks.local` |
| VistaRemote 管理员 | `admin_vistaremote` | `admin.vistaremote@luminaryworks.local` |
| VistaCast 管理员 | `admin_vistacast` | `admin.vistacast@luminaryworks.local` |
| SyncroBrain 管理员 | `admin_syncrobrain` | `admin.syncrobrain@luminaryworks.local` |
| 普通用户 user01–user10 | `user01` … `user10` | `user01@luminaryworks.local` …（仅 **dev**） |

对应环境变量：`LW_SUPER_ADMIN_PASSWORD`、`LW_ADMIN_DATALUMINARY_PASSWORD`、…、`LW_USER_01_PASSWORD`。

你本机若已有 `identity/ACCOUNTS.dev.env`，以该文件为准（可能域名是 `luminaryworks.dev` 而不是 `.local`）。UTM 验证 seed 用的是 `.dev` 邮箱。

## 7. 控制面端口与探针

| 服务 | 宿主机端口 | 探针 |
|---|---|---|
| Identity OIDC | 3001 | `GET /oidc/.well-known/openid-configuration` |
| Identity Admin | 3002（仅 127.0.0.1） | Console UI |
| Auth Gateway | 3010 | `/health` `/ready` `/version` |
| Entitlement | 3040 | `/health` `/ready` `/version` |

实验室（UTM `192.168.64.3`）从笔记本：

```bash
curl -sS http://192.168.64.3:3001/oidc/.well-known/openid-configuration | head
curl -sS http://192.168.64.3:3010/ready
curl -sS http://192.168.64.3:3040/ready
```

## 8. 产品栈端口（叠加时，各仓自己的 compose）

容器之间走 `luminary-control-edge` DNS，浏览器走宿主机端口：

| 产品 | 典型入口 | 实验室管理员账号 |
|---|---|---|
| DataLuminary DataView | `http://HOST:3003/#/login` | `admin_dataluminary` |
| BlockyEdu LMS | `http://HOST:18082/login` | `admin_blockyedu` |
| BlockyEdu Code | `http://HOST:18081/login` | `admin_blockyedu` |
| DoerFlow Web | `http://HOST:5174/login` | `admin_doerflow` |
| DoerFlow Admin | `http://HOST:13011/login` | `admin_doerflow` |
| VistaCast Admin | `http://HOST:13101/login` | `admin_vistacast` |
| VistaRemote Client | `http://HOST:5173/login` | `admin_vistaremote` |
| VistaRemote Admin | `http://HOST:5175/login` | `admin_vistaremote` |
| VistaRemote 会话 | `http://HOST:3000/intervention/:token` | 人工打开 deep link |
| SyncroBrain Console | `http://HOST:15180/login` | `admin_syncrobrain` |
| DoerFlow API | `http://HOST:13008` | M2M，不是人密 |
| VistaCast API | `http://HOST:13100` | — |
| SyncroBrain Gateway | `http://HOST:13200` | — |

产品 **不要** 共用一个 `.env`。HMAC / M2M secret 按产品复制，见 [`scenarios/agent-commerce/README.md`](scenarios/agent-commerce/README.md)。

## 9. GitHub Actions

Workflow：`.github/workflows/deploy-remote.yml`。Secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`。

账号类 Secrets（Identity seed，**不要**写进仓库）：

- `LW_LOGTO_ADMIN_PASSWORD`
- `LW_SUPER_ADMIN_PASSWORD`
- `LW_ADMIN_DATALUMINARY_PASSWORD` … 六个产品管理员
- 生产不要使用 `LuminaryDev!234`

`ubuntu-latest` 访问不到 UTM 局域网；内网用笔记本 SSH 或 self-hosted runner。

## 10. 诚实边界

- `ai=central` 仅 lab，禁止写进 pilot/production manifest
- 六产品同机全栈、备份恢复、N-1 属于规格 §11.3，不是实验室关门条件
- 客户合同见 [`HANDBOOK.md`](HANDBOOK.md)：每产品一份包，可独立安装，组合时按场景顺序 `up` 多个 project

## 11. 对象存储（实验室 · 不要打进离线包）

规范：[spec/decisions/2026-09-storage-doris-payment.md](../spec/decisions/2026-09-storage-doris-payment.md)。操作说明：[`object-storage/README.md`](object-storage/README.md)。

实验室 **默认不上** `--profile object-storage`。没有 MinIO 签发的 AIStor Free 许可证时，**不要**编造许可证，也 **不要** `docker pull` 官方镜像来“试试看”。

```bash
# 静态预检（不启动容器）
node scripts/preflight-object-storage.mjs --env-file deploy/env/control-plane.env

# 水位 JSON（不访问 Docker socket、不进应用容器）
node scripts/object-storage-status.mjs --used-bytes 0
```

`pack-release.mjs` **不会**把 `quay.io/minio/aistor/minio` 打进 tar。`OBJECT_STORAGE_ENABLED=1` 时若缺 `AISTOR_LICENSE_FILE` / **已在 Quay 核对过的**镜像 pin / root / 产品密钥，远程部署预检会失败。

镜像：在 [Quay tags](https://quay.io/repository/minio/aistor/minio?tab=tags) 自行确认后写入 `AISTOR_MINIO_IMAGE` / `AISTOR_MC_IMAGE`。示例文件里的 `REPLACE_WITH_CONFIRMED_QUAY_RELEASE_OR_DIGEST` **会让预检失败**，这是故意的。本仓库 **不提供**已验证的 RELEASE 标签。禁止 `latest`。

## 12. 实验室验证记录（UTM `192.168.64.3`，arm64）

把这台 VM 当作 **内网私有化目标机**（固定局域网 IP、无公网域名、无 TLS 反代）对照 [`HANDBOOK.md`](HANDBOOK.md) §6 / §10。

### 已通过：控制面私有化路径

- 架构 `aarch64`，离线包 `linux-arm64`；目标机 **无 Node**
- NTP 已同步
- `CONTROL_PLANE_BIND_ADDR=0.0.0.0`，OIDC issuer = `http://192.168.64.3:3001/oidc`（内网 IP，无公网 DNS）
- Admin 仅 `127.0.0.1:3002`：从笔记本访问 `:3002` **连不上**
- Identity / Entitlement Postgres、Redis **未映射**到局域网（`5432`/`6379` 不可达）
- 唯一 Compose 工程：`luminary-control-plane`（没有六产品合成一个 project）
- `docker compose up -d --no-build --pull never` 可重复执行，探针仍 200
- Identity 已 seed：Console `logto_admin` + 17 个平台用户

### 断网 / 镜像源（诚实）

- 直连 `registry-1.docker.io` 超时；daemon 配了 `https://docker.m.daocloud.io`，所以 **小镜像仍可能被 pull**（实验室不是物理断网）
- 客户断网机房：不要配 registry mirror，只 `docker load` 安装包
- `pack-release.mjs` 现在可以按产品打独立离线包（`--target doerflow` / `products` / `all`）。真正 `docker save` 要在打包机执行 `--git-pull` 后 build；本 VM 内存不够一次打齐六个产品。

### 未在此 VM 上 `up` 的部分

- 独立产品 / `agent-commerce` / `smart-site`：需要各产品离线包。`scenario-up --dry-run` 已确认会起 **三个独立 project 名**（`lw-vistacast` → `lw-syncrobrain` → `lw-doerflow`），不会合并 compose
- 本机 Docker 占用 3002，未在浏览器点 Console 登录（停本机 Logto 后按 §6.1 隧道）
- GitHub Actions `ubuntu-latest` 访问不到该局域网
- 此 VM 约 10 GiB 内存，HANDBOOK 写 `agent-commerce` 建议 ≥ 16 GiB，全组合不宜在这台机器上硬开
