# LuminaryWorks 实验室操作笔记

**客户实施请先读 [`HANDBOOK.md`](HANDBOOK.md) §4。** 六个产品均可独立部署，也可按场景组合。不要把六个 Compose 合成一个 project。

两条打包命令 **不要混用**：

| 命令 | 产物 | 目标机 |
|---|---|---|
| `pnpm pack:luminaryworks` | **一份**源码 kit → `dist/kits/` | 已有 Docker、能出网；现场 **build** |
| `pnpm pack:all` | 控制面 + 六个产品 **各一份**离线 tar → `dist/packs/` | `docker load`，**禁止**现场 build |

`pack:hk-test` = `pack:luminaryworks`。`pack:control-plane` / `pack:products` 是 `pack:all` 的子集。对照表：[`README.md`](README.md)「Two pack commands」。首次安装：[`luminaryworks-install/README.md`](luminaryworks-install/README.md)。

本文只记实验室打包命令、UTM 验证和 **示例口令**（生产禁用）。

规范：[`spec/composable-deployment.md`](../spec/composable-deployment.md)。Compose 契约：[`README.md`](README.md)。SSH / CI：[`remote/README.md`](remote/README.md)。公网单 VPS 验收：[`HOSTED-SAAS.md`](HOSTED-SAAS.md)。站点勾选（无密钥）：[`site.example.json`](site.example.json)。

**香港 / 有网测试机（源码 kit，主机已有 Docker）：**

```bash
pnpm pack:luminaryworks
# 拷 dist/kits/luminaryworks-install-linux-amd64-<sha>.tar 到主机后：
sudo bash install.sh
```

**个人 OVH（离线控制面包，0 GitHub 分钟，VPS 不编译）：**

```bash
node scripts/pack-release.mjs --target control-plane --platform linux/amd64
node scripts/remote-deploy.mjs \
  --host <OVH_IPv4> --user debian --key ~/.ssh/id_ed25519_lw_ovh \
  --pack dist/packs/luminaryworks-control-plane-linux-amd64-<sha>.tar
```

笔记本编排用 **Node**（`pack-release.mjs` / `remote-deploy.mjs`），目标机安装用包内 **bash** `install.sh`。不要用 GitHub `ubuntu-latest` 去远端 `compose build`。

## 1. 实验室交付物

| 包 | 命令 | 含义 |
|---|---|---|
| 首次安装源码 kit | `pnpm pack:luminaryworks` | 控制面 + 六个产品树，**无镜像 tar**；`site.json` 勾选 |
| 每个产品一份离线包 | `pnpm pack:products` 或 `--target doerflow` | 可只装这一个产品；内含 `docker save` |
| `control-plane` 离线包 | `pnpm pack:control-plane` | 可选 Identity + Gateway + Entitlement |
| 控制面 + 六产品离线套件 | `pnpm pack:all` | 上面离线包打齐，**仍是多份 tar**，不是一份巨型 compose |
| 场景 | `agent-commerce` / `smart-site` | 多个独立 Compose 按顺序 `up` |

架构：UTM / Apple Silicon 用 **linux/arm64**；Hetzner / 多数机房用 **linux/amd64**。两套包不要混用。源码 kit 当前按 **linux/amd64** 打（与香港 / OVH 测试机一致）。

## 2. 本机 / CI 打包

### 2.1 首次安装源码 kit（`pack:luminaryworks`）

不 `docker save`。打包机拷源码；目标机必须已有 Docker，会 pull + `compose build`。

```bash
pnpm pack:luminaryworks
# 产物：dist/kits/luminaryworks-install-linux-amd64-<sha>.tar
```

### 2.2 断网离线镜像包（`pack:all`）

**每次发版**在能出网的打包机或 GitHub Actions 上：`git pull` 六个产品仓 + 本仓 → `docker compose build` → `docker save`。  
客户内网机只 `docker load`，**不要**在目标机 `git pull` / `pnpm install` / `docker compose build`。

