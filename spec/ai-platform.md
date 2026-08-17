# LuminaryWorks AI Platform

> **状态**：Accepted · **决策日**：2026-08-16  
> **关联**：[ai-provider-and-vault.md](./ai-provider-and-vault.md) · [ai-metering.md](./ai-metering.md) · [ai-product-integration.md](./ai-product-integration.md) · [subscription-and-entitlement.md](./subscription-and-entitlement.md) · [identity-and-permissions.md](./identity-and-permissions.md)

## 0. 决策摘要

| # | 决策 |
|---|------|
| D-AI-1 | **中央 AI Platform 只做模型网关**：providers、vault、stream、metering、managed credits。不判断产品资源 ACL。 |
| D-AI-2 | **产品保留领域智能**：DataInsight、教辅编排、录制摘要、IoT 规则、ChainSkill 均留在产品仓。 |
| D-AI-3 | **三层顺序不变**：Logto AuthN → Entitlement（如 `ai.analysis`）→ 产品 Casbin。AI 不拥有 ACL。 |
| D-AI-4 | **BYOK 优先，托管额度后置**：空间/组织配置自有模型连接；后期可买 LuminaryWorks credits。 |
| D-AI-5 | **密钥不进产品业务库明文**：Vault 由 AI Platform（或产品内兼容适配器）持有；聊天记录不回写密钥。 |
| D-AI-6 | **LLM 禁止**：原始 SQL、HTML、自行计算关键数字、持有数据源密码。 |
| D-AI-7 | **产品通过 `@luminaryworks/ai-client` 调用**；未部署中央服务时，产品可用本地 BYOK 适配器（同一契约）。 |

## 1. 定位

LuminaryWorks AI Platform 是六产品共享的 **推理与密钥网关**，不是第二个业务产品。

```text
User → Product UI (unified dialog / copilot)
  → Product orchestrator (intent, tools, domain ACL)
    → Entitlement + Casbin
    → @luminaryworks/ai-client
      → Luminary AI Platform
        → Provider adapters (DeepSeek / OpenAI / Anthropic / Gemini / …)
        → Vault
        → Metering
```

中央平台 **不** 判断 space / dashboard / dataset / device 权限。每次 tool call 由产品重新检查 Casbin。

## 2. 职责边界

| 留在产品 | 交给中央平台 |
|----------|--------------|
| 意图识别、Semantic Layer、分析引擎 | Provider 目录与连接类型 |
| ChartIntent / Artifact 适配 | 密钥 Vault |
| 教辅 / 录制 / IoT / 链上领域工具 | 流式补全、embedding |
| 产品 Casbin 与申请权限 UX | 用量计量、托管额度 |
| 对话持久化（可含业务证据） | 可选托管模型 |

## 3. 产品角色

| 产品 | 产品内保留 | 使用中央平台 |
|------|------------|--------------|
| **DataLuminary** | DataInsight（DataTalk `src/modules/ai/`）、Semantic Layer、Analysis Engine、Chart/Dashboard tools、space ACL | LLM / embed / BYOK / stream / credits |
| **BlockyEdu** | 教辅 prompt、Blockly/Monaco、artifact 校验、sandbox；`ai-bridge` 作 BFF | 替换直连 Gemini/Doubao/DeepSeek；不新建平行 `ai-engine` |
| **VistaRemote** | Edge AI、录制、BullMQ worker、产品 RAG、Python ML、Casbin | 仅 LLM；`@vistaremote/ai` 作适配器；默认不出网 |
| **VistaCast** | ONVIF/RTSP、ONNX/CV、告警（文档先行） | 可选远程推理；不做实时 CV |
| **SyncroBrain** | 设备、MQTT、规则、遥测 hook | LLM/RAG/quota；不自建 IoT LLM 栈 |
| **DoerFlow** | AgentNFT、SkillRegistry、Escrow/Merkle、SIWE | 可选推理 + 预留 `ai.strategy.run`。ChainSkill ≠ AiTool |

## 4. 实施顺序

```text
Ecosystem specs
  → Luminary AI Platform MVP + @luminaryworks/ai-client
  → DataLuminary full AI MVP
  → BlockyEdu migrate
  → VistaRemote migrate
  → SyncroBrain event bridge
  → VistaCast visual
  → DoerFlow settlement loop
```

DataLuminary MVP **不得** 在 DataTalk 另造一套日后必须拆除的 Provider/Vault。适配器契约与中央平台一致：若设置 `LUMINARY_AI_BASE_URL` 则走平台，否则走本地 BYOK。

## 5. 商业与权限

- Free：产品可展示 AI 入口，点击走 **升级 / upsell**，不隐藏入口。
- Pro / Ultra / 企业 / License：用户或组织配置 BYOK；后期可购买托管额度。
- Feature 例：DataLuminary `ai.analysis`（已冻结）。新产品 feature 先写入 [subscription-and-entitlement.md](./subscription-and-entitlement.md)。
- 无资源权限时：产品对话框提示 **申请访问**，不由中央平台代判。

## 6. 安全红线

- 数据源密码、IdP secret、License 私钥不得进入 prompt。
- 图表永远经 **数据集 → QueryService**，禁止 LLM 直连业务库。
- 向量检索只用于指标 / 维度 / 同义词，不存事实表。
- AVA / mcp-server-chart 仅作参考，**不是** 生产依赖。
