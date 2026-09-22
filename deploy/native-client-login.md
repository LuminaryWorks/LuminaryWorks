# 原生壳登录 UX（Electron / 移动端）

面向 **DoerFlow、BlockyEdu、VistaCast、VistaRemote、SyncroBrain** 等有桌面或 App 的产品。  
**交互一致，品牌各异**（`productName` / `logoSrc` / `themeColor` 按产品换）。

权威契约：[identity-and-permissions.md](../spec/identity-and-permissions.md) §3.2 · 参考实现：VistaRemote Agent（`:17891`）与 Viewer（`:17892`）。

## 必须一致

| 项 | 约定 |
|----|------|
| 登录 UI | `@luminaryworks/auth-react` ≥ 0.5 · `HeadlessLoginPanel` |
| 账密 | 应用内 Experience Headless |
| Google / GitHub / Hosted SSO | `mode="external"` + `openExternalUrl` → **系统浏览器**（RFC 8252） |
| Web SPA | 仍用 `mode="redirect"` / popup（浏览器内完成即可） |
| 回调 | loopback `http://127.0.0.1:<port>/auth/callback` 或 `product://auth/callback`；Chrome 回调由壳交回 App 窗（PKCE） |
| 本地邮箱 | 仅 `PUBLIC_ALLOW_LOCAL_LOGIN` 时折叠显示，不抢主 CTA |
| IdP 登记 | `identity/apps.json` 幂等写入 redirect / postLogout |

## 品牌差异（允许）

- `productName`、`logoSrc`、`themeColor`
- locale 文案（各产品 en + zh）
- 登录后落地页（Agent → 配对码；Viewer → `/pairing`；其它产品各自首页）

## 接入清单（新产品 / 新壳）

1. Logto：`apps.json` 增加 loopback 或 custom scheme  
2. `HeadlessLoginPanel`：`mode={native ? "external" : "redirect"}` + `openExternalUrl`  
3. 主进程：`shell.openExternal` / Custom Tabs / ASWebAuthenticationSession  
4. 静态服或 deep link：非 Electron UA 命中 callback → 聚焦 App 并 `loadURL` 同 URL  
5. `bindToPageOrigin`：勿把网站 redirect 烤进桌面包  

## 反例

- 嵌 WebView / 应用内 BrowserWindow 做 Google OAuth  
- Agent 与 Viewer 两套登录信息架构  
- 主路径只有本地邮箱表单、社交藏很深  

VistaRemote 验收：`pnpm pack:local -- --mac-only` → Agent / Viewer 登录页结构一致（Headless + 社交系统浏览器 + 可选本地折叠）。
