# VistaRemote 客户端发布（Electron / RN）

GitHub 公开仓 [VistaRemote/downloads](https://github.com/VistaRemote/downloads) 里的 **Agent / Viewer / Android APK** 必须烤入 **vistacast.dev 下的 VistaRemote 主机名**，不要烤 `localhost`。

品牌官网是 **`https://remote.vistacast.dev`**。没有独立 apex，也 **没有** `vistaremote.vistacast.com`（未做 DNS）。旧主机名 `*.vistaremote.vistacast.dev` 301 到下表。

## 域名矩阵（安装包 Bake）

| 用途 | 主机名 |
|------|--------|
| 官网 / 下载页 | `https://remote.vistacast.dev` |
| Client SPA | `https://app.remote.vistacast.dev` |
| Admin SPA | `https://admin.remote.vistacast.dev` |
| API + 信令 | `https://api.remote.vistacast.dev`（`wss://…/signaling`） |
| 统一登录 | `https://login.luminaryworks.dev/oidc` |
| 安装向导兼容名 | `vistaremote.vistacast.dev`（以实际 DNS 为准） |

环境真源：VistaRemote Meta-Repo `config/environments/prod.env`。

```bash
cd /Users/andyzhou/www/VistaRemote
pnpm pack:prod -- --publish
# 只打某一端： --windows-only / --mac-only / --android-only
```

`latest` 稳定别名：

- `VistaRemote-Agent-win-setup.exe` / `VistaRemote-Agent-mac.dmg`
- `VistaRemote-Viewer-win.exe` / `VistaRemote-Viewer-mac.dmg`
- `VistaRemote.apk`

官网 `/download` 用 `…/releases/latest/download/<稳定名>`，不要写死版本号。

## 局域网联调包（不要发 latest）

Mac 跑 `pnpm dev:server`（`0.0.0.0:3000`），同 Wi-Fi 的 Win10 装 **LAN 包**。

```bash
cd /Users/andyzhou/www/VistaRemote
pnpm pack:lan                 # 自动探测 en0 IPv4
pnpm pack:lan -- --host 192.168.31.239 --windows-only
```

产物：`desktop/release/lan/` + `LAN-TEST.md`。  
烤入 `http://<Mac-WiFi-IP>:3000`。上传这些文件会污染 GitHub latest，脚本会拒绝 `--publish`。

小米路由：关闭「无线隔离 / AP 隔离 / 访客网络」。Win10 浏览器先打开 `http://<Mac-IP>:3000/health`。

## 本机 Mac Viewer（本地 Logto 种子账号）

`desktop/release/viewer/*.dmg` 若是 **prod** 包，会打 `login.luminaryworks.dev`，**不能**用 `LW_USER_10`。本机联调用：

```bash
pnpm pack:local -- --mac-only
```

产物：`desktop/release/local/VistaRemote-Viewer-*-mac.dmg`。Viewer 在 `http://127.0.0.1:17892` 同源代理 Experience，账号 `user10` / `LuminaryDev!234`。

**Google / GitHub**：打包 Viewer 走系统浏览器登录（`auth-react` `mode=external`）；账密仍在 App 内。DoerFlow / VistaCast 桌面与 App 应复用同一契约（LuminaryWorks `identity-and-permissions` §3.2）。

编排仓镜像说明见兄弟仓 `LuminaryWorksDeployment` 的 [客户端发布规范](https://github.com/LuminaryWorks/deployment) `docs-site/docs/client-releases.md`。
