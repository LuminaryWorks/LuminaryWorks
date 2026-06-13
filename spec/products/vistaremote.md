# VistaRemote 产品规划 · 视界远程

> **品牌**：VistaRemote · **组织**：[github.com/VistaRemote](https://github.com/VistaRemote)  
> **本地路径**：`D:\www\vistaremote`  
> **实现状态**：✅ 已有 WebRTC 远程桌面代码基线

## 1. 定位

**跨平台实时远程桌面控制 + 自托管 AI 录制洞察** — 工控机、边缘网关、IT 桌面、客服远程协助。

| 维度 | 说明 |
|------|------|
| 独立价值 | 私有化远程运维、会话录制、AI 摘要，可脱离 IoT 部署 |
| 生态角色 | **控** — 人工触达现场、远程调试与审计 |
| 受众 | 工控运维、IT 服务商、远程客服、私有化部署客户 |

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

## 6. 相关文档

- 实现仓：`D:\www\vistaremote\spec\`
- 生态：[domain-and-branding.md §4.5](../domain-and-branding.md#45-vistaremote--vistaremote-组织)
