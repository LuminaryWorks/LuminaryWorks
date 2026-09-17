# LuminaryWorks 官网上线与域名切换

> 设计依据：[`spec/website-design.md`](../spec/website-design.md) §6.1  
> 代码仓：`LuminaryWorks/website`（本地嵌套 `website/`，Next 16 静态导出 + Cloudflare Pages）

## 1. 架构现状

| 入口 | 托管 | 仓库 | 构建产物 |
|------|------|------|----------|
| `luminaryworks.dev`（主域）；`www` 301 → apex | Cloudflare Pages 项目 **`luminaryworks-website`** | [LuminaryWorks/website](https://github.com/LuminaryWorks/website) | `out/` |
| `docs.luminaryworks.dev` | GitHub Pages | [LuminaryWorks/docs](https://github.com/LuminaryWorks/docs) | `doc_build/`（Rspress） |

- 官网：营销首页、产品/生态/部署/关于、法律条款（中英）。
- 文档站：开发者文档与生态叙事（**不再**占用 apex）。

本地开发：

```bash
pnpm web:dev       # 官网 :13000（web:* 是官网，site:* 是部署站点意图）
pnpm docs:dev      # 文档站
pnpm legal:sync    # spec/legal → website/content/legal
pnpm legal:check   # CI：校验法律页与 spec 同步
```

---

## 2. 首次上线步骤

按顺序执行，可在 PR / 运维单中逐项勾选。

### 2.1 推送官网仓库

- [ ] 在 GitHub 组织创建 **`LuminaryWorks/website`**（若尚未创建）
- [ ] 从本地 `website/` 推送 `main`（origin 已配置：`git@github.com-luminaryworks:LuminaryWorks/website.git`）

### 2.2 Cloudflare Pages

- [ ] 在 GitHub Actions（组织或仓库 secret）配置：
  - `CLOUDFLARE_API_TOKEN`（权限：Account · **Cloudflare Pages · Edit**）
  - `CLOUDFLARE_ACCOUNT_ID`
- [ ] 创建 Cloudflare Pages 项目 **`luminaryworks-website`**
  - Production branch：`main`
  - 构建产物目录：**`out`**
  - 构建由仓库 `.github/workflows/deploy.yml` 触发（`wrangler pages deploy`）
- [ ] 绑定自定义域：**`luminaryworks.dev`**（SEO 唯一主域，与官网 `SITE_URL` 一致）
- [ ] **`www.luminaryworks.dev` → apex 301**（Redirect Rule 或 Pages 绑定 www 后再跳转；勿与 apex 双入口并存）

### 2.3 文档站迁回 `docs` 子域

此前 docs 站曾占用 apex；上线后 apex / www 归官网。

- [ ] GitHub Pages（`LuminaryWorks/docs`）自定义域改为 **`docs.luminaryworks.dev`**
- [ ] Cloudflare DNS：`docs` **CNAME** → `luminaryworks.github.io`（**Proxied**）
- [ ] **移除**原先指向 GitHub Pages 的 apex（`@`）与 `www` CNAME（避免与 Pages 冲突）
- [ ] MetaRepo `scripts/docs-sites.config.ps1` 已改为默认 `docs.{domain}` 模式（不再 `HostMode = apex`、不再把 `docs` 301 到 apex）。可用：

  ```powershell
  $env:CF_API_TOKEN = '<token>'
  .\scripts\setup-cloudflare-docs-dns.ps1 -Only LuminaryWorks
  ```

  > **注意**：`setup-cloudflare-docs-dns.ps1` **不会**管理 `luminaryworks.dev` 的 apex / www（由 Cloudflare Pages 接管）。

### 2.4 验证清单

- [ ] `https://luminaryworks.dev/` → **200**
- [ ] `https://www.luminaryworks.dev/` → **301** → `https://luminaryworks.dev/`
- [ ] `https://luminaryworks.dev/en/` → **200**
- [ ] 法律页（各 200）：
  - `/legal/terms/`、`/legal/privacy/`、`/legal/trial-data-deletion/`
  - `/en/legal/terms/`、`/en/legal/privacy/`、`/en/legal/trial-data-deletion/`
- [ ] `https://docs.luminaryworks.dev/` → **200**
- [ ] 旧书签：原 apex 上的 docs 路径无死链（必要时在 docs 仓或 CDN 加 redirect 规则）

---

## 3. 法律页与 Entitlement

官网承载公开法律页（政策版本 **`lw-legal-v2026-09-07`**）：

- `/legal/terms/`、`/legal/privacy/`、`/legal/trial-data-deletion/`（中文）
- `/en/legal/...`（英文）

上线后，将 **`ENTITLEMENT_LEGAL_PUBLIC_BASE_URL`** 从：

```text
https://docs.luminaryworks.dev/legal
```

改为：

```text
https://luminaryworks.dev/legal
```

（无尾部斜杠；各产品 Trial / 控制台链接会拼 `/terms` 等路径。）

### 3.1 仓库内需修改的位置

| 文件 | 字段 / 说明 | 上线后值 |
|------|-------------|----------|
| `deploy/env/control-plane.env.example` | `ENTITLEMENT_LEGAL_PUBLIC_BASE_URL` | `https://luminaryworks.dev/legal` |
| `deploy/env/control-plane.env` | 同上（运维本地副本，gitignore） | 同上 |
| `deploy/compose/control-plane.yaml` | `ENTITLEMENT_LEGAL_PUBLIC_BASE_URL` 默认值（entitlement 服务） | `https://luminaryworks.dev/legal` |
| `deploy/compose/control-plane.yaml` | `CONTROL_CONSOLE_LEGAL_DOCS_URL` 默认值（control-console） | 同上，或显式设 `CONTROL_CONSOLE_LEGAL_DOCS_URL` |
| `services/entitlement/env.example` | `ENTITLEMENT_LEGAL_PUBLIC_BASE_URL` | `https://luminaryworks.dev/legal` |
| `services/entitlement/docker-compose.yml` | `ENTITLEMENT_LEGAL_PUBLIC_BASE_URL` 默认值 | `https://luminaryworks.dev/legal` |
| `services/entitlement/src/config/entitlement.config.ts` | 代码内 fallback（未设 env 时） | `https://luminaryworks.dev/legal` |
| `apps/control-console/.env.example` | `CONTROL_CONSOLE_LEGAL_DOCS_URL` | `https://luminaryworks.dev/legal` |
| `apps/control-console/server/config.mjs` | 读取 `CONTROL_CONSOLE_LEGAL_DOCS_URL` 或 `ENTITLEMENT_LEGAL_PUBLIC_BASE_URL` | 通过 env 注入，无需改代码 |
| `apps/control-console/server/config.test.mjs` | 测试 fixture | 随 env 示例一并更新 |
| `apps/control-console/src/lib/runtime-config.test.ts` | 测试 fixture `legalDocsUrl` | 随 env 示例一并更新 |

说明：

- **Hosted SaaS / 控制面**：改 `deploy/env/control-plane.env` 后 `docker compose ... up -d` 重建 entitlement、control-console。
- **仅 entitlement 独立栈**：改 `services/entitlement/.env` 后重启服务。
- `ENTITLEMENT_LEGAL_POLICY_VERSION` 保持 **`lw-legal-v2026-09-07`**，与官网页头 `policyVersion` 一致。

---

## 4. 条款更新流程

1. 编辑 MetaRepo **`spec/legal/{zh,en}/*.md`**
2. 同步到官网仓：`pnpm legal:sync`
3. 在 **`website/`** 仓提交 `content/legal/**`，push 触发 Cloudflare Pages 部署
4. CI / 本地门禁：`pnpm legal:check`（产物必须与 spec 一致）

---

## 5. 回滚

1. **Cloudflare Pages**：在控制台将 Production 回滚到上一成功 deployment。
2. **DNS 应急**（仅当 Pages 不可用且需临时恢复 docs 为入口）：
   - 将 apex / `www` CNAME 临时指回 **`luminaryworks.github.io`**
   - **代价**：`/legal/*` 在 docs 站**不存在**，Entitlement / Trial 法律链接会失效，需尽快恢复 Pages 或单独 redirect。
3. **Entitlement**：若回滚期间仍指向 `https://luminaryworks.dev/legal`，确保官网 deployment 可用；若改回 docs URL，须确认 docs 站是否有对应路由（当前**没有**）。

---

## 6. 已知待确认项

| 项 | 说明 |
|----|------|
| **商务邮箱** | 官网「联系商务」为 `admin@luminaryworks.dev` — 需确认该地址真实可收信（MX / 转发）。 |
| **VistaRemote 域名** | 品牌口径为 **`remote.vistacast.dev`**；安装向导默认 `deploy/luminaryworks-install/hosts.defaults.json` 为 **`vistaremote.vistacast.dev`**。运维按实际 DNS 对齐，勿混用未解析主机名。 |

---

## 相关文档

- [`spec/website-design.md`](../spec/website-design.md) — IA、设计令牌、验收清单
- [`deploy/README.md`](README.md) — 控制面与客户安装总览
- [`spec/legal/README.md`](../spec/legal/README.md) — 法律工程模板说明
