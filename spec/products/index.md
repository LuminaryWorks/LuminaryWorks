# 六产品规划索引

> **品牌决策**：[../domain-and-branding.md](../domain-and-branding.md) · **组织迁移**：[../github-org-migration.md](../github-org-migration.md) · **IAM**：[../identity-and-permissions.md](../identity-and-permissions.md) · **Entitlement**：[../subscription-and-entitlement.md](../subscription-and-entitlement.md) · **支付**：[../payment-platform.md](../payment-platform.md) · **存储/Doris 决策**：[../decisions/2026-09-storage-doris-payment.md](../decisions/2026-09-storage-doris-payment.md) · **法律模板**：[../legal/README.md](../legal/README.md) · **AI**：[../ai-platform.md](../ai-platform.md) · **Notify**：[../notification-service.md](../notification-service.md) · **可组合部署**：[../composable-deployment.md](../composable-deployment.md)

LuminaryWorks（**启明工坊**）生态采用 **House of Brands**：六个产品各自独立品牌与 GitHub 组织（VistaCast / VistaRemote 为两个独立视觉产品线），通过 OIDC / HTTP / MQTT 按需集成。身份统一用 **Logto**（Experience Headless 登录页）；商业套餐 / Trial / License 用中央 **Entitlement**；产品资源权限用 **Casbin**。商业权益**不**进入 JWT。**无永久 Free 档**；适用产品 7 天 Trial（DoerFlow 无 Trial）。VistaCast / SyncroBrain 可在中央目录配置，**就绪前不可售、不发放 Trial**。

## 品牌中英对照

| 英文品牌 | 中文名 | 域名 |
|----------|--------|------|
| LuminaryWorks | 启明工坊 | luminaryworks.dev |
| DataLuminary | 数据明鉴 | dataluminary.dev |
| BlockyEdu | 智码工坊 | blockyedu.com |
| DoerFlow | 智工网 | doerflow.dev |
| **VistaCast** | 视界云遥 | vistacast.dev |
| **VistaRemote** | 视界远程 | （VistaRemote 组织，域名待定） |
| SyncroBrain | 万物智脑 | syncrobrain.com |

## 价值链闭环

```text
      学+创（智码工坊）──► 连（万物智脑）──► 看（数据明鉴）
                                    │
          视（视界云遥 VistaCast）──┤  控（视界远程 VistaRemote）
                                    └──► 赚（智工网）
```

