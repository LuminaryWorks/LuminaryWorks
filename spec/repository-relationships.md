# LuminaryWorks 仓库关系

> **品牌与域名**：[domain-and-branding.md](./domain-and-branding.md) · **组织迁移**：[github-org-migration.md](./github-org-migration.md) · **部署形态**：[composable-deployment.md](./composable-deployment.md)

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
| [VistaCast/VistaCast](https://github.com/VistaCast/VistaCast) | 视界云遥 | vistacast.dev | 产品 | VistaCast — **视觉事件** / AI 摄像头（切片已编码，未打生产 tag） |
| [VistaRemote/VistaRemote](https://github.com/VistaRemote/VistaRemote) | 视界远程 | — | 产品 | VistaRemote — WebRTC **远程桌面** |
| [SyncroBrain/SyncroBrain](https://github.com/SyncroBrain/SyncroBrain) | 万物智脑 | syncrobrain.com | 产品 | SyncroBrain — 设备 AI OS |

### 1.1 VistaCast 与 VistaRemote

二者**并存**，组织与代码仓分离：

| 品牌 | 组织 | 输入 | 状态 |
|------|------|------|------|
| VistaCast | vistacast | ONVIF/RTSP 摄像头 | MetaRepo + M1/M2 切片已编码（stub；未打生产 tag） |
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
├── VistaCast/               # VistaCast MetaRepo
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
        │ HTTP / OIDC / HMAC CloudEvents / MQTT / WebRTC / 链上
        ▼
六产品互相调用（可选；无 runtime import、无共享 DB）
```

### 3.1 联邦式：中央共享契约，不是强制运行时

依赖方向图里的中央部分**全部可选**。六产品都必须能在中央控制面缺席时启动并通过 ready：

| 中央能力 | 单品替代 | 组合部署 |
|----------|----------|----------|
| Identity（Logto） | 客户 OIDC（`identity=external_oidc`）或产品本地目录（`local`，lab） | `identity=central` |
| Entitlement | `entitlement=off`（本地会员事实）或 `offline_license`（离线签名 License） | `shadow_read` → `enforce` |
| AI Platform | `ai=off` 或 `ai=local_byok`（产品自带 BYOK） | `ai=central`（**当前 lab，禁止 pilot/production**） |
| Observability | 关闭 | 可选 profile 汇聚 OpenTelemetry |

部署形态冻结为 `standalone` / `control-plane` / `agent-commerce` / `smart-site` / `air-gapped` 五种，由静态 **Control Manifest**（[`@luminaryworks/control-manifest`](https://github.com/LuminaryWorks/shared/tree/master/packages/control-manifest)）声明并在启动前校验。产品自治边界（独占 DB / 迁移 / Casbin / 领域凭据 / 发布节奏）、`(issuer, sub)` 身份键与显式 org/tenant/resource 绑定、CloudEvents + `traceparent` 契约、降级矩阵与 `production`/`pilot`/`lab`/`stub` 诚实边界见 **[composable-deployment.md](./composable-deployment.md)**。

编排落点：[`deploy/`](../deploy/README.md)（控制面 Compose、env example、参考 manifest、preflight）。

## 4. 集成矩阵

| 源 → 目标 | 方式 | 场景 |
|-----------|------|------|
| 任意 SPA → identity | OIDC PKCE | 登录 |
| 任意 API → auth-core | JWKS | 验签 |
| 产品服务 M2M → DoerFlow API | OIDC client_credentials | audience `https://api.doerflow.local`；scopes `integration.provider.register` / `integration.event.submit` / `integration.callback.read`。无 redirect；secret 不进 Git |
| VistaCast `alert.v1` / SyncroBrain Incident → DoerFlow | REST + HMAC CloudEvents | 策略命中后创建 Task；无 runtime import / 共享 DB；无原始视频 / 人脸模板 / RTSP / TB 凭据 |
| DoerFlow Job invoke / 生命周期回调 → VistaCast / SyncroBrain | REST + HMAC CloudEvents | 签名调用供应方；回调不自动 ack/resolve；SyncroBrain 命令必须 Safety Kernel；VistaCast stub 不可生产变现 |
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
| VistaCast 产品 spec | `../VistaCast/spec/` + `spec/products/vistacast.md` |
| VistaRemote 实现 spec | `../VistaRemote/spec/` + `spec/products/vistaremote.md` |
| 各产品域规格 | 各产品 `spec/` |
| AI 网关 / Vault / 计量 | **LuminaryWorks/LuminaryWorks** `spec/ai-*.md`；实现仓后期独立服务 |
| 产品领域智能（DataInsight / 教辅 / 录制摘要） | 各产品仓，见 [ai-product-integration.md](./ai-product-integration.md) |

详见 [migration-matrix.md](./migration-matrix.md)。