```bash
# 控制面
pnpm pack:control-plane -- --git-pull
# 等价：node scripts/pack-release.mjs --target control-plane --git-pull

# 某一个产品（独立包）
node scripts/pack-release.mjs --target doerflow --git-pull

# 六个产品各打一份（不合成一个 compose）
pnpm pack:products -- --git-pull

# 控制面 + 六个产品（= pack:all）
pnpm pack:all -- --git-pull --platform linux/amd64

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
| `CONTROL_PLANE_DB_ADMIN_PASSWORD` | 共享 Postgres 管理员（仅 bootstrap / 运维；应用勿用） |
| `IDENTITY_DB_PASSWORD` | Logto 逻辑库角色 |
| `ENTITLEMENT_DB_PASSWORD` | Entitlement 逻辑库角色 |
| `NOTIFICATION_DB_PASSWORD` | Notification 逻辑库角色 |
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

`POSTGRES_IMAGE=postgres:16-alpine` · `REDIS_IMAGE=redis:7-alpine` · `IDENTITY_IMAGE=luminaryworks/identity:1.42.0-lw1`（官方 `svhd/logto:1.42.0` 的品牌 overlay，打包机本地构建） · `AUTH_GATEWAY_IMAGE=luminaryworks/auth-gateway:local` · `ENTITLEMENT_IMAGE=luminaryworks/entitlement:local`

生产不要长期用 `latest`；preflight 在 `pilot`/`production` 会拒绝浮动 tag。

### 5.4 控制面 Postgres：一实例多库

**前期原则（单机共用）**：平台后台（Identity / Entitlement / Notification / AI Platform）共用 **一个** Compose 工程 `luminary-works`、**一个** Postgres 容器、**一个** Redis 容器；逻辑库与角色隔离。产品业务库（DataLuminary、BlockyEdu、VistaCast、VistaRemote 等）不并入。量上来再拆实例或改 `CONTROL_PLANE_PROJECT` / 连接串。改工程名前先备份（§5.8）。

控制面 Compose 工程默认名 **`luminary-works`**（`CONTROL_PLANE_PROJECT`）。单一服务 `control-plane-db`（固定卷名 `luminary_works_pg`，compose key 仍叫 `control-plane-db-data`）。平台 Redis 服务名 `identity-redis`（前期共用）。首次**空** volume 启动时，[`compose/init/control-plane-db.sh`](compose/init/control-plane-db.sh) 创建四个逻辑库与角色：`logto`、`entitlement`、`notification`、`ai_platform`。Compose 内应用连接串 host 为 `control-plane-db`；本机 `pnpm ent:dev` / notification `start:dev` 用 env 连 `127.0.0.1:5433`（见各服务 `env.example`）。

`services/entitlement` / `services/notification` **不再**提供独立 `docker-compose.yml`。本地只起共享库：`pnpm ent:up`（=`node scripts/control-plane-db.mjs up`）。

**已有 volume（本地 lab / OVH）不会重跑 init。** 升级到含 AI Platform 的版本时必须二选一：

1. **保留数据（推荐生产）**：填好 `AI_PLATFORM_DB_PASSWORD`（与 `deploy/env/control-plane.env` 一致）后执行幂等脚本 [`compose/init/add-ai-platform-db.sh`](compose/init/add-ai-platform-db.sh)：

   ```bash
   # 控制面栈已 up 时：
   set -a && source deploy/env/control-plane.env && set +a
   docker compose -p luminary-works -f deploy/compose/control-plane.yaml \
     exec -T control-plane-db env AI_PLATFORM_DB_PASSWORD="$AI_PLATFORM_DB_PASSWORD" \
     sh < deploy/compose/init/add-ai-platform-db.sh
   ```

   OVH 发版窗口：先 `git pull` 新 compose/env → 填 `AI_PLATFORM_DB_*` / vault / service key → 跑上面脚本 → 再 `--profile ai` 起 `ai-platform`。**不要**为了省事删生产 PG volume。

2. **Lab 可重建**：停栈 → 删卷 `luminary_works_pg` → 再起，空库会跑完整 init（含 `ai_platform`）。

本地调试端口见 `control-plane.dev-ports.yaml`：`CONTROL_PLANE_DB_PORT`（默认 `5433`）一份端口即可，用 `dbname=` 区分库。这张 overlay 还会把 `control-plane-db` 接到非 internal 的 `control-edge`，否则只在 internal 网络上的容器发不出宿主机端口。生产不要加这张 overlay。产品库（DataLuminary、BlockyEdu、VistaCast、VistaRemote）继续各自独立，不要并进这只 Postgres。

已有分散实例并到这只库的步骤、拆库条件和每晚备份见下文 §5.5–§5.8。**不要删除仍有数据的 volume**（包括生产）。Lab 想从空库重来，也只在确认 dump 已校验、并且那只 volume 可以丢弃时才删。

### 5.5 合并已有分散 PG 到 control-plane-db

把 Identity / Notification / 临时挂在 `control-plane-db-data` 上的 Entitlement 收到 **一个** `control-plane-db`。每个服务仍是自己的 database + role，只是不再各起一台 Postgres。

**前提**

- 磁盘空闲大于 dump 的两倍。dump 含用户与邮件，目录权限 `0700`，不要提交（`.db-backups/` 已 gitignore）。
- `deploy/env/control-plane.env` 里四个角色口令就是目标库里的口令。`pg_restore` 不会改 role 密码。
- 目标 volume 上如果已经有 `entitlement` 数据（临时容器挂的就是 `control-plane-db-data`），只备份它，**不要**再 restore 回去。
- 先停写：停 Identity、Entitlement、Notification、AI Platform 的**应用**容器或宿主进程。数据库容器留到 dump 完成。

**停写 → dump → restore → 改连接串**

在有 Node 的机器上（笔记本，或装了 Node 24 的主机）：

```bash
node scripts/db-consolidate.mjs plan
node scripts/db-consolidate.mjs backup
# 备份目录会打印出来：.db-backups/<timestamp>/
# 确认 manifest.json 里 logto / notification 的 rows 不是意外的 0，再继续。

