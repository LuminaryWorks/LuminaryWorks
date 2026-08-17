# 六产品 AI 集成指南

> **状态**：Accepted · **关联**：[ai-platform.md](./ai-platform.md)

## 1. 接入清单

每个产品接入时只做这些事：

1. 声明 feature code（写入 Entitlement 目录）。
2. 产品 orchestrator：意图、工具、领域校验。
3. 每次 tool call 重做 Casbin。
4. 通过 `@luminaryworks/ai-client` 调模型（或本地兼容适配器）。
5. 对话与证据留在产品库。
6. 用量写成 `AiUsageEvent`。

不要：在产品里再实现一套 Provider 枚举语义；不要让 LLM 拥有资源删除权；不要把中央平台当 ACL。

## 2. DataLuminary

- 逻辑名：**DataInsight**。物理位置：`DataTalk/src/modules/ai/`。
- 一个统一对话框：配置 Copilot 与数据洞察是同一编排器的两种能力。
- 前端：`DataView` AuthenticatedShell 挂 FloatButton；embed/share/render 不挂。
- 契约：DataLuminary `spec/contracts/ai-chat.md` 等。
- 路线图：DataLuminary `plan/ai-insights-roadmap.md`。

## 3. BlockyEdu

- 保留教辅 / Blockly / Monaco / artifact 校验。
- `ai-bridge` 继续作 BFF，底层改为 ai-client。
- 不新建第二套 `ai-engine` 服务。
- 详见产品仓 `spec/ai-platform-spec.md` 边界节。

## 4. VistaRemote

- 默认不出网；私有 Ollama/vLLM 优先。
- `@vistaremote/ai` 降为适配器，不再直持第三方 SaaS key（除非组织显式开启）。
- 端侧检测与 Python ML 仍在产品仓。

## 5. VistaCast

- 实时 CV / ONNX 不走 LLM 网关。
- 告警叙事、周报等可选远程推理，仍属 D0/文档阶段。

## 6. SyncroBrain

- 设备、MQTT、规则引擎不迁出。
- 事件可桥到 DataLuminary 数据集；LLM 摘要走中央平台。
- Entitlement 若缺 `syncrobrain` productCode，先补目录再接线。

## 7. DoerFlow

- ChainSkill ≠ AiTool。链上结算、Escrow、Merkle 不进模型网关。
- 预留 feature `ai.strategy.run`，未实现前不得当已上线。
