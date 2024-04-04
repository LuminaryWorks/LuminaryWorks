# LuminaryWorks 仓库关系

## 1. 组织地图

| 组织 / 仓 | 类型 | 职责 |
|-----------|------|------|
| [LuminaryWorks/LuminaryWorks](https://github.com/LuminaryWorks/LuminaryWorks) | 编排 MetaRepo | 叙事、标准、bootstrap 脚本 |
| [LuminaryWorks/docs](https://github.com/LuminaryWorks/docs) | 共享 | RsPress 对外宣传 + 开发者门户 |
| [LuminaryWorks/identity](https://github.com/LuminaryWorks/identity) | 共享 | Logto 统一登录授权 Docker 服务 |
| [LuminaryWorks/shared](https://github.com/LuminaryWorks/shared) | 共享 | `@luminary/*` pnpm 工作区 |
| [DataLuminary/DataLuminary-Platform](https://github.com/DataLuminary/DataLuminary-Platform) | 产品 | BI / DataTalk |
| [BlockyEdu/VibeEdu](https://github.com/BlockyEdu/VibeEdu) | 产品 | AI 教育 |
| [AgentSkillMesh/VibeAgent](https://github.com/AgentSkillMesh/VibeAgent) | 产品 | 链上 Agent 市场 |
| [VistaRemote/vibeCode](https://github.com/VistaRemote) | 产品 | 远程运维 |
| [LuminaryIoTChain/LuminaryIoTChain](https://github.com/LuminaryIoTChain/LuminaryIoTChain) | 产品 | IoT PaaS |

## 2. 本地目录

```text
D:\www\LuminaryWorks\           # MetaRepo（本仓）
├── docs/        → 独立 git
├── identity/    → 独立 git
└── shared/      → 独立 git
D:\www\DataLuminary\DataLuminary-Platform\
D:\www\BlockyEdu\VibeEdu\
D:\www\AgentSkillMesh\VibeAgent\
D:\www\VistaRemote\
D:\www\LuminaryIoTChain\
```

初始化：`./init.sh` 或 `.\init.ps1` → `pnpm bootstrap`

## 3. 依赖方向

```text
LuminaryWorks/identity (Logto OIDC)
LuminaryWorks/shared (@luminary/*)
        ▲
        │ npm 依赖 / docker compose
        │
五产品业务仓
        │
        │ HTTP / OIDC / MQTT / WebRTC / 链上
        ▼
五产品互相调用（可选）
```

## 4. 集成矩阵

| 源 → 目标 | 方式 | 场景 |
|-----------|------|------|
| 任意 SPA → identity | OIDC PKCE | 登录 |
| 任意 API → auth-core | JWKS | 验签 |
| 任意 API → PAL | guard | 权限 |
| iot-console → DataTalk | iframe + JWT | 大屏 |
| ThingsBoard → EMQX | MQTT | 遥测 |

## 5. 文档归属

| 内容 | 主仓 |
|------|------|
| 生态叙事 / 开发者门户 | **LuminaryWorks/docs** |
| 生态重构 / 迁移矩阵 | **LuminaryWorks/LuminaryWorks** `spec/` |
| IdP + PAL 详细规格 | DataLuminary `spec/`（逐步链接化） |
| 各产品域规格 | 各产品 `spec/` |

详见 [migration-matrix.md](./migration-matrix.md)。