# 若有容器占用目标 volume（本机曾是 luminary-entitlement-db），先停它，不要 rm -v：
docker stop luminary-entitlement-db

# 只起数据库。生产不要加 dev-ports。
docker compose --env-file deploy/env/control-plane.env \
  -f deploy/compose/control-plane.yaml up -d --no-deps control-plane-db

node scripts/db-consolidate.mjs restore --backup .db-backups/<timestamp>
node scripts/db-consolidate.mjs verify --backup .db-backups/<timestamp>
```

`restore` 发现目标库已有用户表会直接拒绝，除非显式 `--force`（会 `DROP SCHEMA public`）。行数已经和 dump 一致时会跳过灌入，只补 owner。同一 volume 上的 entitlement dump 会被跳过。Logto 的租户角色（`logto_tenant_*`）不在单库 dump 里，脚本另存 `logto-globals.sql` 并在目标上创建这些角色、授予 `CONNECT` 和表权限。不要把 `logto` 主角色的口令改成旧库的口令。

校验通过之后才停旧库容器（`docker stop`，不要 `docker rm -v`，不要 `compose down -v`）：

```bash
docker stop luminary-identity-db luminary-notification-db
```

然后把应用连接串改到这只库：

- Compose 内：host 已经是 `control-plane-db:5432`，库名 `logto` / `entitlement` / `notification` / `ai_platform`。
- 宿主进程：`127.0.0.1:5433` 只在叠了 `control-plane.dev-ports.yaml` 时存在。生产不要发布 5432。
- 本机若 `luminary-identity-db` 占着 5433：先完成上面的 backup + restore + verify，再 `docker stop` 旧容器，然后带 dev-ports 把 `control-plane-db` 绑到 `127.0.0.1:5433`。

没有 Node 的主机用 `deploy/scripts/pg-backup.sh` 做逻辑备份（见 §5.8），恢复仍可用容器内 `pg_restore`。

**回滚**

1. 停应用写入。
2. 把 `DB_URL` / `*_DATABASE_URL` 指回旧容器（旧容器还在，只是 stop 过；`docker start` 即可）。旧 volume 没有被删。
3. 若 restore 把目标里的 `logto` 或 `notification` 灌坏了：那两个库在灌入前是空的，可以连上 `control-plane-db` 后 `DROP SCHEMA public CASCADE` 再从 `.db-backups/<timestamp>/` 重放。`entitlement` 没有被 restore 覆盖；它的 dump 在同一目录，仅当确认坏了才用 `--force` 灌回。
4. **不要**用删 volume 当回滚。删了就没有第二份数据。

### 5.6 何时拆库

早期一台 24 GB 机器上，四套库共享一只 Postgres。出现下面任一情况再把**其中一个** database 拆到新实例（不是现在）：

| 信号 | 阈值 |
|---|---|
| 连接 | `max_connections` 的 70% 以上持续占用（当前上限 100，即大约 70 条） |
| CPU | Postgres 进程持续吃满一颗核，或主机 load 在业务高峰下持续顶满 |
| 体积 | 单个 database 超过 20 GB，或这只 volume 超过数据盘的一半 |
| 吵闹邻居 | `log_min_duration_statement`（500ms）里某一个库的慢查询、锁等待明显拖垮另外三个库 |

拆的时候 **schema 不用改**。每个服务本来就是自己的 database 和 role：

1. 对新实例建同一个 role / database（口令可轮换）。
2. `pg_dump -Fc` 那个库，在新实例 `pg_restore`，改 owner。
3. 只改这一个服务的 `DATABASE_URL` 或 `DB_URL` 的 host。其余服务仍指向 `control-plane-db`。
4. 校验行数后再停旧库上的连接。旧 volume 保留到观察期结束，不在拆库当天删除。

### 5.7 24 GB 内存预算

OVH 早期整机 24 GB。下面是预算，不是把每个数字都写成 cgroup（没写「已落地」的，compose 里还没有 `mem_limit`）。

| 组件 | 预算 | compose |
|---|---|---|
| `control-plane-db` | 2g | `mem_limit: 2g`，`mem_reservation: 512m`，参数见 §5.4 与 compose 注释 |
| Identity（Logto） | 1.5g | `mem_limit: 1536m` |
| Entitlement | 0.75g | `mem_limit: 768m` |
| Auth Gateway | 256m | `mem_limit: 256m` |
| Notification | 256m | `mem_limit: 256m` |
| Control Console | 256m | `mem_limit: 256m` |
| Identity Redis | 256m | 预算，compose 未设 limit |
| AI Platform（lab profile） | 1g | 预算。早期走云端模型，不要在这台机器上加 Ollama |
| 对象存储（可选） | 1.5g | overlay 已有 `1536m` |
| Doris（试点，产品仓） | 6g | 上限。不在本 compose 里，不开试点就不占 |
| 系统与余量 | 约 10g | 24 − 上表约 14 |

`shared_buffers` 取 2g 限额的四分之一，而不是 24 GB 的四分之一：cgroup 把 shared_buffers 和 page cache 算在同一个 2g 里。`effective_cache_size=1536MB` 只给规划器看，把它写成十几 GB 会让规划器以为数据都在缓存里。

### 5.8 每晚备份与恢复演练

每库一个 `pg_dump -Fc`，默认保留 14 天（`PG_BACKUP_RETENTION_DAYS`）。只清理 `.db-backups/nightly/`，不会动手工 consolidate 目录，也不会删 volume。

对象存储上传是可选的。同时设置了 `PG_BACKUP_S3_ENDPOINT`、`AISTOR_BACKUP_ACCESS_KEY`、`AISTOR_BACKUP_SECRET_KEY` 且主机有 `mc` 时，才会拷到 `backup-staging`（可用 `PG_BACKUP_S3_BUCKET` 改名）。没配就跳过，备份仍然成功。也可以设 `PG_BACKUP_UPLOAD_COMMAND`，脚本会带上 `PG_BACKUP_DIR` 执行，不会把口令打到日志里。

有 Node 24：

```bash
node scripts/pg-backup.mjs
node scripts/pg-restore-drill.mjs
```

没有 Node 的主机（离线包常见）用：

```bash
bash deploy/scripts/pg-backup.sh
bash deploy/scripts/pg-restore-drill.sh
```

演练会在 `control-plane-db` 里建 `zz_drill_*` 库，对一下行数，然后只删除这些演练库。

cron（主机时间 03:10）：

```cron
10 3 * * * cd /opt/luminaryworks && bash deploy/scripts/pg-backup.sh >> /var/log/lw-pg-backup.log 2>&1
```

systemd：

```ini
# /etc/systemd/system/lw-pg-backup.service
[Service]
Type=oneshot
WorkingDirectory=/opt/luminaryworks
ExecStart=/bin/bash deploy/scripts/pg-backup.sh

