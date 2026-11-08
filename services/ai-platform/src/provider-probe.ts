import {
  authHeadersForProvider,
  filterLiveModels,
  parseGeminiModelIds,
  parseOpenAiCompatibleModelIds,
  resolveChatCompletionsUrl,
  resolveModelsUrl,
} from "@luminaryworks/ai-client";
import { readProbeTimeoutMs } from "./probe-rate-limit";
import { redactText } from "./redact";
import { pinProviderEndpoint, runWithPin } from "./ssrf";

export class UpstreamProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamProbeError";
  }
}

/**
 * Short upstream probe used by POST /v1/providers/test.
 * Prefers a models list; falls back to a 1-token completion when the provider
 * has no models URL. The caller redacts and audits. This function never logs.
 */
export async function probeProviderConnection(input: {
  providerType: string;
  baseUrl?: string | null;
  secret: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ model: string }> {
  const timeoutMs = input.timeoutMs ?? readProbeTimeoutMs();
  const modelsUrl = resolveModelsUrl(input.providerType, input.baseUrl);
  const pin = await pinProviderEndpoint(input.providerType, input.baseUrl, modelsUrl ? "models" : "chat");
  return runWithPin(pin, async () => {
    if (modelsUrl) return probeModels(modelsUrl, input, timeoutMs);
    return probeCompletion(input, timeoutMs);
  });
}

async function probeModels(
  url: string,
  input: { providerType: string; secret: string; model?: string },
  timeoutMs: number,
): Promise<{ model: string }> {
  const response = await fetch(url, {
    headers: authHeadersForProvider(input.providerType, input.secret),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  if (!response.ok) throw new UpstreamProbeError(summarizeUpstream(response.status, raw, input.secret));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new UpstreamProbeError("upstream models response was not JSON");
  }
  const ids =
    input.providerType === "gemini" ? parseGeminiModelIds(parsed) : parseOpenAiCompatibleModelIds(parsed);
  const models = filterLiveModels(input.providerType, ids, "chat");
  return { model: models[0] || input.model || input.providerType };
}

async function probeCompletion(
  input: { providerType: string; baseUrl?: string | null; secret: string; model?: string },
  timeoutMs: number,
): Promise<{ model: string }> {
  const url = resolveChatCompletionsUrl(input.providerType, input.baseUrl);
  if (!url) throw new UpstreamProbeError("provider URL is not available");
  const response = await fetch(url, {
    method: "POST",
    headers: authHeadersForProvider(input.providerType, input.secret),
    body: JSON.stringify({
      model: input.model || "ping",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  if (!response.ok) throw new UpstreamProbeError(summarizeUpstream(response.status, raw, input.secret));
  let model = input.model || input.providerType;
  try {
    const parsed = JSON.parse(raw) as { model?: unknown };
    if (typeof parsed.model === "string" && parsed.model.trim()) model = parsed.model.trim();
  } catch {
    model = input.model || input.providerType;
  }
  return { model: redactText(model, [input.secret]) };
}

function summarizeUpstream(status: number, raw: string, secret: string): string {
  let message = `upstream status ${status}`;
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    const fromError = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    const fromBody = typeof fromError === "string" ? fromError : parsed.message;
    if (typeof fromBody === "string" && fromBody.trim()) message = fromBody.trim();
  } catch {
    if (raw.trim()) message = raw.trim().slice(0, 300);
  }
  return redactText(message, [secret]).slice(0, 240);
}
