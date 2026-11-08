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
| `openai-compatible` | 自建 / 代理 / 未来统一层 vLLM；Ollama **仅 lab** 或客户主机端侧 | baseUrl + API key + model |
| `anthropic` | Anthropic Messages | API key + model |
| `gemini` | Google AI Studio | API key + model |
| `vertex` | Vertex AI | service account / ADC（后期） |
| `azure-openai` | Azure OpenAI | endpoint + key + deployment（后期） |
| `bedrock` | AWS Bedrock | IAM / keys（后期） |
| `luminary-managed` | 平台托管额度 | 平台签发的 connection id；BlockyEdu ToC 口语默认 |

MVP 必须实现：`deepseek`、`qwen`、`kimi`、`mimo`、`doubao`、`openai`、`openai-compatible`、`anthropic`、`gemini`。`vertex` / `azure-openai` / `bedrock` 保留枚举，未实现时返回明确错误。

**托管默认**：产品早期连接 DeepSeek / OpenAI 等云厂商（或中央网关 BYOK）。`openai-compatible` 保留给代理、客户指定 endpoint、以及未来 **LuminaryWorks 统一自托管** baseUrl——**不是**各产品生产 Compose 默认捆绑 Ollama/vLLM。本机离线实验可用 Ollama（`openai-compatible` + 本地 baseUrl）；不得写入生产默认路径。见 [ai-platform.md](./ai-platform.md) D-AI-9。

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
- `purpose` 由产品解释；连接表结构共享。建议常量：`chat`、`stt`、`tts`、`realtime`。可多选，落库为逗号分隔。Catalog 的 `supportedPurposes` 只声明 **adapter 已接通** 的能力；未实现 STT/TTS 的厂商不得标 stt/tts。
- Live 模型列表必须 **按 purpose 过滤**：chat 排除 whisper/tts/audio；stt/tts 保留语音模型。

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

## 6. AI Platform 连接 API

账户中心（或产品 BFF）用下列路径管理 BYOK。契约名保持稳定。调用者须带 OIDC Bearer 或服务凭证。

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/v1/providers` | 用户 JWT 或服务凭证 | list-mine。用户只看到 `ownerKind=user` 且 owner 为自己，或 `ownerKind=organization` 且 owner 为 token 中的 org。服务凭证看到全部（含 `deployment`）。 |
| `POST` | `/v1/providers` | 同上 | 创建。带已有 `uid` 则整包更新并可轮换 `secret`。 |
| `PATCH` | `/v1/providers/:uid` | 同上 | 部分更新。`secret` 非空则轮换；`enabled` 即启用 / 停用。不能改 owner。 |
| `DELETE` | `/v1/providers/:uid` | 同上 | 删除。不存在为 404 `VALIDATION_ERROR`；越权为 403 `FORBIDDEN`。 |
| `POST` | `/v1/providers/test` | 同上 | 连通性测试。 |
| `POST` | `/v1/providers/models` | 同上 | 模型列表，形状与 `@luminaryworks/ai-react` 的 `listModels` 一致。 |

用户 JWT 不能管理 `deployment` 或 `space`，不能读写、测试或调用他人的 `user` 连接，不能把托管连接用于推理。服务凭证保持原有行为（可管理全部连接，托管推理仍须服务凭证）。

连接响应只含掩码，不含密文：

```json
{
  "uid": "conn_…",
  "ownerKind": "user",
  "ownerUid": "sub",
  "providerType": "deepseek",
  "displayName": "personal",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-chat",
  "enabled": true,
  "hasSecret": true,
  "secretFingerprint": "abcd"
}
```

`secretFingerprint` 为密钥末 4 位。`hasSecret` 表示库中已有密文。

`POST /v1/providers/test` 请求：

```json
{ "connectionUid": "conn_…" }
```

或（不落库）：

```json
{ "ephemeral": { "providerType": "openai", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini", "secret": "sk-…" } }
```

成功 `200`：`{ "ok": true, "model", "latencyMs", "hasSecret": true, "secretFingerprint" }`。上游失败仍为 `200`：`{ "ok": false, "latencyMs", "hasSecret", "secretFingerprint", "error": { "code": "PROVIDER_ERROR", "message" } }`。`message` 已脱敏。SSRF、校验、越权、限流仍返回对应 4xx，而不是 `ok: false`。

`POST /v1/providers/models` 请求字段与 `ListProviderModelsInput` 相同：`providerType`、`baseUrl`、`secret`、`connectionUid`、`purpose`（`chat` / `stt` / `tts`）。响应 `{ "source": "live" | "catalog", "models": string[] }`。无密钥或上游失败时回退 catalog（`source=catalog`）；SSRF 拒绝的 `baseUrl` 不会回退。

生产环境只有这两个路径接受请求体里的一次性密钥。`/v1/chat/complete` 等业务路径仍返回 `EPHEMERAL_NOT_ALLOWED`。

## 7. baseUrl SSRF

创建、更新、测试、拉模型，以及真正发上游请求时都检查 `baseUrl`（未填写时检查该厂商的默认 URL）。

拒绝：非 `http`/`https`、URL 内嵌账号密码、环回、链路本地、RFC1918、组播/保留地址、云元数据地址（含 `169.254.169.254`、`100.100.100.200`），以及解析到这些地址的主机名。先解析 DNS，再把本次请求钉在已检查的地址上，并拒绝重定向，避免 DNS 重绑定。

`AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS=true` 仅供实验和测试放行私网地址。默认关闭。生产不要设置。协议和「禁止内嵌凭据」在开启时仍然生效。

非法 `baseUrl` 返回 `400` `VALIDATION_ERROR`，响应不回显 URL 或密钥。

## 8. 审计、脱敏与探测限额

`connection_audit_events` 记录 `create` / `update` / `delete` / `test`：`actor_sub`、`actor_kind`、`owner_kind`、`owner_uid`、`connection_uid`、`ok`。不写密钥、密文或 baseUrl。

日志与错误响应会去掉 `sk-…`、`Bearer` 和 `key=` 查询参数。探测失败只打一行已脱敏的 `console.warn`。

`POST /v1/providers/test` 与 `POST /v1/providers/models` 使用进程内令牌桶，按 `kind:subjectId` 分桶（多副本不共享，重启即清空）：

| 变量 | 默认 |
|------|------|
| `AI_PLATFORM_PROBE_RATE_CAPACITY` | `20` |
| `AI_PLATFORM_PROBE_RATE_REFILL_PER_SEC` | `0.5` |
| `AI_PLATFORM_PROBE_TIMEOUT_MS` | `4000` |

超出返回 `429` `RATE_LIMITED`。

## 9. 浏览器 CORS 与部署种子

`AI_PLATFORM_CORS_ORIGINS` 为逗号分隔的精确 Origin。空值不返回 CORS 头（生产默认）。`*` 被忽略。匹配的 Origin 可以用 `Authorization: Bearer` 调用平台。预检 `OPTIONS` 在 Origin 合法时返回 `204`。

BYOK（`ownerKind` 为 `user` / `space` / `organization`，以及一次性密钥）不预留钱包额度。`deployment` 与 `luminary-managed` 仍走托管预留。

`services/ai-platform/scripts/seed-deployment-connection.mjs` 从 `--env-file` 指向的 gitignore 文件读取 `deepseek_api_key`、`openrouter_api_key` 等，用 `AI_PLATFORM_SERVICE_API_KEY` 调用 `POST /v1/providers` 写入 `ownerKind=deployment`。脚本不打印密钥，也不会自行打开 `identity/.env.ai`。