# /etc/systemd/system/lw-pg-backup.timer
[Timer]
OnCalendar=*-*-* 03:10:00
Persistent=true
Unit=lw-pg-backup.service

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now lw-pg-backup.timer
```

### 5.9 本机开发机合并记录

2026-11-07 在开发机执行（Docker Desktop 虚拟机内存上限约 7.7 GiB，不是 OVH 的 24 GB）。没有 `down -v`，三只旧 volume 都还在。

合并前 `docker stats --no-stream`：

| 容器 | 内存 |
|---|---|
| `luminary-identity-db` | 43.39 MiB / 7.748 GiB |
| `luminary-notification-db` | 19.54 MiB / 7.748 GiB |
| `luminary-entitlement-db` | 24.52 MiB / 7.748 GiB |

合并后同一条命令：当时容器为 `luminary-control-plane-control-plane-db-1`（约 **113.4 MiB / 2 GiB**）。后续已统一工程名为 **`luminary-works`**，旧三库容器与废弃卷已删除；现行容器为 `luminary-works-control-plane-db-1`。

```bash
node scripts/db-consolidate.mjs plan
node scripts/db-consolidate.mjs backup
# .db-backups/2026-11-07T07-16-20-111Z
docker stop luminary-entitlement-db   # 它挂着目标 volume，必须先停，否则起不了 control-plane-db
docker compose --env-file deploy/env/control-plane.env \
  -f deploy/compose/control-plane.yaml up -d --no-deps control-plane-db
