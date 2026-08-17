# LuminaryWorks 仓库关系

> **品牌与域名**：[domain-and-branding.md](./domain-and-branding.md) · **组织迁移**：[github-org-migration.md](./github-org-migration.md)

## 1. 组织地图

| 组织 / 仓 | 中文名 | 域名 | 类型 | 职责 |
|-----------|--------|------|------|------|
| [LuminaryWorks/LuminaryWorks](https://github.com/LuminaryWorks/LuminaryWorks) | 启明工坊 | luminaryworks.dev | 编排 MetaRepo | 叙事、标准、bootstrap 脚本 |
| [LuminaryWorks/docs](https://github.com/LuminaryWorks/docs) | — | — | 共享 | RsPress 对外宣传 + 开发者门户 |
| [LuminaryWorks/identity](https://github.com/LuminaryWorks/identity) | — | — | 共享 | Logto 统一登录授权 Docker 服务 |
| [LuminaryWorks/shared](https://github.com/LuminaryWorks/shared) | — | — | 共享 | `@luminary/*` pnpm 工作区 |
| [DataLuminary/DataLuminary](https://github.com/DataLuminary/DataLuminary) | 数据明鉴 | dataluminary.dev | 产品 | DataLuminary — BI / DataTalk |
| [BlockyEdu/BlockyEdu](https://github.com/BlockyEdu/BlockyEdu) | 智码工坊 | blockyedu.com | 产品 | BlockyEdu — AI 全民创造 + VibeLearn 企业大学 |
| [DoerFlow/DoerFlow](https://github.com/DoerFlow/DoerFlow) | 智工网 | doerflow.dev | 产品 | DoerFlow — 执行者价值网络 |
| [VistaCast/VistaCast](https://github.com/VistaCast/VistaCast) | 视界云遥 | vistacast.dev | 产品 | VistaCast — AI 摄像头云监控（规划 spec） |
| [VistaRemote/VistaRemote](https://github.com/VistaRemote/VistaRemote) | 视界远程 | — | 产品 | VistaRemote — WebRTC 远程桌面 |
| [SyncroBrain/SyncroBrain](https://github.com/SyncroBrain/SyncroBrain) | 万物智脑 | syncrobrain.com | 产品 | SyncroBrain — 设备 AI OS |

### 1.1 VistaCast 与 VistaRemote

二者**并存**，组织与代码仓分离：

| 品牌 | 组织 | 输入 | 状态 |
|------|------|------|------|
| VistaCast | vistacast | ONVIF/RTSP 摄像头 | 文档 / spec 先行 |
| VistaRemote | VistaRemote | 远程桌面 WebRTC | 已有完整 MetaRepo |

> 历史上 vistacast 组织曾托管远程桌面代码；远程桌面现归 **VistaRemote** 组织维护。VistaCast 为新增 AI 摄像头产品线。

## 2. 本地目录

详见 [local-paths.md](./local-paths.md)。

```text
{workspace}/
├── LuminaryWorks/
├── DataLuminary/
├── BlockyEdu/
├── DoerFlow/
├── VistaCast/               # VistaCast 规划 spec
├── VistaRemote/             # VistaRemote 远程桌面
└── SyncroBrain/
```

初始化：`./init.sh` 或 `.\init.ps1` → `pnpm bootstrap`

## 3. 依赖方向

```text
LuminaryWorks/identity (Logto OIDC)
LuminaryWorks/shared (@luminary/*)
        ▲
        │ npm 依赖 / docker compose
        │
六产品业务仓
        │
        │ HTTP / OIDC / MQTT / WebRTC / 链上
        ▼
六产品互相调用（可选）
```

## 4. 集成矩阵

| 源 → 目标 | 方式 | 场景 |
|-----------|------|------|
| 任意 SPA → identity | OIDC PKCE | 登录 |
| 任意 API → auth-core | JWKS | 验签 |
| 任意 API → PAL | guard | 权限 |
| 任意产品 orchestrator → AI Platform | `@luminaryworks/ai-client` | LLM / embed / BYOK vault / metering |
| SyncroBrain 控制台 → DataLuminary | iframe + JWT | 大屏 |
| VistaCast 告警 → VistaRemote | 事件 / 深链 | 人工远程介入 |
| VistaCast / VistaRemote → DataLuminary | REST / 导出 | 报表大屏 |
| ThingsBoard → EMQX | MQTT | 遥测 |

## 5. 文档归属

| 内容 | 主仓 |
|------|------|
| 域名 / 品牌 / 组织迁移 | **LuminaryWorks/LuminaryWorks** `spec/` |
| 六产品规划摘要 | **LuminaryWorks/LuminaryWorks** `spec/products/` |
| 生态叙事 / 开发者门户 | **LuminaryWorks/docs** |
| VistaCast 规划 spec | `../VistaCast/spec/` + `spec/products/vistacast.md` |
| VistaRemote 实现 spec | `../VistaRemote/spec/` + `spec/products/vistaremote.md` |
| 各产品域规格 | 各产品 `spec/` |
| AI 网关 / Vault / 计量 | **LuminaryWorks/LuminaryWorks** `spec/ai-*.md`；实现仓后期独立服务 |
| 产品领域智能（DataInsight / 教辅 / 录制摘要） | 各产品仓，见 [ai-product-integration.md](./ai-product-integration.md) |

详见 [migration-matrix.md](./migration-matrix.md)。
