# AI Provider 与 Vault

> **状态**：Accepted · **关联**：[ai-platform.md](./ai-platform.md) · [ai-metering.md](./ai-metering.md)

## 1. Provider 目录

连接是类型化对象 `ProviderConnection`，不是单一 `apiKey` 字段。

| `providerType` | 说明 | 凭据形态 |
|----------------|------|----------|
| `deepseek` | DeepSeek OpenAI-compatible | API key + model |
| `qwen` | 阿里千问 / 百炼（OpenAI-compatible） | API key + model；可多区域 Base URL |
| `kimi` | Moonshot Kimi | API key + model；可多区域 Base URL |
| `mimo` | 小米 MiMo | API key + model；可多区域 Base URL |
| `doubao` | 火山方舟 Ark（`/api/v3/chat/completions`） | API key + model（模型名或接入点 ID） |
| `openai` | OpenAI | API key + model |
| `openai-compatible` | 自建 / 代理 / vLLM / Ollama | baseUrl + API key + model |
| `anthropic` | Anthropic Messages | API key + model |
| `gemini` | Google AI Studio | API key + model |
| `vertex` | Vertex AI | service account / ADC（后期） |
| `azure-openai` | Azure OpenAI | endpoint + key + deployment（后期） |
| `bedrock` | AWS Bedrock | IAM / keys（后期） |
| `luminary-managed` | 平台托管额度 | 平台签发的 connection id |

MVP 必须实现：`deepseek`、`qwen`、`kimi`、`mimo`、`doubao`、`openai`、`openai-compatible`、`anthropic`、`gemini`。`vertex` / `azure-openai` / `bedrock` 保留枚举，未实现时返回明确错误。Ollama 走 `openai-compatible` + 本地 baseUrl。

权威目录、建议模型、区域 Base URL、表单默认值与「拉官方模型列表」协议在 **`@luminaryworks/ai-client`**（`./catalog` 子路径可被浏览器引用，不含 Vault）。产品不得再维护一份会分叉的 Provider 枚举或 suggestedModels。

Ant Design 连接表单在 **`@luminaryworks/ai-react`**（`ModelForm`）。登录页继续用无 AntD 的 `@luminaryworks/auth-react` 以保证首屏；AI 设置不是首屏路径，可以依赖 React + AntD。产品只注入 `listModels`（打到本产品 BFF）和可选 `t()` / `secretMode` / `purpose` 插槽，不得再复制一份提供商 / 密钥 / Base URL / 模型下拉。

## 2. ProviderConnection

```typescript
interface ProviderConnection {
  uid: string;
  ownerKind: "user" | "space" | "organization" | "deployment";
  ownerUid: string;
  providerType: string;
  displayName: string;
  baseUrl?: string;
  model: string;
  purpose?: string; // 产品语义：chat / stt / tts 或自由文本
  extra?: Record<string, string>;
  enabled: boolean;
  isDefault?: boolean;
  secretFingerprint?: string; // 后四位，永不回传明文
}
```

- `ownerKind=space`：DataLuminary 空间设置。
- `ownerKind=user`：产品账户页个人 BYOK（如 VibeLearn `/account`）。
- `ownerKind=organization` / `deployment`：租户或私有化部署默认连接。
- `purpose` 由产品解释；连接表结构共享。建议常量：`chat`、`stt`、`tts`。可多选，落库为逗号分隔（如 `chat,stt`）。Catalog 的 `supportedPurposes` 声明该厂商能力；仅 `chat` 的提供商（如 DeepSeek）不展示用途字段，默认 `chat`。

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

## 5. 测试连通与模型列表

- `POST .../providers/test` 用 ephemeral secret 发一条极短 completion。成功不持久化 secret。失败返回提供商错误摘要，不回显完整 key。
- `POST .../providers/models`（或产品等价路径）用 ephemeral 或已保存连接拉官方聊天模型列表。无 Key / 失败时回退 catalog（`source=catalog`）；成功合并 catalog + live（`source=live`）。前端 AutoComplete 只展示服务端返回的 ID，可手填自定义 ID。
- 前端 **不** 直连 Provider 拉模型；Key 只打到产品 BFF，BFF 调用 `@luminaryworks/ai-client` 的 `listProviderModels`。

建议模型 catalog 与 live 过滤规则（去掉 embed / whisper / 图像等）由共享包维护，产品不得各写一份。
