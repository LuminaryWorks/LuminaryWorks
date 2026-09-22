# LuminaryWorks 首次安装包（不含 Docker 镜像）

这是 **LuminaryWorks 控制面 + 六个联邦产品** 的首次部署介质，对应 `pnpm pack:luminaryworks`（`pack:hk-test` 是同一脚本），与旧基座离线镜像包无关。

**不是** `pnpm pack:all`。`pack:all` 是断网离线路径：控制面 + 六个产品 **各打一份** 带 `docker save` 的 tar，目标机只 `docker load`、禁止现场 build。对照：[`../README.md`](../README.md)「Two pack commands」、[`../HANDBOOK.md`](../HANDBOOK.md) §4。

**包内没有：** Docker 引擎、Compose 插件、任何镜像 tar。

**Docker：** 目标机没有 Docker 时，`install.sh` 会安装 Engine + Compose。**已经装了 Docker 的，不会卸载、替换或 prune 已有引擎 / 镜像 / 容器。**

**端口：** 安装前检查将要占用的端口。被其它服务占用则停止，避免和原有业务冲突。

**域名：** 表单默认填品牌域名。客户交付填域名；清空域名才走 IP:端口（红色告警）。换一台机器：填那台机器的源站公网 IP，域名可以不变。

**勾选：** 解压后编辑 `site.json` 的 `products.*.enabled`。六个产品各自独立 Compose 项目，**不会**合成一份 yaml。

**改配置：** 默认打开安装配置页（表单从 env / 品牌域名读）。管理员密码未填则随机生成，到 `identity/ACCOUNTS.product.env` 或 CSV 查找。库口令等对内密钥同样随机生成。

**VistaRemote：** 没有独立主域名，用 `vistaremote.vistacast.dev`。

包里有：

| 目录 | 是什么 |
|---|---|
| `deploy/` + `services/` + `apps/control-console` | 控制面：Identity / Auth Gateway / Entitlement / Control Console |
| `products/dataluminary` 等六个 | DataLuminary、BlockyEdu、DoerFlow、VistaRemote、VistaCast、SyncroBrain 源码 |
| `site.json` | 勾选装哪些；**不要写密码** |

主机上会对 **勾中的** 项目：pull Hub 基础镜像 → 用 Dockerfile **build** → `compose up`。

VistaCast / SyncroBrain 目前 `sellable=false`，仍在包里，默认不勾。

## 为什么 tar 只有约 80–90 MiB

六个产品 **都在** `products/` 里（见 `MANIFEST.json` 的 `products`）。这是源码 kit，**故意不带**：

- `node_modules` / `.next` / `dist`（本机 BlockyEdu 仓库可以到数 GB，都是这些）
- Docker 镜像 tar（那是 `pnpm pack:all`）
- 视频（`.mp4` / `.mov` / `.webm` 打包时跳过）

解压后大约 200 MiB 源码。镜像是安装时在主机上 pull / build 出来的。

## BlockyEdu 种子课程

勾选 `products.blockyedu.enabled` 后，安装会写入：

| 开关 | 默认 | 装上什么 |
|---|---|---|
| `seed.profile` | `full-demo` | LMS 演示目录：**AI 一对一口语 / 发音纠正 / AI English**、Python 等演示课（写在 edu-server 源码里，启动时注入数据库） |
| `seed.packs` | 五个平台课包全开 | `edu-server/content/course-packs/` 里已有的 Markdown 课：SyncroBrain 实体课、DataLuminary、VistaCast、DoerFlow、VistaRemote |
| `seed.oerGrowth` | `["oer-growth-v1"]`（安装表单**默认勾选**） | `edu-server/content/oer-growth/oer-growth-v1/` 获客公开课 10 门；取消勾选 → `[]` → `EDU_OER_GROWTH=` 不导入 |

仓库里 **没有** 另存一份「抓取下来的视频课」。能跟的种子就是上面三层。只要 `packs: []` 才会跳过平台课包；只要 `oerGrowth: []` 才会跳过获客公开课。

```json
"blockyedu": {
  "enabled": true,
  "seed": {
    "profile": "full-demo",
    "packs": ["syncrobrain", "dataluminary", "vistacast", "doerflow", "vistaremote"],
    "oerGrowth": ["oer-growth-v1"]
  }
}
```

## 本机打包

```bash
pnpm pack:luminaryworks
```

产物：`dist/kits/luminaryworks-install-linux-amd64-<sha>.tar`

## 主机安装

```bash
tar -xf luminaryworks-install-linux-amd64-*.tar
cd luminaryworks-install-linux-amd64-*

sudo bash install.sh
# 终端会打印配置页地址：http://<公网IP>/?t=...（默认 :80）
# 脚本自动放行本机防火墙（ufw / firewalld / iptables）。
# 在运维电脑浏览器打开。先探测公网 IP，没有公网才用局域网。
# 腾讯云 / 阿里云 / AWS 默认安全组一般已放行 80；OVH 通常没有额外安全组。

# 或跳过表单，直接改 site.json / ACCOUNTS.product.env 后：
sudo bash install.sh --no-wizard --public-host <这台机器的公网IP>

# 装完自动验收；以后随时再跑：
sudo bash accept.sh
```

环境变量见 [`ENV.md`](ENV.md)。只勾控制面时，六个产品不会启动。改完 `site.json` 再跑一次 `install.sh` 即可加装，已运行的项目不会被合并。

## 验收（控制面）

```bash
curl -fsS http://43.154.60.121:3001/oidc/.well-known/openid-configuration
curl -fsS http://43.154.60.121:3010/ready
curl -fsS http://43.154.60.121:3040/ready
curl -fsS http://43.154.60.121:3050/health
```

Logto Admin：`ssh -L 3002:127.0.0.1:3002 USER@43.154.60.121` → `http://127.0.0.1:3002`。

平台用户用 `identity/ACCOUNTS.product.env`，不要用 `ACCOUNTS.dev.env`。