node scripts/db-consolidate.mjs restore --backup .db-backups/2026-11-07T07-16-20-111Z
node scripts/db-consolidate.mjs verify --backup .db-backups/2026-11-07T07-16-20-111Z
docker stop luminary-identity-db luminary-notification-db
docker compose --env-file deploy/env/control-plane.env \
  -f deploy/compose/control-plane.yaml \
  -f deploy/compose/control-plane.dev-ports.yaml \
  up -d --no-deps --force-recreate control-plane-db
```

`verify` 结果：`logto` 72 表 / 13551 行，`notification` 4 表 / 65 行（其中 `email_messages` 53），`entitlement` 35 表 / 334 行（本来就在这只 volume 上，没有灌回去）。`ai_platform` 仍是空库。宿主机 `127.0.0.1:5433` 可登录 entitlement 与 notification。Logto OIDC `http://127.0.0.1:3001/oidc/.well-known/openid-configuration` 返回 200。随后 `node scripts/pg-backup.mjs` 与 `node scripts/pg-restore-drill.mjs` 对四库演练通过，并删掉了 `zz_drill_*`。

OVH 不要加 dev-ports。步骤用 §5.5，备份用 §5.8 的 shell 脚本（目标机往往没有 Node）。

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

### 6.3 实验室重置会员窗口（user01–user10）

试用过期后 VistaRemote 会显示「已达会话上限（0 台）」（`free` + 无试用 → 并发会话配额 0）。本机可重复执行：

```bash
# LuminaryWorks MetaRepo 根目录
pnpm lab:reset-membership
# 可选：pnpm lab:reset-membership -- --users user03 --days 7 --plan pro
# 预览：pnpm lab:reset-membership -- --dry-run
```

脚本会：清 Entitlement `trial_redemptions`、为各产品写入 **7 天 `pro`** subscription/grant，并同步 VistaRemote `users.plan` / `trialEndsAt` / `planExpiresAt`。改完后 **重新登录** Client。

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
- 唯一 Compose 工程：`luminary-works`（没有六产品合成一个 project）
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

## 13. 产品熔断 / 合作伙伴下架

一次只停一个合作产品，不停 LuminaryWorks，也不停其它产品。合作方是独立主体。收款在 MoR 阶段仍进 LuminaryWorks 账户；`merchantAccountId` 先留空，见 [`PAYMENTS.md`](PAYMENTS.md)。

每个产品在 `identity/apps.json` 里已有自己的 OIDC 应用（SPA，PKCE）。平台门户和控制台不是产品应用。

| `productCode` | Logto 应用名（`identity/apps.json`） |
|---------------|--------------------------------------|
| `dataluminary` | DataView (DataLuminary) |
| `blockyedu` | VibeEdu edu-app-web、VibeEdu code-app-web |
| `doerflow` | VibeAgent Web、DoerFlow Admin |
| `vistacast` | VistaCast Admin；机器应用 VistaCast Service（打 DoerFlow，不是用户登录） |
| `vistaremote` | VistaRemote Admin、VistaRemote Client |
| `syncrobrain` | LuminaryIoTChain iot-console-web；机器应用 SyncroBrain Gateway |

`register-apps.mjs` 只按清单创建或把 redirect 写回去。它没有「停用应用」开关。不要为了下架去改这个脚本，也不要在下架完成前再跑 `pnpm id:register`，否则刚在 Logto 里清掉的 redirect 会被写回。

### 13.1 停止售卖（保留已付费周期）

平台管理员（`entitlement:admin`，不是某个产品的 catalog scope）调用 Entitlement：

