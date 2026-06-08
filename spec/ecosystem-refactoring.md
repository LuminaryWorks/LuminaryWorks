# LuminaryWorks 生态重构规格 (v1.0)

> **状态**：Draft · **作者视角**：架构师 / 技术经理 · **方法**：VibeCode Spec-Driven  
> **目标**：把分散在各产品仓的「公共能力」收敛到 [LuminaryWorks](https://github.com/LuminaryWorks) 组织，统一登录授权、文档门户与共享库，降低五产品重复建设。

## 0. 决策摘要（TL;DR）

| # | 决策 | 落地 |
|---|------|------|
| D1 | **docs 独立成仓**，RsPress 对外宣传站 | `LuminaryWorks/docs`（本地 `LuminaryWorks/docs/`） |
| D2 | **统一登录授权独立 Docker 服务** | `LuminaryWorks/identity`（Logto + PG + Redis + 注册脚本） |
| D3 | **共享包迁出 DataLuminary** → `LuminaryWorks/shared` pnpm 工作区 | `@luminary/auth-core`、`auth-react`、`pal`、`tooling` |
| D4 | **一键初始化脚本**，开发者 `bootstrap` 即可拉起 identity + 构建共享库 | `LuminaryWorks/scripts/bootstrap.*` |
| D5 | **LuminaryWorks 作为编排 MetaRepo**，子仓为独立 Git（不做 submodule） | 沿用 DataLuminary/VibeEdu 模式 |

## 1. 现状问题（Why）

1. **共享包寄居在 DataLuminary**：`DataLuminary-Platform/packages/luminary-*` 被 5 个后端用 `file:` 相对路径引用，跨仓耦合、构建顺序脆弱（须先 build auth-core）。
2. **Identity 启动方式分散**：`docker-compose.identity-dev.yml` 藏在 DataLuminary `scripts/`，其余产品文档各自抄写启动命令。
3. **没有统一对外门户**：五产品叙事散落在各 README，缺少营销级入口站。
4. **初始化心智负担**：新成员要手动 build 包、起 Logto、注册 5 个 Application。

## 2. 目标组织结构（What）

```text
github.com/LuminaryWorks/
├── LuminaryWorks      # 编排 MetaRepo（叙事 + 标准 + 脚本）       ← 本仓
├── docs               # RsPress 对外宣传 + 开发者门户（D1）
├── identity           # Logto 统一登录授权 Docker 服务（D2）
├── shared             # pnpm 工作区：@luminary/* 共享库（D3）
│   └── packages/{auth-core,auth-react,pal,tooling}
└── (后续) contracts   # 生态级 OpenAPI / 事件 schema（可选）
```

本地（沿用 MetaRepo「嵌套独立仓」模式，根仓 `.gitignore` 忽略子仓）：

```text
D:\www\LuminaryWorks\          # 根 MetaRepo
├── docs\                      # 独立 git → LuminaryWorks/docs
├── identity\                  # 独立 git → LuminaryWorks/identity
└── shared\                    # 独立 git → LuminaryWorks/shared
```

## 3. 五产品共享能力盘点（架构分析）

| 能力 | 当前位置 | 判定 | 目标 |
|------|----------|------|------|
| OIDC JWKS 验签（后端） | DataLuminary `packages/luminary-auth-core` | **共享** | `LuminaryWorks/shared` |
| OIDC SPA 客户端（前端） | DataLuminary `packages/luminary-auth-react` | **共享** | `LuminaryWorks/shared` |
| 权限抽象层 PAL | DataLuminary `packages/luminary-pal` | **共享** | `LuminaryWorks/shared` |
| Biome preset | DataLuminary `tooling/biome.*`、各仓 `tooling/` | **共享** | `LuminaryWorks/shared/packages/tooling` |
| Logto 部署 compose | DataLuminary `scripts/` | **共享** | `LuminaryWorks/identity` |
| PAL 合同 `pal.v1.yaml` | DataLuminary `spec/contracts/` | **共享**（暂留，后移 contracts 仓） | `LuminaryWorks/contracts`（P2） |
| 统一登录状态页 | DataLuminary `spec/` | **共享叙事** | 链接化到 docs 站 |
| BI / DataTalk | DataLuminary | **产品私有** | 留在 DataLuminary |
| 课程 / 实验 | VibeEdu | **产品私有** | 留在 VibeEdu |
| 链上合约 / Agent | VibeAgent | **产品私有** | 留在 VibeAgent |
| WebRTC 信令 / 录制 | VistaRemote | **产品私有** | 留在 VistaRemote |
| EMQX / ThingsBoard 编排 | LuminaryIoTChain | **产品私有** | 留在 LuminaryIoTChain |
| 媒体网关 media-platform | VibeEdu | **候选共享**（IoT 摄像头/Remote 复用） | 评估，暂留 VibeEdu |
| 文件服务 / Notify | 各产品分散 | **候选共享** | 抽象接口 P3 |

**判定原则**：无业务域逻辑 + 被 ≥2 产品消费 + 契约稳定 → 收敛到 LuminaryWorks；否则留在产品仓。

## 4. 迁移里程碑（SDD，分阶段不破坏构建）

| 阶段 | 内容 | 出口标准 | 风险控制 |
|------|------|----------|----------|
| **LW-S0** | 本规格 + 组织结构 + docs/identity/scripts 骨架 | 文档与脚手架就位 | 不动现有 `file:` 引用 |
| **LW-S1** | `shared` 工作区建立，`@luminary/*` 源码迁入并发布（GitHub Packages） | `shared` CI 构建/发布通过 | DataLuminary `packages/` 暂保留为镜像 |
| **LW-S2** | 5 消费方依赖切换：`file:` → `^x.y.z` | 5 仓 CI 绿；删除相对路径 | 一仓一 PR，逐个验证 |
| **LW-S3** | 删除 DataLuminary `packages/`，`tooling` preset 发包 | 单一来源；无重复 | 打 tag 备份 |
| **LW-S4** | `contracts` 仓抽取 PAL/事件 schema | 合同单一来源 | 生成器回填类型 |

**回滚**：每阶段独立 PR + tag；`file:` 与版本号依赖在 S2 期间可并存（npm overrides）。

## 5. 统一登录授权服务（D2 规格）

详见 [`identity/README.md`](https://github.com/LuminaryWorks/identity)。要点：

- 独立 `docker compose`：`logto`（OIDC 3001 / Admin 3002）+ `postgres` + `redis`
- `scripts/register-apps.*`：幂等注册 6 个 Application（5 产品 + iot-console）
- `.env.example` 暴露 `IDP_ISSUER` / 各 `CLIENT_ID`，供五产品 `.env` 引用
- 五产品后端统一用 `@luminary/auth-core`（JWKS）；前端统一用 `@luminary/auth-react`
- 私有化：`IDP_MODE=external_oidc` 直连企业 IdP，无需改业务代码

各产品**开发文档**新增「统一登录」章节，指向本服务（见 §7）。

## 6. 文档门户（D1 规格）

`LuminaryWorks/docs` = RsPress 站，两类受众：

| 区 | 受众 | 内容 |
|----|------|------|
| **首页 / 产品** | 客户、合作伙伴 | 生态叙事、五产品卡片、场景方案 |
| **开发者** | 工程师 | 快速开始、统一登录接入、共享库用法、贡献规范 |

设计：Hero（渐变 + 一句话价值）、五产品能力卡、闭环图、CTA。详见 `docs/` 脚手架与 `rspress.config.ts`。

## 7. 各产品开发文档义务

每个产品仓 `DEVELOPMENT`/`spec` 必须新增「统一登录（LuminaryWorks Identity）」小节，包含：

```md
## 统一登录（LuminaryWorks Identity）
1. 启动：`git clone LuminaryWorks/identity && cd identity && ./bootstrap.sh`（或 meta 仓 `pnpm id:up`）
2. 配置：复制 identity 输出的 CLIENT_ID 到本仓 `.env`（VITE_IDP_* / IDP_ISSUER）
3. 后端：依赖 `@luminary/auth-core`，`LuminaryAuthModule.forRootAsync({ mode, issuer })`
4. 前端：依赖 `@luminary/auth-react`，OIDC PKCE 登录
5. 私有化：`IDP_MODE=external_oidc` + 企业 OIDC issuer
```

落地清单见 [`../docs/develop/unified-login.md`](https://github.com/LuminaryWorks/docs)。

## 8. VibeCode Spec-Driven 工作流（团队约定）

```text
1. 改 spec/（本仓或产品仓）        → 评审（架构 + 产品）
2. 改 contracts/（如涉及接口）     → 生成类型
3. 改实现仓                        → 单仓 PR + CI
4. 更新状态页 / 里程碑              → docs 同步
```

**强约束**：跨产品 JWT claim、`iot.*`/`agent.*` 权限码、MQTT topic 变更，必须先改本仓 spec，再改实现。详见 [collaboration-standards.md](../docs/collaboration-standards.md)。

## 9. 验收标准

- [ ] `docs` 独立仓，`pnpm dev` 本地预览，首页美化达标
- [ ] `identity` 一条命令拉起 Logto 并注册 6 应用
- [ ] meta 仓 `pnpm bootstrap` 串联 identity + shared 构建
- [ ] `shared` 工作区可独立构建 `@luminary/*`
- [ ] 五产品开发文档含「统一登录」章节
- [ ] 迁移里程碑 LW-S0 完成，S1–S4 排期明确
