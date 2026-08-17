# AI Provider 与 Vault

> **状态**：Accepted · **关联**：[ai-platform.md](./ai-platform.md) · [ai-metering.md](./ai-metering.md)

## 1. Provider 目录

连接是类型化对象 `ProviderConnection`，不是单一 `apiKey` 字段。

| `providerType` | 说明 | 凭据形态 |
|----------------|------|----------|
| `deepseek` | DeepSeek OpenAI-compatible | API key + model |
| `doubao` | 火山方舟 Ark（`/api/v3/chat/completions`） | API key + model（模型名或接入点 ID） |
| `openai` | OpenAI | API key + model |
| `openai-compatible` | 自建 / 代理 / vLLM | baseUrl + API key + model |
| `anthropic` | Anthropic Messages | API key + model |
| `gemini` | Google AI Studio | API key + model |
| `vertex` | Vertex AI | service account / ADC（后期） |
| `azure-openai` | Azure OpenAI | endpoint + key + deployment（后期） |
| `bedrock` | AWS Bedrock | IAM / keys（后期） |
| `ollama` | 客户本地 Ollama | baseUrl，通常无 key |
| `luminary-managed` | 平台托管额度 | 平台签发的 connection id |

MVP 必须实现：`deepseek`、`doubao`、`openai`、`openai-compatible`、`anthropic`、`gemini`。其余类型保留枚举，未实现时返回明确错误。

## 2. ProviderConnection

```typescript
interface ProviderConnection {
  uid: string;
  ownerKind: "space" | "organization" | "deployment";
  ownerUid: string;
  providerType: string;
  displayName: string;
  baseUrl?: string;
  model: string;
  extra?: Record<string, string>;
  enabled: boolean;
  secretFingerprint?: string; // 后四位，永不回传明文
}
```

写入时只接受 `secret` 一次；读取只返回 fingerprint。轮换 = 覆盖密文。

## 3. Vault

- 算法：AES-256-GCM。
- 主密钥：`AI_VAULT_MASTER_KEY`（32 字节，hex 或 base64）。缺失时拒绝保存密钥。
- 密文格式：`v1:<iv_b64>:<tag_b64>:<ct_b64>`。
- 主密钥只存在于 AI Platform 或产品本地适配器进程，不进 Git、不进聊天、不进前端。
- DataTalk 业务表 **不得** 再存一份明文模型 key。

## 4. 调用契约（`@luminaryworks/ai-client`）

```typescript
interface CompleteChatInput {
  connectionUid?: string;      // 已保存的连接
  ephemeral?: {                // 仅测试连通，不落库
    providerType: string;
    baseUrl?: string;
    model: string;
    secret: string;
  };
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
}

interface CompleteChatResult {
  text: string;
  parsed?: unknown;
  usage: { promptTokens: number; completionTokens: number };
  model: string;
  providerType: string;
}
```

- 未设 `LUMINARY_AI_BASE_URL`：产品本地适配器执行同一接口。
- 已设：HTTP 转发中央平台；产品不解密客户密钥（密钥已在平台 Vault）。

## 5. 测试连通

`POST .../providers/test` 用 ephemeral secret 发一条极短 completion。成功不持久化 secret。失败返回提供商错误摘要，不回显完整 key。
