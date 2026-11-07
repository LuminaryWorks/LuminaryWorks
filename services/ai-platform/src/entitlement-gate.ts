import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntitlementClient } from "@luminaryworks/entitlement-client";
import type { AiPlatformConfig } from "./config/ai-platform.config";
import { AiPlatformException } from "./common/errors";
import { ENTITLEMENT_CACHE_TTL_MS, entitlementCacheKey } from "./policy";

interface CacheEntry {
  allowed: boolean;
  expiresAt: number;
}

/**
 * Hosted calls must pass an Entitlement feature check. Fail closed when the
 * service cannot confirm the answer. BYOK callers should not reach this gate.
 */
@Injectable()
export class EntitlementGate {
  private readonly cache = new Map<string, CacheEntry>();
  private client: EntitlementClient | null = null;

  constructor(private readonly config: ConfigService) {}

  async assertManaged(input: {
    productCode?: string;
    subjectId?: string;
    feature?: string;
  }): Promise<void> {
    const productCode = input.productCode?.trim() ?? "";
    const subjectId = input.subjectId?.trim() ?? "";
    const feature = input.feature?.trim() ?? "";
    if (!productCode || !subjectId || !feature) {
      throw new AiPlatformException(
        "ENTITLEMENT_DENIED",
        403,
        "Managed calls require productCode, subjectId, and feature",
      );
    }

    const key = entitlementCacheKey(subjectId, feature, productCode);
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      if (!hit.allowed) {
        throw new AiPlatformException("ENTITLEMENT_DENIED", 403, "Entitlement feature denied");
      }
      return;
    }

    const conf = this.config.getOrThrow<AiPlatformConfig>("aiPlatform");
    if (!conf.entitlementBaseUrl) {
      throw new AiPlatformException("ENTITLEMENT_DENIED", 503, "Entitlement unreachable");
    }

    try {
      const results = await this.getClient(conf).check({
        productCode,
        subjectId,
        features: [{ featureCode: feature }],
      });
      const allowed = results.some((row) => row.featureCode === feature && row.allowed);
      this.cache.set(key, { allowed, expiresAt: Date.now() + ENTITLEMENT_CACHE_TTL_MS });
      if (!allowed) {
        throw new AiPlatformException("ENTITLEMENT_DENIED", 403, "Entitlement feature denied");
      }
    } catch (error) {
      if (error instanceof AiPlatformException) throw error;
      throw new AiPlatformException("ENTITLEMENT_DENIED", 503, "Entitlement unreachable");
    }
  }

  private getClient(conf: AiPlatformConfig): EntitlementClient {
    if (!this.client) {
      this.client = new EntitlementClient({
        baseUrl: conf.entitlementBaseUrl,
        mode: "enforce",
        serviceApiKey: conf.entitlementServiceKey || undefined,
        cacheTtlMs: ENTITLEMENT_CACHE_TTL_MS,
        offlineGraceMs: 0,
      });
    }
    return this.client;
  }
}
