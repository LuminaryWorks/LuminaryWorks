# VistaRemote 产品规划 · 视界远程

> **品牌**：VistaRemote · **组织**：[github.com/VistaRemote](https://github.com/VistaRemote)  
> **本地路径**：`../VistaRemote`（相对本仓）  
> **实现状态**：✅ 已有 WebRTC 远程桌面代码基线

## 1. 定位

**跨平台实时远程桌面控制 + 自托管 AI 录制洞察** — 工控机、边缘网关、IT 桌面、客服远程协助。

| 维度 | 说明 |
|------|------|
| 独立价值 | 私有化远程运维、会话录制、AI 摘要，可脱离 IoT 部署 |
| 生态角色 | **控** — 人工触达现场、远程调试与审计 |
| 受众 | 工控运维、IT 服务商、远程客服、私有化部署客户 |
| 品牌主色 | `#1677ff`（对齐 [shared/brand](../../shared/brand/)；Logo SVG `#0078FF` 同源） |

与 **[VistaCast](./vistacast.md)**（AI 摄像头云监控）**并存**：VistaRemote 不做固定摄像头 AI 分析；VistaCast 不做远程桌面会话。

## 2. 核心能力

- WebRTC 低延迟远程桌面（Desktop / Mobile / Web）
- 会话录制与自托管存储
- AI Worker：摘要、异常检测、效率报告（BullMQ + LLM）
- 管理台：配对、会话、审计、PAL 权限
- 可选 `@luminaryworks/auth-core` 统一登录

## 3. 子仓（MetaRepo 编排）

| 模块 | 仓库 | 说明 |
|------|------|------|
| MetaRepo | `vibeCode` | Spec、init、编排 |
| API | `server` | NestJS 信令与 REST |
| Web | `web` | Client + Admin |
| Desktop | `desktop` | Electron Agent |
| Mobile | `mobile` | RN 主控端 |
| AI | `ai` | BullMQ Worker |
| Shared | `shared` | 协议与 Zod |
| Docs | `docs` | Rspress |
| Deploy | `deploy` | Docker Compose |

## 4. 兄弟产品集成

| 产品 | 场景 |
|------|------|
| SyncroBrain | 设备远程维护、固件调试 |
| DataLuminary | 运维报表、会话审计大屏 |
| DoerFlow | Worker 端远程调试 |
| BlockyEdu | WebRTC 远程运维实验 |
| VistaCast | 摄像头告警 → 可选一键远程介入 |

## 5. 技术栈

WebRTC · NestJS · TypeORM · PostgreSQL · React / Electron / RN · Redis

## 6. 身份 · 权益 · 资源权限

接入顺序：**Logto AuthN → 中央 Entitlement → Casbin / ABAC 资源 ACL**。权威规范：[subscription-and-entitlement.md](../subscription-and-entitlement.md)、[identity-and-permissions.md](../identity-and-permissions.md)。

| 层 | VistaRemote 要点 |
|----|------------------|
| 身份 | 可选 `@luminaryworks/auth-core` 统一登录；本地 profile 映射 Logto `sub` |
| 权益 | 以 `shared/src/billing` feature catalog 为迁移基线；中央适配后保持 `GET /billing/entitlements` 与多端 DTO 兼容；档位对齐 `trial` / `pro` / `ultra` / `enterprise` |
| 门禁 | SFU、AI、录制、批量远控、`device.limit` 配额走 Entitlement；设备 / 会话 / 文件归属仍 Casbin/ABAC |
| 私有化 | 签名 License 授予合同能力；**不**关闭身份校验或资源 ACL |
| 迁移 | 内存订单与 `User.plan` / `trialEndsAt` / `planExpiresAt` → 中央；shadow-read 后停本地会员主写；Trial T-3 / 到期通知接邮件、站内 SSE、Push |

### 6.1 产品接线（已落地）

| 仓 | 集成 |
|----|------|
| `server` | `@luminaryworks/entitlement-client`；`ENTITLEMENT_MODE=off\|shadow_read\|enforce`；适配既有 `EntitlementService`；`GET /api/v1/billing/entitlements` DTO 兼容；org/member/seat 表 + Logto `logtoOrgId`；`scripts/migrate-legacy-billing.mjs` |
| `shared` | feature catalog + Ultra SKU + `effectivePlan` / quotas 可选字段；legacy gate ↔ `ENTITLEMENT_*` 映射 |
| `web` client/admin | Trial/Pro/Ultra/Enterprise UX；402 升级提示；Admin 套餐调整 |
| `desktop` / `mobile` | 仍消费 `GET /billing/entitlements`；展示 `effectivePlan` 与 402 文案 |

## 7. 相关文档

- 实现仓：`../VistaRemote/spec/`
- 生态：[domain-and-branding.md §4.5](../domain-and-branding.md#45-vistaremote--vistaremote-组织)
- 权益：[subscription-and-entitlement.md](../subscription-and-entitlement.md)
