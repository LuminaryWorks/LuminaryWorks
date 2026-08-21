<p align="center">
  <img src="assets/logo.svg" alt="LuminaryWorks" width="128" />
</p>

<h1 align="center">LuminaryWorks · 启明工坊</h1>

**AI 原生开源生态** — 六个可独立部署的产品，通过标准协议与共享服务互相成长。

> **组织**：[github.com/LuminaryWorks](https://github.com/orgs/LuminaryWorks/repositories)  
> **域名**：[luminaryworks.dev](https://luminaryworks.dev) · **中文名**：启明工坊  
> **原则**：业务完全隔离 · 身份与规范统一 · 按需集成、不强制耦合

## 六项目一览

| # | 品牌 | 中文名 | 域名 | GitHub | 一句话 |
|---|------|--------|------|--------|--------|
| 1 | **DataLuminary** | 数据明鉴 | [dataluminary.dev](https://dataluminary.dev) | [DataLuminary/DataLuminary](https://github.com/DataLuminary/DataLuminary) | AI 数据洞察 — BI、DataTalk 大屏 |
| 2 | **BlockyEdu** | 智码工坊 | [blockyedu.com](https://blockyedu.com) | [BlockyEdu/BlockyEdu](https://github.com/BlockyEdu/BlockyEdu) | AI 全民创造 + VibeLearn 企业大学私有化 |
| 3 | **DoerFlow** | 智工网 | [doerflow.dev](https://doerflow.dev) | [DoerFlow/DoerFlow](https://github.com/DoerFlow/DoerFlow) | 执行者价值网络 — Agent/链上结算 |
| 4 | **VistaCast** | 视界云遥 | [vistacast.dev](https://vistacast.dev) | [VistaCast/VistaCast](https://github.com/VistaCast/VistaCast) | AI 摄像头云监控（**文档先行**） |
| 5 | **VistaRemote** | 视界远程 | [remote.vistacast.dev](https://remote.vistacast.dev) | [VistaRemote/VistaRemote](https://github.com/VistaRemote/VistaRemote) | WebRTC 远程桌面 + AI 录制 |
| 6 | **SyncroBrain** | 万物智脑 | [syncrobrain.com](https://syncrobrain.com) | [SyncroBrain/SyncroBrain](https://github.com/SyncroBrain/SyncroBrain) | 连接设备的 AI OS |

本地路径：本仓与六产品仓**并列**于同一工作区根目录。目录名为 **PascalCase**（macOS / Linux 区分大小写；Windows 不区分）。路径由脚本相对本仓解析，不写死 `D:\www` / `C:\www`。

工作区可以是任意父目录，例如 `C:\www`、`D:\www`、`~/www`、`/home/you/www`：

```text
{workspace}/
├── LuminaryWorks/           # 启明工坊 MetaRepo（本仓）
├── DataLuminary/            # 数据明鉴
├── BlockyEdu/               # 智码工坊
├── DoerFlow/                # 智工网
├── VistaCast/               # 视界云遥（规划 spec）
├── VistaRemote/             # 视界远程（远程桌面实现）
└── SyncroBrain/             # 万物智脑
```

> GitHub 组织 rename 与 `git remote` 更新见 [spec/github-org-migration.md](./spec/github-org-migration.md)。

## AI 生态叙事

六个项目回答同一条价值链的不同环节：

```text
      学+创（智码工坊）──► 连（万物智脑）──► 看（数据明鉴）
                                    │
          视（视界云遥 VistaCast）──┤  控（视界远程 VistaRemote）
                                    └──► 赚（智工网 DoerFlow）
```

- **学 + 创**：智码工坊 BlockyEdu — AI 全民创造（网站 / 小程序 / 标准玩具）与学中创；**VibeLearn** 可对企业私有化交付内部培训（对标知鸟）

- **连**：万物智脑 SyncroBrain — 开源 IoT PaaS  
- **看**：数据明鉴 DataLuminary — 数据洞察与大屏  
- **视**：视界云遥 VistaCast — AI 摄像头云监控（规划，文档先行）  
- **控**：视界远程 VistaRemote — WebRTC 远程桌面运维  
- **赚**：智工网 DoerFlow — Agent 与人类 Doer 价值网络  

**每个产品可单独卖给客户**；组合后形成完整 AI 基础设施闭环。

详见文档站 [LuminaryWorks/docs](https://github.com/LuminaryWorks/docs)。

## 组织结构（MetaRepo 编排）

本仓为编排型 MetaRepo，子仓为**独立 Git**（不做 submodule），本地作为嵌套目录由脚本编排：

```text
LuminaryWorks/                  # 本仓：叙事 + 标准 + 编排脚本
├── docs/        → LuminaryWorks/docs        RsPress 对外宣传 + 开发者门户
├── identity/    → LuminaryWorks/identity    统一登录授权 Docker 服务
└── shared/      → LuminaryWorks/shared      @luminary/* 共享库（pnpm 工作区）
```

| 子仓 | 作用 |
|------|------|
| [docs](https://github.com/LuminaryWorks/docs) | 营销站 + 开发者文档（RsPress） |
| [identity](https://github.com/LuminaryWorks/identity) | Logto + PG + Redis + 应用注册脚本 |
| [shared](https://github.com/LuminaryWorks/shared) | `@luminaryworks/auth-core`、`auth-react`、`pal`、`notification`、`entitlement-client`、`tooling` |
| `services/entitlement` | 中央订阅/权益服务（NestJS + PostgreSQL；见 `pnpm ent:*`） |
| `@luminaryworks/entitlement-client` | 产品侧客户端；测试/CI 用 npmjs 公开包（`^0.2.0`）。改 shared 源码后先发版，或本机 `pnpm.overrides` + `pnpm ent:client:sync` |

DoerFlow 采用特殊无试用策略：平台只展示 Pro / Ultra / Enterprise。其 Logto 平台会话与非托管钱包/SIWE 是独立状态；平台套餐控制托管 API 与配额，Gas、Escrow 和协议费仍走链上协议经济。统一错误语义为 401 身份、402 权益、403 资源 ACL。

## 一键初始化

本地 MetaRepo 编排栈（identity / shared / docs / entitlement / auth-gateway）用一条命令准备：

```bash
# 首次（克隆子仓 + 装依赖 + 起服务）：
.\init.ps1                 # Windows
# ./init.sh                # macOS / Linux

# 子仓已在本目录时（只做环境准备）：
pnpm bootstrap
```

`pnpm bootstrap` 会依次：

1. 拉起 **identity**（Logto + PG + Redis）
2. **shared**：`pnpm install` + `pnpm build`（`@luminaryworks/*`）
3. **docs**：`pnpm install`
4. **entitlement**：补齐 `.env` → `pnpm install` → 起 DB → migrate / seed
5. **auth-gateway**：从 `env.example` 生成 `.env`（无 npm 依赖）

缺目录的子仓会跳过并警告，不中断。六个产品仓（DataLuminary 等）不在 MetaRepo 内，需各自目录安装。

常用后续命令：

```bash
pnpm id:up         # 仅拉起统一登录（unless-stopped；Desktop 重启后自启，见 identity/LOCAL_DEV_DOCKER.md）
pnpm id:down       # 临时 stop（保留容器，下次 Desktop 仍自启）
pnpm id:destroy    # compose down（拆掉栈，需再 id:up）
pnpm docs:dev      # 本地预览文档站
pnpm ent:dev       # 权益服务开发态
pnpm auth:gateway  # Auth Gateway :3010（需 identity 已起）
```


## Cursor 模型策略

**常规执行**（小改动、明确 bug 修复、文档、测试、验证）默认：

1. **Cursor Grok 4.5 High Fast**
2. **Composer 2.5**（备选）

编码前做能力判断：若任务涉及架构改动、跨服务契约、深层排查等，Grok 4.5 可能不是最优选时，**暂停执行**，推荐 2–3 个模型及取舍，由你点名后再落地。不得在未点名时自动升到 GPT / Claude 等高消耗模型。

**仅规划**（Plan mode）可用任意合适模型。计划 Accept 后仍走上述能力门禁，不默认死锁 Grok。

规则文件：各仓 `.cursor/rules/model-usage-policy.mdc`（`alwaysApply: true`）。重同步：`node scripts/write-model-usage-policy.mjs`。

## Node.js 版本（强制）

生态所有 Node 项目统一：

- **Node.js >= 24.0.0**
- `package.json` → `"engines": { "node": ">=24.0.0" }`
- MetaRepo → `.nvmrc` / `.node-version` = `24`，`.npmrc` → `engine-strict=true`
- 重同步：`pnpm lock:node24`

Nest 共享库（如 `@luminaryworks/entitlement-client`）**源码是 ES import**，发布产物当前仍编译为 **CommonJS `require`**，以便 Nest 后端加载；这不等于落后于 Node 24。

## 文档索引

| 文档 | 说明 |
|------|------|
| [spec/identity-and-permissions.md](./spec/identity-and-permissions.md) | **身份与权限**：Logto AuthN + Experience Headless + Casbin 资源 AuthZ |
| [spec/subscription-and-entitlement.md](./spec/subscription-and-entitlement.md) | **订阅与权益**：Trial / Pro / Ultra / 企业 seat / License / Partner（权益不进 JWT） |
| [spec/domain-and-branding.md](./spec/domain-and-branding.md) | **域名与品牌决策**（六产品 + VistaCast/VistaRemote 并存） |
| [spec/github-org-migration.md](./spec/github-org-migration.md) | **GitHub 组织迁移**与 remote 更新 |
| [spec/products/](./spec/products/index.md) | **六产品规划**摘要 |
| [spec/ecosystem-refactoring.md](./spec/ecosystem-refactoring.md) | 生态重构：共享能力收敛、迁移里程碑 |
| [spec/repository-relationships.md](./spec/repository-relationships.md) | 仓库关系与集成矩阵 |
| [docs 站点](https://github.com/LuminaryWorks/docs) | 生态叙事 / 架构 / 产品 / 开发者指南 |
| [.cursor/skills/product-auth-implementation](./.cursor/skills/product-auth-implementation/SKILL.md) | 各产品登录/权限落地 Cursor 规范 |

## 共享服务（收敛至本组织）

| 资产 | 现状 → 目标 |
|------|-------------|
| `@luminaryworks/auth-core` / `auth-react` / `pal` / `notification` | DataLuminary `packages/` → `LuminaryWorks/shared` |
| 中央 Entitlement 服务 + `@luminaryworks/entitlement-client` | `services/entitlement` + `shared/packages/entitlement-client`（`pnpm ent:up` / `ent:dev`） |
| Biome tooling preset | 各仓 `tooling/` → `shared/packages/tooling` |
| Logto 部署 | DataLuminary `scripts/` → `LuminaryWorks/identity` |

迁移分阶段 LW-S0～S4，详见 [spec/ecosystem-refactoring.md](./spec/ecosystem-refactoring.md)。

## 各产品生态说明

每个产品仓库内均有 **`ecosystem` 文档**（可独立阅读，也可回到本页）：

- DataLuminary → `spec/ecosystem.md`
- BlockyEdu → `spec/luminaryworks-ecosystem.md`
- DoerFlow → `spec/luminaryworks-ecosystem.md`
- VistaCast → `spec/`（规划，见 LuminaryWorks `spec/products/vistacast.md`）
- VistaRemote → `spec/luminaryworks-ecosystem.md`
- SyncroBrain → `spec/ecosystem.md`

## 许可与独立性

- 生态核心产品默认采用 **[Polyform Noncommercial License 1.0.0](LICENSE)**（Polyform-NC）；商业使用须另行授权
- 各产品保留**独立 Git 组织、独立域名、独立发版、独立 LICENSE**
- LuminaryWorks 仅维护**叙事、标准、共享库**，不替代各产品 MetaRepo 治理
- 跨产品集成一律 **HTTP / OIDC / MQTT / 事件**，禁止运行时跨仓 import
