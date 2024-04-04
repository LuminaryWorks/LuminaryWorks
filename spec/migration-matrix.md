# 五项目共享能力迁移矩阵

> 架构师视角：哪些留在产品仓、哪些收敛到 [LuminaryWorks](https://github.com/LuminaryWorks)。  
> 执行手册见 [ecosystem-refactoring.md](./ecosystem-refactoring.md) · 包迁移见 [shared/MIGRATION.md](https://github.com/LuminaryWorks/shared/blob/main/MIGRATION.md)。

## 判定标准

| 条件 | 动作 |
|------|------|
| 无业务 Entity / 域规则 | 可共享 |
| ≥2 产品消费 | 优先收敛 |
| 契约稳定（Semver） | 独立仓 + 发包 |
| 含产品特有逻辑 | 留在产品仓 |

## 矩阵

| 能力 | DataLuminary | VibeEdu | VibeAgent | VistaRemote | IoTChain | 判定 | 目标仓 | 阶段 |
|------|:---:|:---:|:---:|:---:|:---:|------|--------|------|
| OIDC JWKS 验签 | ✅ | ✅ | ✅ | ✅ | ✅ | **共享** | `shared/auth-core` | LW-S1 |
| OIDC SPA 客户端 | ✅ | ✅ | ✅ | ✅ | ✅ | **共享** | `shared/auth-react` | LW-S1 |
| PAL 权限层 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | **共享** | `shared/pal` | LW-S1 |
| Biome / tsconfig | ✅ | ✅ | ✅ | ✅ | ✅ | **共享** | `shared/tooling` | ✅ S0 |
| Logto compose | 宿主 | 消费 | 消费 | 消费 | 消费 | **共享** | `identity` | ✅ S0 |
| 生态文档 RsPress | — | — | — | — | — | **共享** | `docs` | ✅ S0 |
| PAL 合同 YAML | 宿主 | 消费 | 消费 | 消费 | 消费 | **共享** | `contracts`（规划） | LW-S4 |
| DataTalk / BI | ✅ | — | — | — | 嵌入 | **私有** | DataLuminary | — |
| 课程 / 考试 | — | ✅ | — | — | — | **私有** | VibeEdu | — |
| 链上合约 | — | — | ✅ | — | — | **私有** | VibeAgent | — |
| WebRTC 信令 | — | — | — | ✅ | — | **私有** | VistaRemote | — |
| EMQX / ThingsBoard | — | — | — | — | ✅ | **私有** | LuminaryIoTChain | — |
| media-platform | — | ✅ | — | 复用? | 摄像头 | **候选** | 评估 P3 | — |
| Notify / File | 分散 | 分散 | 分散 | 分散 | 分散 | **候选** | 抽象接口 P3 | — |

## 消费方依赖切换（LW-S2）

| 消费方 | 包 | 当前 | 目标 |
|--------|-----|------|------|
| DataTalk | auth-core | `file:../packages/...` | `@luminary/auth-core@^0.2` |
| VibeEdu server | auth-core | file: | 版本号 |
| VibeAgent api | auth-core | file: | 版本号 |
| VistaRemote server | auth-core | file: | 版本号 |
| iot-gateway | auth-core | file: | 版本号 |
| DataView 等 SPA | auth-react | 复制 idp 模式 | `@luminary/auth-react` |

## Identity 服务迁移（已完成 S0）

| 旧路径 | 新路径 |
|--------|--------|
| `DataLuminary-Platform/scripts/docker-compose.identity-dev.yml` | `LuminaryWorks/identity/docker-compose.yml` |
| `scripts/identity-env.example` | `identity/.env.example` + `registered-apps.json` |
| 各产品文档各自抄写 compose 命令 | 统一指向 `identity/bootstrap.sh` |

DataLuminary 旧 compose **保留至 LW-S2**，标注 deprecated，避免破坏现有脚本。

## 团队 SDD 义务

1. 跨产品接口变更 → 先改 `LuminaryWorks/spec` 或 `docs/develop/`
2. 共享包 breaking → Semver major + 五消费方 PR
3. 新产品接入生态 → 在 `identity/apps.json` 注册 + 更新本矩阵
