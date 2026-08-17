import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  completeLocal,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  streamLocal,
  type AiCompleteMessage,
  type AiUsageEvent,
} from "../../../shared/packages/ai-client/src/index";

export interface ProviderConnection {
  uid: string;
  ownerKind: "space" | "organization" | "deployment";
  ownerUid: string;
  providerType: string;
  displayName: string;
  baseUrl?: string;
  model: string;
  enabled: boolean;
  secretFingerprint?: string;
  ciphertext?: string;
}

const connections = new Map<string, ProviderConnection>();
const usageLog: AiUsageEvent[] = [];

@Injectable()
export class AiGatewayService {
  private masterKey(): string {
    const key = process.env.AI_VAULT_MASTER_KEY ?? "";
    if (!key.trim()) throw new Error("AI_VAULT_MASTER_KEY missing");
    return key;
  }

  listConnections() {
    return [...connections.values()].map(({ ciphertext: _c, ...rest }) => rest);
  }

  upsertConnection(input: {
    uid?: string;
    ownerKind: ProviderConnection["ownerKind"];
    ownerUid: string;
    providerType: string;
    displayName: string;
    baseUrl?: string;
    model: string;
    secret?: string;
    enabled?: boolean;
  }): ProviderConnection {
    const uid = input.uid || `conn_${randomUUID()}`;
    const prev = connections.get(uid);
    let ciphertext = prev?.ciphertext;
    let secretFingerprint = prev?.secretFingerprint;
    if (input.secret) {
      ciphertext = encryptSecret(this.masterKey(), input.secret);
      secretFingerprint = fingerprintSecret(input.secret);
    }
    const row: ProviderConnection = {
      uid,
      ownerKind: input.ownerKind,
      ownerUid: input.ownerUid,
      providerType: input.providerType,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      model: input.model,
      enabled: input.enabled ?? true,
      secretFingerprint,
      ciphertext,
    };
    connections.set(uid, row);
    const { ciphertext: _c, ...safe } = row;
    return safe;
  }

  resolveSecret(connectionUid?: string, ephemeral?: { secret: string; providerType: string; model: string; baseUrl?: string }) {
    if (ephemeral?.secret) {
      return {
        providerType: ephemeral.providerType,
        model: ephemeral.model,
        baseUrl: ephemeral.baseUrl,
        secret: ephemeral.secret,
      };
    }
    if (!connectionUid) throw new Error("connectionUid or ephemeral required");
    const row = connections.get(connectionUid);
    if (!row?.ciphertext) throw new Error("connection not found");
    return {
      providerType: row.providerType,
      model: row.model,
      baseUrl: row.baseUrl,
      secret: decryptSecret(this.masterKey(), row.ciphertext),
    };
  }

  recordUsage(event: AiUsageEvent) {
    usageLog.push(event);
    if (usageLog.length > 5000) usageLog.shift();
  }

  listUsage() {
    return usageLog.slice(-200);
  }

  async complete(body: {
    connectionUid?: string;
    ephemeral?: { providerType: string; model: string; secret: string; baseUrl?: string };
    messages: AiCompleteMessage[];
    jsonSchema?: Record<string, unknown>;
    maxTokens?: number;
    productCode?: string;
    subjectId?: string;
  }) {
    const started = Date.now();
    const creds = this.resolveSecret(body.connectionUid, body.ephemeral);
    const result = await completeLocal({
      providerType: creds.providerType,
      baseUrl: creds.baseUrl,
      model: creds.model,
      secret: creds.secret,
      messages: body.messages,
      jsonMode: Boolean(body.jsonSchema),
      maxTokens: body.maxTokens,
    });
    this.recordUsage({
      productCode: body.productCode || "unknown",
      subjectId: body.subjectId || "anonymous",
      providerType: result.providerType,
      model: result.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      billed: "byok",
      latencyMs: Date.now() - started,
      status: "ok",
      traceId: result.traceId,
      at: new Date().toISOString(),
    });
    return result;
  }

  stream(body: {
    connectionUid?: string;
    ephemeral?: { providerType: string; model: string; secret: string; baseUrl?: string };
    messages: AiCompleteMessage[];
  }) {
    const creds = this.resolveSecret(body.connectionUid, body.ephemeral);
    return streamLocal({
      providerType: creds.providerType,
      baseUrl: creds.baseUrl,
      model: creds.model,
      secret: creds.secret,
      messages: body.messages,
    });
  }

  embed(texts: string[]) {
    const dim = 16;
    const vectors = texts.map((t) => {
      const out = new Array<number>(dim).fill(0);
      const h = createHash("sha256").update(t).digest();
      for (let i = 0; i < dim; i++) out[i] = h[i] / 255;
      return out;
    });
    return {
      vectors,
      model: "sha256-16",
      usage: { promptTokens: texts.join(" ").length, completionTokens: 0 },
      traceId: `trc_emb_${randomUUID()}`,
    };
  }
}
