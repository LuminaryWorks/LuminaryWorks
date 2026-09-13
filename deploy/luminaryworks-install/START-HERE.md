# 从这里开始

两种方式等价，**表单默认填品牌域名**（`hosts.defaults.json`），源站 IP 自动检测当前机器：

1. **安装配置页（默认）**：`sudo bash install.sh`  
   四步：勾选产品 → 超管与产品登录 → 运维库口令 → 内存上限。  
   终端会打印 `http://<公网IP>/?t=...`（优先监听 `0.0.0.0:80`，被占用则 8080 / 8099）。脚本会自动 `ufw allow`（或 firewalld / iptables）。在 **Mac 浏览器**打开该地址，不要用服务器上的 127.0.0.1。腾讯云 / 阿里云 / AWS 默认安全组一般已放行 80；OVH 通常只需本机防火墙。页面提交「开始安装」后会让出 80 给产品入口。装完可下载配置 CSV。
2. **直接改文件**：编辑 `site.json`、`identity/ACCOUNTS.product.env`，然后  
   `sudo bash install.sh --no-wizard --public-host <这台机器的公网IP>`

**域名：** 每个产品输入框默认已填 `dataluminary.dev` 等。客户交付请保留或改成实际 DNS。**清空某个域名**才走源站 IP:端口（应急），表单会红色告警。

**Docker：** 没有 Docker 时安装脚本会安装 Engine + Compose。已经装了 Docker 的，**不会卸载或替换**已有引擎、镜像、容器。

**端口：** 启动前检查本机监听端口。被其它服务占用则拒绝安装，避免和原有业务冲突。本套件上次装过的 `lw-*` 容器可以覆盖。

装完后自动跑产品库迁移（DataTalk `migration:run`）和 **一键验收**（健康检查 + IdP 密码登录）。以后随时：

```bash
sudo bash accept.sh
```

## 公网登录

- 源站公网 IP `publicHost`（换机器改这一项；Cloudflare 回源也填这台 IP）
- 各产品 **域名**（默认品牌域名；Identity 为 `login.luminaryworks.dev`）
- 勾选要装的产品
- 超管以及已勾选产品的用户名（示例里已有）
- 登录密码：表单或 env **未填则随机生成**，到 `identity/ACCOUNTS.product.env` 或安装完成后的 CSV 查找

用户名仍建议保留可读的 admin 名；密码可以手填强密码，也可以留空用随机值。

## 运维层（第三步）

库口令、服务密钥、Logto Admin（仅本机 `:3002`）打包时已随机生成。表单可改；排障打开文件：

- `deploy/env/control-plane.env`
- `identity/.env`（`LW_LOGTO_ADMIN_PASSWORD`）

## 内存（第四步）

按物理内存规划，**不要把 swap 算进容量**。工作集之和应落在 RAM 减去约 4 GiB 内核/Docker 之内。`mem_limit` 是天花板，各产品不会同时顶满，所以上限合计可以大于 24 GiB。建议写入 `deploy/env/memory.env`。

## VistaRemote 域名

VistaRemote **没有独立主域名**。本次 DNS 用 `vistaremote.vistacast.dev`。不要写成 `vistaremote.dev`。

完整说明见 `EDIT-ME.md`、`ENV.md`。不要把密码写进 `site.json`。
