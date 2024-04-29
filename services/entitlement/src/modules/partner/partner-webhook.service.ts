import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { hmacSha256Base64Url, randomToken, safeEqualString } from "../../common/crypto";
import { EntitlementException } from "../../common/errors";
import type { EntitlementConfig } from "../../config/entitlement.config";
import { PartnerEntity } from "../../database/entities/partner.entity";
import { PartnerNonceEntity } from "../../database/entities/partner-nonce.entity";

export interface SignedWebhookHeaders {
  "x-lw-timestamp": string;
  "x-lw-nonce": string;
  "x-lw-signature": string;
  "x-lw-partner": string;
}

/**
 * Partner webhook signing: HMAC-SHA256 over `${timestamp}.${nonce}.${rawBody}`.
 * Signature header value: `v1=<base64url>`.
 */
@Injectable()
export class PartnerWebhookService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PartnerEntity)
    private readonly partners: Repository<PartnerEntity>,
    @InjectRepository(PartnerNonceEntity)
    private readonly nonces: Repository<PartnerNonceEntity>,
  ) {}

  private getConf(): EntitlementConfig {
    return this.config.getOrThrow<EntitlementConfig>("entitlement");
  }

  signOutbound(partner: PartnerEntity, rawBody: string | Buffer): SignedWebhookHeaders {
    if (!partner.webhookSecret) {
      throw new EntitlementException("VALIDATION_ERROR", "Partner webhook secret not configured");
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomToken(16);
    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const sig = this.computeSignature(partner.webhookSecret, timestamp, nonce, body);
    return {
      "x-lw-timestamp": timestamp,
      "x-lw-nonce": nonce,
      "x-lw-signature": `v1=${sig}`,
      "x-lw-partner": partner.code,
    };
  }

  async verifyInbound(input: {
    partnerCode: string;
    timestamp: string | undefined;
    nonce: string | undefined;
    signature: string | undefined;
    rawBody: Buffer | string;
  }): Promise<PartnerEntity> {
    const partner = await this.partners.findOne({
      where: { code: input.partnerCode, active: true },
    });
    if (!partner?.webhookSecret) {
      throw new EntitlementException("UNAUTHORIZED", "Unknown or inactive partner");
    }

    const conf = this.getConf();
    const ts = Number(input.timestamp);
    if (!input.timestamp || !Number.isFinite(ts)) {
      throw new EntitlementException("UNAUTHORIZED", "Missing timestamp");
    }
    const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (skew > conf.partnerReplayWindowSeconds) {
      throw new EntitlementException("UNAUTHORIZED", "Timestamp outside replay window");
    }
    if (!input.nonce || input.nonce.length < 8) {
      throw new EntitlementException("UNAUTHORIZED", "Missing nonce");
    }
    if (!input.signature?.startsWith("v1=")) {
      throw new EntitlementException("UNAUTHORIZED", "Missing or invalid signature");
    }

    const body = typeof input.rawBody === "string" ? input.rawBody : input.rawBody.toString("utf8");
    const expected = this.computeSignature(
      partner.webhookSecret,
      input.timestamp,
      input.nonce,
      body,
    );
    const provided = input.signature.slice("v1=".length);
    if (!safeEqualString(expected, provided)) {
      throw new EntitlementException("UNAUTHORIZED", "Invalid webhook signature");
    }

    const expiresAt = new Date((ts + conf.partnerReplayWindowSeconds) * 1000);
    try {
      await this.nonces.save(
        this.nonces.create({
          partnerId: partner.id,
          nonce: input.nonce,
          expiresAt,
        }),
      );
    } catch {
      throw new EntitlementException("UNAUTHORIZED", "Replay detected (nonce reused)");
    }

    // Opportunistic cleanup of expired nonces
    await this.nonces
      .createQueryBuilder()
      .delete()
      .where("expires_at < now()")
      .execute()
      .catch(() => undefined);

    return partner;
  }

  computeSignature(secret: string, timestamp: string, nonce: string, body: string): string {
    return hmacSha256Base64Url(secret, `${timestamp}.${nonce}.${body}`);
  }

  /** Constant-time compare of hex digests (tests / alternate encodings). */
  safeEqualHmac(a: string, b: string): boolean {
    try {
      const ba = Buffer.from(a);
      const bb = Buffer.from(b);
      if (ba.length !== bb.length) return false;
      return timingSafeEqual(ba, bb);
    } catch {
      return false;
    }
  }

  /** Build HMAC using node crypto directly (used in tests). */
  hmacRaw(secret: string, message: string): Buffer {
    return createHmac("sha256", secret).update(message).digest();
  }
}
