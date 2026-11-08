#!/usr/bin/env node
/**
 * Create or rotate deployment ProviderConnections from a gitignored env file.
 *
 * The platform then reads those rows from the vault. Provider keys do not need
 * to stay in the server environment at runtime.
 *
 *   AI_PLATFORM_SERVICE_API_KEY=... \
 *     node scripts/seed-deployment-connection.mjs --env-file /path/to/.env.ai
 *
 * Optional:
 *   --api-base http://127.0.0.1:13100     (or AI_PLATFORM_BASE_URL)
 *   --owner-uid deployment
 *
 * Recognized keys (values are never printed):
 *   deepseek_api_key, openrouter_api_key, openai_api_key, anthropic_api_key,
 *   gemini_api_key, qwen_api_key, kimi_api_key, mimo_api_key, doubao_api_key
 * Optional per provider: <id>_model, <id>_base_url
 *
 * This script does not open identity/.env.ai unless that path is passed as
 * --env-file. Do not commit the env file.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const PROVIDERS = [
  { id: "deepseek", envKey: "deepseek_api_key", providerType: "deepseek", model: "deepseek-chat" },
  {
    id: "openrouter",
    envKey: "openrouter_api_key",
    providerType: "openai-compatible",
    model: "openai/gpt-4o-mini",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  { id: "openai", envKey: "openai_api_key", providerType: "openai", model: "gpt-4o-mini" },
  { id: "anthropic", envKey: "anthropic_api_key", providerType: "anthropic", model: "claude-haiku-4-5" },
  { id: "gemini", envKey: "gemini_api_key", providerType: "gemini", model: "gemini-2.5-flash" },
  { id: "qwen", envKey: "qwen_api_key", providerType: "qwen", model: "qwen-plus" },
  { id: "kimi", envKey: "kimi_api_key", providerType: "kimi", model: "kimi-k2.6" },
  { id: "mimo", envKey: "mimo_api_key", providerType: "mimo", model: "mimo-v2.5" },
  { id: "doubao", envKey: "doubao_api_key", providerType: "doubao", model: "doubao-seed-1-6-251015" },
];

export function parseDotEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

export function connectionsFromEnv(env) {
  const planned = [];
  for (const provider of PROVIDERS) {
    const secret = env[provider.envKey]?.trim() ?? "";
    if (!secret) continue;
    const model = env[`${provider.id}_model`]?.trim() || provider.model;
    const baseUrl = env[`${provider.id}_base_url`]?.trim() || provider.baseUrl;
    planned.push({
      id: provider.id,
      uid: `conn_deploy_${provider.id}`,
      providerType: provider.providerType,
      displayName: `${provider.id} (deployment)`,
      model,
      ...(baseUrl ? { baseUrl } : {}),
      secret,
    });
  }
  return planned;
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

async function main() {
  const envFile = arg("--env-file");
  if (!envFile) throw new Error("--env-file is required");
  const serviceKey = process.env.AI_PLATFORM_SERVICE_API_KEY?.trim() ?? "";
  if (!serviceKey) throw new Error("AI_PLATFORM_SERVICE_API_KEY is required");
  const apiBase = (arg("--api-base") || process.env.AI_PLATFORM_BASE_URL || "http://127.0.0.1:13100").replace(
    /\/$/,
    "",
  );
  const ownerUid = arg("--owner-uid") || "deployment";
  const text = readFileSync(envFile, "utf8");
  if (text.includes("\uFFFD")) throw new Error("env file is not valid UTF-8");
  const planned = connectionsFromEnv(parseDotEnv(text));
  if (planned.length === 0) throw new Error("no provider keys found");

  let index = 0;
  for (const plan of planned) {
    const response = await fetch(`${apiBase}/v1/providers`, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-service-key": serviceKey,
      },
      body: JSON.stringify({
        uid: plan.uid,
        ownerKind: "deployment",
        ownerUid,
        providerType: plan.providerType,
        displayName: plan.displayName,
        model: plan.model,
        ...(plan.baseUrl ? { baseUrl: plan.baseUrl } : {}),
        secret: plan.secret,
        enabled: true,
        isDefault: index === 0,
        purpose: "chat",
      }),
    });
    const raw = await response.text();
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    if (!response.ok) {
      const code = body?.error?.code ? ` ${body.error.code}` : "";
      throw new Error(`seed ${plan.id} failed status ${response.status}${code}`);
    }
    const fingerprint = typeof body.secretFingerprint === "string" ? body.secretFingerprint : "";
    console.log(
      `updated ${plan.providerType} uid=${body.uid ?? plan.uid} fingerprint=${fingerprint} hasSecret=${body.hasSecret === true}`,
    );
    index += 1;
  }
}

if (process.argv[1] && basename(process.argv[1]) === "seed-deployment-connection.mjs") {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "seed failed";
    console.error(message);
    process.exit(1);
  });
}
