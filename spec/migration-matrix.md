# 五项目共享能力迁移矩阵

> 架构师视角：哪些留在产品仓、哪些收敛到 [LuminaryWorks](https://github.com/LuminaryWorks)。  
> 执行手册见 [ecosystem-refactoring.md](./ecosystem-refactoring.md) · 包迁移见 [shared/MIGRATION.md](https://github.com/LuminaryWorks/shared/blob/main/MIGRATION.md)。  
> **品牌名**见 [domain-and-branding.md](./domain-and-branding.md)。  
> **商业权益**权威规范：[subscription-and-entitlement.md](./subscription-and-entitlement.md)（Logto AuthN → Entitlement → Casbin；权益不进 JWT）。

## 判定标准

| 条件 | 动作 |
|------|------|
| 无业务 Entity / 域规则 | 可共享 |
| ≥2 产品消费 | 优先收敛 |
| 契约稳定（Semver） | 独立仓 + 发包 |
| 含产品特有逻辑 | 留在产品仓 |

## 矩阵

| 能力 | DataLuminary | BlockyEdu | DoerFlow | VistaCast | SyncroBrain | 判定 | 目标仓 | 阶段 |
|------|:---:|:---:|:---:|:---:|:---:|------|--------|------|
| OIDC JWKS 验签 | ✅ | ✅ | ✅ | ✅ | ✅ | **共享** | `shared/auth-core` | LW-S1 |
| OIDC SPA 客户端 | ✅ | ✅ | ✅ | ✅ | ✅ | **共享** | `shared/auth-react` | LW-S1 |
| PAL 权限层 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | **共享** | `shared/pal` | LW-S1 |
| Biome / tsconfig | ✅ | ✅ | ✅ | ✅ | ✅ | **共享** | `shared/tooling` | ✅ S0 |
| Logto compose | 宿主 | 消费 | 消费 | 消费 | 消费 | **共享** | `identity` | ✅ S0 |
| 生态文档 RsPress | — | — | — | — | — | **共享** | `docs` | ✅ S0 |
| PAL 合同 YAML | 宿主 | 消费 | 消费 | 消费 | 消费 | **共享** | `contracts`（规划） | LW-S4 |
| DataTalk / BI | ✅ | — | — | — | 嵌入 | **私有** | dataluminary | — |
| 课程 / 考试 | — | ✅ | — | — | — | **私有** | blockyedu | — |
| 链上合约 | — | — | ✅ | — | — | **私有** | doerflow | — |
| WebRTC 信令 | — | — | — | ✅ | — | **私有** | vistacast | — |
| EMQX / ThingsBoard | — | — | — | — | ✅ | **私有** | syncrobrain | — |
| media-platform | — | ✅ | — | 复用? | 摄像头 | **候选** | 评估 P3 | — |
| Notify（Email） | ✅ 接入中 | 分散 | 分散 | 分散 | 分散 | **共享包** | `shared/notification` | 一期包 / 后期服务 |
| File | 分散 | 分散 | 分散 | 分散 | 分散 | **候选** | 抽象接口 P3 | — |
| 订阅 / 权益（Trial·Pro·Ultra·企业·License） | 待接入 | 本地 memberTier 等 | **接入中：无 Trial；双身份客户端 + membership/402** | — | — | **共享服务** | `services/entitlement` + `shared/entitlement-client` | LW-ENT |
| 资源 ACL（Casbin） | ✅ / 规划 | ✅ / 规划 | 规划 | 规划 | 规划 | **产品私有** | 各产品 PermissionService | 与 IAM 规范一致 |

## 消费方依赖切换（LW-S2）

| 消费方 | 包 | 当前 | 目标 |
|--------|-----|------|------|
| DataTalk | auth-core | `file:../packages/...` | `@luminary/auth-core@^0.2` |
| BlockyEdu server | auth-core | file: | 版本号 |
| DoerFlow api | auth-core | file: | 版本号 |
| VistaCast server | auth-core | file: | 版本号 |
| iot-gateway | auth-core | file: | 版本号 |
| DataView 等 SPA | auth-react | 复制 idp 模式 | `@luminary/auth-react` |

## Identity 服务迁移（已完成 S0）

| 旧路径 | 新路径 |
|--------|--------|
| `DataLuminary-Platform/scripts/docker-compose.identity-dev.yml` | `LuminaryWorks/identity/docker-compose.yml` |
| `scripts/identity-env.example` | `identity/.env.example` + `registered-apps.json` |
| 各产品文档各自抄写 compose 命令 | 统一指向 `identity/bootstrap.sh` |

DataLuminary 旧 compose **保留至 LW-S2**，标注 deprecated，避免破坏现有脚本。

## Entitlement 服务迁移（规划 LW-ENT）

| 来源 | 目标 |
|------|------|
| VistaRemote `shared/src/billing` + 内存订单 / `User.plan` | 中央 `services/entitlement`；产品侧兼容 `GET /billing/entitlements` |
| BlockyEdu `memberTier` / `code_pro` 等商业判断 | feature code + 中央 subscription/grant；Casbin 保留课程/班级 ACL |
| DataLuminary 高级分析 / 导出 / 容量门禁 | Entitlement Guard + 本地 Space ACL（Casbin） |
| DoerFlow 平台 API / quotas | `platform/membership` + Pro/Ultra/Enterprise；钱包/SIWE 与 Logto 分离；协议费不迁入套餐 |
| 各产品自建 Trial 字段 | 每用户每产品一次 7 天 Trial；`ENTITLEMENT_MODE=shadow_read` → `enforce` |

权威契约与错误码：[subscription-and-entitlement.md](./subscription-and-entitlement.md)。矩阵列暂以五产品表展示；VistaRemote 作为第六产品线在权益规范中单列接入。

## 团队 SDD 义务

1. 跨产品接口变更 → 先改 `LuminaryWorks/spec` 或 `docs/develop/`
2. 共享包 breaking → Semver major + 五消费方 PR
3. 新产品接入生态 → 在 `identity/apps.json` 注册 + 更新本矩阵
4. 商业套餐 / feature code / 权益错误码变更 → 先改 [subscription-and-entitlement.md](./subscription-and-entitlement.md)
