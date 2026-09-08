# 六产品 AI 集成指南

> **状态**：Accepted · **关联**：[ai-platform.md](./ai-platform.md) · [subscription-and-entitlement.md](./subscription-and-entitlement.md)

## 1. 接入清单

每个产品接入时只做这些事：

1. 声明 feature code（写入 Entitlement 目录）。
2. 产品 orchestrator：意图、工具、领域校验。
3. 每次 tool call 重做 Casbin。
4. 通过 `@luminaryworks/ai-client` 调模型（或本地兼容适配器）。
5. 连接设置 UI 使用 `@luminaryworks/ai-react` 的 `ModelForm`（AntD）；不要各产品复制一份提供商表单。
6. 对话与证据留在产品库。
7. 用量写成 `AiUsageEvent`。

不要：在产品里再实现一套 Provider 枚举语义；不要让 LLM 拥有资源删除权；不要把中央平台当 ACL。

## 2. DataLuminary

- 逻辑名：**DataInsight**。物理位置：`DataTalk/src/modules/ai/`。
- 一个统一对话框：配置 Copilot 与数据洞察是同一编排器的两种能力。
- 前端：`DataView` AuthenticatedShell 挂 FloatButton；embed/share/render 不挂。
- 契约：DataLuminary `spec/contracts/ai-chat.md` 等。
- 路线图：DataLuminary `plan/ai-insights-roadmap.md`。
- DataTalk 维护首方 BI `ToolRegistry`，并可按部署配置暴露标准 MCP；DataView
  只负责 Agent Workspace、确认和证据展示，不持有数据源凭据或提供 MCP server。
- 产品内 DataInsight 直接调用 Tool Registry；MCP 只是同一工具核心的外部协议适配，
  不复制查询、数据集、图表或权限逻辑。
- 数据源工具只允许读取授权 schema、受限样本和创建数据集草案；事实分析及图表始终
  经过 dataset → QueryService。
- Semantic RAG 与企业文档 RAG 留在 DataTalk 领域层；中央平台只提供 embedding /
  模型能力和计量，不决定文档、数据集或数据源 ACL。

### 2.1 DataLuminary MCP 边界

DataLuminary MCP 属于产品协议面，不升级为中央 AI Platform 的通用资源代理：

| 责任 | DataTalk | LuminaryWorks AI Platform |
|------|----------|---------------------------|
| BI tool schema / execution | 是 | 否 |
| Datasource / dataset / dashboard Casbin | 是 | 否 |
| 用户确认、幂等、资源审计 | 是 | 否 |
| Provider、Vault、模型路由、stream、embedding、metering | 可本地适配 | 是 |
| 客户 BI 数据或文档正文持久化 | 产品策略 | 否 |

外部 Agent 若通过 DataTalk MCP 调用工具，必须携带 DataTalk 可验证的用户委托 token
或受限 service token。中央 AI Platform 不代签资源权限，也不接收 datasource password。

## 3. BlockyEdu

- 保留教辅 / Blockly / Monaco / artifact 校验 / **口语 Teaching Engine**（策略、Student Model、Lesson Report）。
- `ai-bridge` 继续作编程 BFF；教育口语走 `edu-server/edu-ai`。
- 不新建第二套 `ai-engine` 服务。半双工 STT/TTS 经 ai-client；realtime 为可选 Voice Engine，不是教学大脑。
- ToC 口语默认 managed route；注册 300 秒 / Pro 每月 1800 秒 / 分钟包见 entitlement 目录。冻结的 7 天 Trial **不变**。
- 详见产品仓 `spec/ai-platform-spec.md` 与 `spec/edu-ai-entitlement-spec.md`。

## 4. VistaRemote

- 默认不出网；私有 Ollama/vLLM 优先。
- `@vistaremote/ai` 降为适配器，不再直持第三方 SaaS key（除非组织显式开启）。
- 端侧检测与 Python ML 仍在产品仓。

## 5. VistaCast

- 实时 CV / ONNX 不走 LLM 网关（产品仓 `ai` Edge Runtime）。
- 告警叙事、周报等可选远程推理仍属后期；**不得**写成已上线 LLM 视觉。

## 6. SyncroBrain

- 设备、MQTT、规则引擎不迁出。
- 事件可桥到 DataLuminary 数据集；LLM 摘要走中央平台。
- Entitlement 若缺 `syncrobrain` productCode，先补目录再接线（**仅** AI 计量；`sellable` 仍为 false，不得因此发布 SyncroBrain ToC 价格或 Trial。跨产品 commerce 走 DoerFlow `integration.*`）。详见 [subscription-and-entitlement.md §3.2](./subscription-and-entitlement.md)。

## 7. DoerFlow

- ChainSkill ≠ AiTool。链上结算、Escrow、Merkle 不进模型网关。
- 预留 feature `ai.strategy.run`，未实现前不得当已上线。
