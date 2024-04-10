<p align="center">
  <img src="assets/logo.png" alt="LuminaryWorks" width="128" />
</p>

<h1 align="center">LuminaryWorks · 启明工坊</h1>

**AI 原生开源生态** — 六个可独立部署的产品，通过标准协议与共享服务互相成长。

> **组织**：[github.com/LuminaryWorks](https://github.com/orgs/LuminaryWorks/repositories)  
> **域名**：[luminaryworks.dev](https://luminaryworks.dev) · **中文名**：启明工坊  
> **原则**：业务完全隔离 · 身份与规范统一 · 按需集成、不强制耦合

## 六项目一览

| # | 品牌 | 中文名 | 域名 | GitHub | 一句话 |
|---|------|--------|------|--------|--------|
| 1 | **DataLuminary** | 数据明鉴 | [dataluminary.dev](https://dataluminary.dev) | [dataluminary/DataLuminary-Platform](https://github.com/dataluminary/DataLuminary-Platform) | AI 数据洞察 — BI、DataTalk 大屏 |
| 2 | **BlockyEdu** | 智码工坊 | [blockyedu.com](https://blockyedu.com) | [blockyedu/VibeEdu](https://github.com/blockyedu/VibeEdu) | AI 教育 — Blockly 编程与课程 |
| 3 | **DoerFlow** | 智工网 | [doerflow.dev](https://doerflow.dev) | [doerflow/VibeAgent](https://github.com/doerflow/VibeAgent) | 执行者价值网络 — Agent/链上结算 |
| 4 | **VistaCast** | 视界云遥 | [vistacast.dev](https://vistacast.dev) | [VistaCast/vistacast](https://github.com/VistaCast/vistacast) | AI 摄像头云监控（**文档先行**） |
| 5 | **VistaRemote** | 视界远程 | — | [VistaRemote/vibeCode](https://github.com/VistaRemote/vibeCode) | WebRTC 远程桌面 + AI 录制 |
| 6 | **SyncroBrain** | 万物智脑 | [syncrobrain.com](https://syncrobrain.com) | [syncrobrain/LuminaryIoTChain](https://github.com/syncrobrain/LuminaryIoTChain) | 连接设备的 AI OS |

本地路径（Phase C）：

```text
D:\www\LuminaryWorks\           # 启明工坊 MetaRepo
D:\www\dataluminary\            # 数据明鉴
D:\www\blockyedu\               # 智码工坊
D:\www\doerflow\                # 智工网
D:\www\vistacast\               # 视界云遥（规划 spec）
D:\www\vistaremote\             # 视界远程（远程桌面实现）
D:\www\syncrobrain\             # 万物智脑
```

> GitHub 组织 rename 与 `git remote` 更新见 [spec/github-org-migration.md](./spec/github-org-migration.md)。

## AI 生态叙事

六个项目回答同一条价值链的不同环节：

```text
         学（智码工坊）──► 连（万物智脑）──► 看（数据明鉴）
                                    │
          视（视界云遥 VistaCast）──┤  控（视界远程 VistaRemote）
                                    └──► 赚（智工网 DoerFlow）
```

- **学**：智码工坊 BlockyEdu — AI 编程与课程  
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
| [shared](https://github.com/LuminaryWorks/shared) | `@luminary/auth-core`、`auth-react`、`pal`、`tooling` |

## 一键初始化

```bash
# 克隆三个子仓到本目录后：
pnpm bootstrap     # 起 identity（Logto）+ 构建 shared（@luminary/*）
pnpm id:up         # 仅拉起统一登录
pnpm docs:dev      # 本地预览文档站
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [spec/domain-and-branding.md](./spec/domain-and-branding.md) | **域名与品牌决策**（六产品 + VistaCast/VistaRemote 并存） |
| [spec/github-org-migration.md](./spec/github-org-migration.md) | **GitHub 组织迁移**与 remote 更新 |
| [spec/products/](./spec/products/index.md) | **六产品规划**摘要 |
| [spec/ecosystem-refactoring.md](./spec/ecosystem-refactoring.md) | 生态重构：共享能力收敛、迁移里程碑 |
| [spec/repository-relationships.md](./spec/repository-relationships.md) | 仓库关系与集成矩阵 |
| [docs 站点](https://github.com/LuminaryWorks/docs) | 生态叙事 / 架构 / 产品 / 开发者指南 |

## 共享服务（收敛至本组织）

| 资产 | 现状 → 目标 |
|------|-------------|
| `@luminary/auth-core` / `auth-react` / `pal` | DataLuminary `packages/` → `LuminaryWorks/shared` |
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

- 各产品保留**独立 Git 组织、独立域名、独立发版、独立 LICENSE**
- LuminaryWorks 仅维护**叙事、标准、共享库**，不替代各产品 MetaRepo 治理
- 跨产品集成一律 **HTTP / OIDC / MQTT / 事件**，禁止运行时跨仓 import