```bash
# 熔断。已付费用户用到当前 endsAt，新订单 / 续费履约 / Trial / 新的合作伙伴兑换都会失败。
curl -sS -X PUT "$ENTITLEMENT_BASE_URL/v1/admin/products/vistaremote/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"suspended","reason":"partner hold"}'
```

- 新购与续费：`PRODUCT_SUSPENDED`（HTTP 402）。退役用 `status=retired`，错误码 `PRODUCT_RETIRED`。
- `GET /v1/catalog/offerings` 不再列出该产品。`GET /v1/catalog/plans` 仍返回它，并带 `status`，方便控制台显示。业务 Control Console **Partners**（`/partners`，需 `entitlement:admin`）可 Suspend / Resume / Retire / Force-revoke；也可用下面的 curl。
- 已经在渠道侧扣款、但订单还没履约的单不会发权益。需要在支付后台退那笔款。
- 审计动作是 `product.lifecycle`。

恢复售卖：同一个 PUT，`status` 改为 `active`。

### 13.2 立即切断已付费权益（可选）

默认不要做。只在合同要求马上停用时：

```bash
curl -sS -X POST "$ENTITLEMENT_BASE_URL/v1/admin/products/vistaremote/force-revoke" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"contract termination"}'
```

这会对该产品相关订单调用现有的 `revokeOrderEntitlements`。审计动作是 `product.force_revoke`。`POST /v1/admin/grants` 在熔断后仍能发人工权益，它不是熔断开关。

### 13.3 停登录（手工 Logto）

1. 打开 Logto Admin Console（实验室默认 `http://127.0.0.1:3002`，只绑本机）。
2. 按上表找到该产品的 SPA。
3. 在应用设置里停用该应用，或先清掉 redirect URI，使用户无法完成登录。机器应用若只服务这个产品，同样在控制台里停用。
4. 不要接着跑 `node identity/scripts/register-apps.mjs` / `pnpm id:register`，除非准备恢复。恢复时把 redirect 留在 `apps.json` 里再注册一次即可。

仓库里没有现成的「按产品关闭 Logto 应用」命令，所以这一步停在 Admin Console。

### 13.4 停该产品的托管 AI

服务凭证的 `productCodes` 在 `AI_PLATFORM_SERVICE_CREDENTIALS_JSON`（或单钥的 `AI_PLATFORM_SERVICE_PRODUCT_CODES`）。从该凭证的 `productCodes` 里去掉这个 `productCode` 后重启 AI Platform。该产品的 BFF 再带这个 `productCode` 会得到 `FORBIDDEN`。

若还要限制用量而不是摘掉凭证，在 `deploy/env/control-plane.env` 设置（示例，默认注释掉）：

```bash
# AI_PLATFORM_PRODUCT_LIMITS_JSON={"vistaremote":{"rpm":0,"dailyChargeMicro":0}}
```

这只作用于托管调用，不影响 BYOK。`rpm` 与 `dailyChargeMicro` 是进程内计数，重启后清空。

### 13.5 对外说明

发一封支持邮件，并在状态页写明：该产品暂停新购；已付费用到当前账期结束，或已按合同提前终止。其它产品与 LuminaryWorks 账号登录不受影响。不要把这家合作方的协议文案写进别的产品。


## 14. 合作产品接入（注册表，干跑）

熔断、停登录、停托管 AI 用上一节。本节只登记一家合作产品，不调用停用接口，也不改 `deploy/compose`。

注册表：`contracts/partners.manifest.json`。字段说明和权限：[`spec/partners.md`](../spec/partners.md)。

```bash
pnpm partner:onboard -- --list
pnpm partner:onboard -- --check dataluminary
pnpm partner:onboard -- --plan dataluminary
```

`--plan` 只打印清单：`identity/apps.json` 是否已有这些应用、Entitlement 目录种子、AI 凭证要绑定的 `productCodes`、Account Center 卡片、官网卡片、Logto 里要创建的 `partner:<code>:*` scope。它不 POST，不写密钥。

目录种子里没有价格。`amountMinor` 由运营填写后再 `POST /v1/admin/catalog/revisions`。VistaCast 与 SyncroBrain 的 `sellable` 是 false，不要为它们发布可售 SKU。

`--write-apps` 只有在缺应用、且 manifest 里该应用的 `clientId` 正好是 `PUBLIC_CLIENT_ID_PLACEHOLDER` 时，才把公开模板追加进 `identity/apps.json`。六个现行产品不会被这条命令改写。下架过程中不要跑 `pnpm id:register`，见 §13.3。