| # | 品牌 | 中文名 | GitHub | 生态角色 | 规划文档 | 编码优先级 |
|---|------|--------|--------|----------|----------|------------|
| 1 | **DataLuminary** | 数据明鉴 | [DataLuminary/DataLuminary](https://github.com/DataLuminary/DataLuminary) | 看 — AI 数据洞察 | [dataluminary.md](./dataluminary.md) | **P0** |
| 2 | **BlockyEdu** | 智码工坊 | [BlockyEdu/BlockyEdu](https://github.com/BlockyEdu/BlockyEdu) | 学+创 — AI 全民创造 + VibeLearn 企业大学私有化 | [blockyedu.md](./blockyedu.md) | **P0** |
| 3 | **DoerFlow** | 智工网 | [DoerFlow/DoerFlow](https://github.com/DoerFlow/DoerFlow) | 赚 — 执行者价值网络 | [doerflow.md](./doerflow.md) | P1 |
| 4 | **VistaCast** | 视界云遥 | [VistaCast/VistaCast](https://github.com/VistaCast/VistaCast) | 视 — AI 摄像头 | [vistacast.md](./vistacast.md) | 🟡 M1/M2 切片已编码；未打生产 tag |
| 5 | **VistaRemote** | 视界远程 | [VistaRemote/VistaRemote](https://github.com/VistaRemote/VistaRemote) | 控 — 远程桌面 | [vistaremote.md](./vistaremote.md) | ✅ |
| 6 | **SyncroBrain** | 万物智脑 | [SyncroBrain/SyncroBrain](https://github.com/SyncroBrain/SyncroBrain) | 连 — 设备 AI OS | [syncrobrain.md](./syncrobrain.md) | P1 |

## 各产品域规格（实现仓）

| 产品 | 中文名 | 主规格路径 |
|------|--------|------------|
| DataLuminary | 数据明鉴 | `DataLuminary/spec/` |
| BlockyEdu | 智码工坊 | `BlockyEdu/spec/` |
| DoerFlow | 智工网 | `DoerFlow/spec/` |
| VistaCast | 视界云遥 | [VistaCast/VistaCast](https://github.com/VistaCast/VistaCast) `spec/` |
| VistaRemote | 视界远程 | `VistaRemote/spec/` |
| SyncroBrain | 万物智脑 | `SyncroBrain/spec/` |

## VistaCast vs VistaRemote

| | VistaCast | VistaRemote |
|---|-----------|-------------|
| 输入 | 固定摄像头 ONVIF/RTSP | 桌面/移动端屏幕 |
| 价值 | AI 自动告警、客流、防盗 | 人工远程操作、录制审计 |
| 合规叙事 | 安防与资产 | 员工效率（敏感，私有化交付） |
| 当前状态 | MetaRepo + 切片已编码（stub / JPEG；未打生产 tag） | 完整 MetaRepo + 子仓 |

## 独立 vs 组合

- **独立**：每个产品可单独部署、单独销售  
- **组合**：SyncroBrain 设备 + VistaCast 摄像头 + DataLuminary 大屏；VistaCast 告警 → VistaRemote 人工介入；智码工坊培养全栈工程师  

生态是**联邦式产品套件**，不是单体：中央共享契约（Identity / Entitlement / 可选 AI），不共享业务库或 Casbin。形态冻结为 `standalone` / `control-plane` / `agent-commerce` / `smart-site` / `air-gapped`，见 [composable-deployment.md](../composable-deployment.md)。

中央目录边界（权威：[subscription-and-entitlement.md §3.2](../subscription-and-entitlement.md)）：

| `productCode` | 可售 Hosted SKU | Trial |
|---------------|-----------------|-------|
| `dataluminary` / `blockyedu` / `vistaremote` | 是 | 7×24h，每用户每产品一次 |
| `doerflow` | 是（Pro / Ultra / Enterprise） | **否** |
| `vistacast` / `syncrobrain` | **否**（可配置，就绪前不可售） | **否** |

**无永久 Free。** 法律工程模板：[legal/README.md](../legal/README.md)。

每个产品摘要都补充同一组边界小节（最小独立依赖 / 可选兄弟产品 / 降级方式 / 数据所有权 / 不得宣称上线的 lab·stub）。下表是索引，细节以各文件为准。

| 产品 | 最小独立依赖 | 关闭兄弟后 | 数据权威 | 不得宣称上线 |
|------|--------------|------------|----------|--------------|
| [DataLuminary](./dataluminary.md) | 自有 PG + BI；身份/权益/AI 均可本地或关闭 | 核心问数与看板仍 `/ready` | 报表 / 看板 / 导出 / embed | 中央 `ai=central`；不得自称 Safety Kernel 或结算权威 |
| [BlockyEdu](./blockyedu.md) | 创造平台与 VibeLearn 均可单独交付 | `smart-site` 中 `required=false` | 课程 / 演练 / 学员 PII | 制造 / 实体 SKU 量产 |
| [DoerFlow](./doerflow.md) | 自有 API / 合约 / 钱包 | 公开市场与链签名仍可用 | 目录 / Job / Receipt / 账本 / Merkle | 公开 commerce 生产 tag；`ai.strategy.run`；**无 Trial** |
| [VistaCast](./vistacast.md) | 自有 PG + ONVIF/RTSP + `cast.*` | 告警闭环不依赖兄弟 | 摄像头 / 视觉事件 / 告警 ack | CV / 人脸 / staff / fall-smoke stub；生产 tag；**中央目录默认可配置但不可售** |
| [VistaRemote](./vistaremote.md) | 自有 PG + WebRTC 远程桌面 | 无摄像头也可远控 | 会话 / 房间 / 录制 / 审计 | SFU 多方媒体 |
| [SyncroBrain](./syncrobrain.md) | Cloud Lite（TB + EMQX）；DoerFlow 默认关 | 设备 OS 仍 `/ready` | 设备 / 遥测 / Incident / Safety Kernel | 全硬件兼容；跨产品 MQTT 生产消费；**中央目录默认可配置但不可售** |
