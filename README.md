<p align="center">
  <img src="assets/logo.png" alt="LuminaryWorks" width="128" />
</p>

<h1 align="center">LuminaryWorks</h1>

**AI 原生开源生态** — 五个可独立部署的产品，通过标准协议与共享服务互相成长。

> **组织**：[github.com/LuminaryWorks](https://github.com/orgs/LuminaryWorks/repositories)  
> **原则**：业务完全隔离 · 身份与规范统一 · 按需集成、不强制耦合

## 五项目一览

| # | 产品 | 组织 / 仓库 | 一句话 |
|---|------|-------------|--------|
| 1 | **DataLuminary** | [DataLuminary/DataLuminary-Platform](https://github.com/DataLuminary/DataLuminary-Platform) | AI 数据洞察 — BI、DataTalk 大屏、分析 |
| 2 | **VibeEdu** | [BlockyEdu/VibeEdu](https://github.com/BlockyEdu/VibeEdu) | AI 教育 — 课程、编程实验、工程师培养 |
| 3 | **VibeAgent** | [AgentSkillMesh/VibeAgent](https://github.com/AgentSkillMesh/VibeAgent) | AI Agent 链上交易市场 |
| 4 | **VistaRemote** | [VistaRemote/vibeCode](https://github.com/VistaRemote/vibeCode) | AI 远程监控 — WebRTC 桌面、录制与洞察 |
| 5 | **LuminaryIoTChain** | [LuminaryIoTChain/LuminaryIoTChain](https://github.com/LuminaryIoTChain/LuminaryIoTChain) | AI 物联网 PaaS — 设备、EMQX、ThingsBoard |

本地路径（开发机参考）：

```text
D:\www\DataLuminary\DataLuminary-Platform
D:\www\BlockyEdu\VibeEdu
D:\www\AgentSkillMesh\VibeAgent
D:\www\VistaRemote
D:\www\LuminaryIoTChain
```

## AI 生态叙事

五个项目回答同一条价值链的不同环节：

```text
         学（VibeEdu）──► 做（LuminaryIoT / VistaRemote）──► 析（DataLuminary）
                                    │
                                    └──► 赚（VibeAgent 链上 AI 市场）
```

- **学**：VibeEdu 用 AI 辅导工程师掌握 IoT、数据、Agent 开发  
- **连**：LuminaryIoTChain 让硬件厂商低成本接入云端（开源替代涂鸦类闭源 PaaS）  
- **看**：DataLuminary DataTalk 将设备遥测、业务数据变为可决策的大屏  
- **控**：VistaRemote 对设备/桌面远程运维，WebRTC + AI 录制分析  
- **赚**：VibeAgent 让 AI 能力与设备算力在链上交易、分成  

**每个产品可单独卖给客户**；组合后形成「从人才培养 → 设备上线 → 数据洞察 → 远程运维 → AI 变现」的闭环。

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
| [spec/ecosystem-refactoring.md](./spec/ecosystem-refactoring.md) | **生态重构规格**：共享能力收敛、迁移里程碑、SDD |
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
- VibeEdu → `spec/luminaryworks-ecosystem.md`
- VibeAgent → `spec/ECOSYSTEM.md`
- VistaRemote → `docs/luminaryworks-ecosystem.md`
- LuminaryIoTChain → `spec/ecosystem.md`

## 许可与独立性

- 各产品保留**独立 Git 组织、独立发版、独立 LICENSE**
- LuminaryWorks 仅维护**叙事、标准、共享库**，不替代各产品 MetaRepo 治理
- 跨产品集成一律 **HTTP / OIDC / MQTT / 事件**，禁止运行时跨仓 import
