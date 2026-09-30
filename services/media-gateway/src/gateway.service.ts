import { randomBytes } from "node:crypto";
import path from "node:path";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { GatewayConfig } from "./config";
import { GatewayError } from "./gateway.error";
import { assertRedistributable } from "./license";
import type { AssetRecord, MediaStore, SessionRecord, VariantMeta } from "./model";
import { buildMasterPlaylist, buildMediaPlaylist } from "./playlist";
import { isAssetId, isPublicSuffix, isSegmentName, isVariantName } from "./paths";
import { WindowLimiter } from "./rate-limit";
import { FileMediaStore, RedisMediaStore } from "./store";
import { safeEqualSecret, signedUrl, verifySignedRequest } from "./token";

const TENANTS = new Set(["blockyedu", "entfunhub", "vistaremote", "vistacast"]);

export type RegisterBody = {
  tenant?: string;
  assetId?: string;
  title?: string;
  licenseCode?: string;
  licenseUri?: string;
  attribution?: string;
  sourceUrl?: string;
  publicSuffix?: string;
  keyHex?: string;
  variants?: VariantMeta[];
};

@Injectable()
export class GatewayService implements OnModuleInit {
  private readonly store: MediaStore;
  private readonly limiter = new WindowLimiter();

  constructor(readonly config: GatewayConfig) {
    this.store = config.redisUrl
      ? new RedisMediaStore(config.redisUrl)
      : new FileMediaStore(path.join(config.dataDir, "catalog.json"));
  }

  async onModuleInit(): Promise<void> {
    await this.store.init();
  }

  assertServiceKey(authorization: string | undefined): void {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!safeEqualSecret(token, this.config.serviceKey)) {
      throw new GatewayError(401, "UNAUTHORIZED", "service key required");
    }
  }

  async register(body: RegisterBody): Promise<{
    tenant: string;
    assetId: string;
    publicSuffix: string;
    segmentCount: number;
  }> {
    const asset = this.parseAsset(body);
    await this.store.putAsset(asset);
    return {
      tenant: asset.tenant,
      assetId: asset.assetId,
      publicSuffix: asset.publicSuffix,
      segmentCount: asset.variants.reduce((sum, variant) => sum + variant.segments.length, 0),
    };
  }

  async createSession(
    body: { tenant?: string; assetId?: string; subjectId?: string },
    clientIp: string,
  ): Promise<{ sessionId: string; playlistUrl: string; expiresAt: string }> {
    const tenant = body.tenant ?? "";
    const assetId = body.assetId ?? "";
    const subjectId = (body.subjectId ?? "").trim();
    if (!TENANTS.has(tenant) || !isAssetId(assetId) || subjectId.length < 1 || subjectId.length > 200) {
      throw new GatewayError(400, "VALIDATION", "tenant, assetId and subjectId are required");
    }
    if (!this.limiter.allow(`ip:${clientIp}`, this.config.limits.ipPerMin, 60_000)) {
      throw new GatewayError(429, "RATE_LIMITED", "too many playback sessions from this address");
    }
    if (
      !this.limiter.allow(
        `sub:${tenant}:${subjectId}`,
        this.config.limits.subjectPer10Min,
        600_000,
      )
    ) {
      throw new GatewayError(429, "RATE_LIMITED", "too many new playback sessions for this user");
    }
    const asset = await this.requireAsset(tenant, assetId);
    const session = this.newSession(asset, subjectId);
    await this.store.putSession(session, this.config.sessionTtlSec);
    return this.grant(session);
  }

  async renew(
    sessionId: string,
    subjectId: string,
  ): Promise<{ sessionId: string; playlistUrl: string; expiresAt: string }> {
    const session = await this.requireLiveSession(sessionId);
    if (session.subjectId !== subjectId) {
      throw new GatewayError(403, "SUBJECT_MISMATCH", "subject does not match this session");
    }
    if (!this.limiter.allow(`renew:${sessionId}`, this.config.limits.renewPerMin, 60_000)) {
      throw new GatewayError(429, "RATE_LIMITED", "session renewed too often");
    }
    session.exp = this.expiry();
    await this.store.putSession(session, this.config.sessionTtlSec);
    return this.grant(session);
  }

  async masterPlaylist(sessionId: string, query: URLSearchParams): Promise<string> {
    const session = await this.authorizedSession(sessionId, `/v1/playback/${sessionId}/index.m3u8`, query);
    const asset = await this.requireAsset(session.tenant, session.assetId);
    return buildMasterPlaylist({
      gatewayBase: this.config.gatewayBase,
      secret: this.config.signingSecret,
      sessionId: session.sessionId,
      exp: session.exp,
      asset,
    });
  }

  async mediaPlaylist(sessionId: string, variantName: string, query: URLSearchParams): Promise<string> {
    if (!isVariantName(variantName)) throw new GatewayError(404, "VARIANT_NOT_FOUND", "variant not found");
    const path = `/v1/playback/${sessionId}/${variantName}/index.m3u8`;
    const session = await this.authorizedSession(sessionId, path, query);
    const asset = await this.requireAsset(session.tenant, session.assetId);
    const variant = asset.variants.find((item) => item.name === variantName);
    if (!variant) throw new GatewayError(404, "VARIANT_NOT_FOUND", "variant not found");
    return buildMediaPlaylist({
      gatewayBase: this.config.gatewayBase,
      edgeBase: this.config.edgeBase,
      secret: this.config.signingSecret,
      sessionId: session.sessionId,
      exp: session.exp,
      asset,
      variant,
    });
  }

  async readKey(keyId: string, query: URLSearchParams): Promise<Uint8Array> {
    const session = await this.authorizedSession(query.get("sid") ?? "", `/v1/keys/${keyId}`, query);
    if (session.keyId !== keyId) throw new GatewayError(401, "TOKEN_INVALID", "key does not match session");
    if (!this.limiter.allow(`key:${session.sessionId}`, this.config.limits.keyPerMin, 60_000)) {
      throw new GatewayError(429, "RATE_LIMITED", "key fetched too often");
    }
    const asset = await this.requireAsset(session.tenant, session.assetId);
    return hexToBytes(asset.keyHex);
  }

  private async grant(session: SessionRecord) {
    const playlistPath = `/v1/playback/${session.sessionId}/index.m3u8`;
    return {
      sessionId: session.sessionId,
      playlistUrl: await signedUrl(
        this.config.gatewayBase,
        playlistPath,
        this.config.signingSecret,
        session.exp,
        session.sessionId,
      ),
      expiresAt: new Date(session.exp * 1000).toISOString(),
    };
  }

  private async authorizedSession(
    sessionId: string,
    pathname: string,
    query: URLSearchParams,
  ): Promise<SessionRecord> {
    const exp = Number(query.get("exp"));
    const sid = query.get("sid") ?? "";
    const sig = query.get("sig") ?? "";
    if (sid !== sessionId) throw new GatewayError(401, "TOKEN_INVALID", "session mismatch");
    const ok = await verifySignedRequest({
      secret: this.config.signingSecret,
      exp,
      sessionId: sid,
      path: pathname,
      sig,
      maxTtlSec: this.config.sessionTtlSec + 120,
    });
    if (!ok) throw new GatewayError(401, "TOKEN_INVALID", "token invalid or expired");
    return this.requireLiveSession(sessionId);
  }

  private async requireLiveSession(sessionId: string): Promise<SessionRecord> {
    if (!/^[a-f0-9]{32}$/.test(sessionId)) {
      throw new GatewayError(401, "TOKEN_INVALID", "session invalid");
    }
    const session = await this.store.getSession(sessionId);
    if (!session) throw new GatewayError(401, "SESSION_EXPIRED", "session expired");
    return session;
  }

  private async requireAsset(tenant: string, assetId: string): Promise<AssetRecord> {
    const asset = await this.store.getAsset(tenant, assetId);
    if (!asset) throw new GatewayError(404, "ASSET_NOT_FOUND", "asset not found");
    return asset;
  }

  private newSession(asset: AssetRecord, subjectId: string): SessionRecord {
    return {
      sessionId: randomBytes(16).toString("hex"),
      tenant: asset.tenant,
      assetId: asset.assetId,
      subjectId,
      keyId: asset.keyId,
      exp: this.expiry(),
    };
  }

  private expiry(): number {
    return Math.floor(Date.now() / 1000) + this.config.sessionTtlSec;
  }

  private parseAsset(body: RegisterBody): AssetRecord {
    const tenant = body.tenant ?? "";
    const assetId = body.assetId ?? "";
    const licenseCode = body.licenseCode ?? "";
    const publicSuffix = body.publicSuffix ?? ".m4s";
    const keyHex = (body.keyHex ?? "").toLowerCase();
    if (!TENANTS.has(tenant) || !isAssetId(assetId)) {
      throw new GatewayError(400, "VALIDATION", "tenant or assetId is invalid");
    }
    try {
      assertRedistributable(licenseCode);
    } catch {
      throw new GatewayError(400, "LICENSE_NOT_REDISTRIBUTABLE", "license does not allow redistribution");
    }
    if (!isPublicSuffix(publicSuffix)) {
      throw new GatewayError(400, "VALIDATION", "publicSuffix is not allowed");
    }
    if (!/^[0-9a-f]{32}$/.test(keyHex)) {
      throw new GatewayError(400, "VALIDATION", "keyHex must be 32 hex characters");
    }
    for (const field of [body.licenseUri, body.sourceUrl, body.attribution, body.title]) {
      if (!field || field.length > 2000) {
        throw new GatewayError(400, "VALIDATION", "title, license and source are required");
      }
    }
    const variants = body.variants ?? [];
    if (variants.length < 1 || variants.length > 8) {
      throw new GatewayError(400, "VALIDATION", "one to eight variants are required");
    }
    for (const variant of variants) {
      if (!isVariantName(variant.name) || variant.segments.length < 1 || variant.segments.length > 5000) {
        throw new GatewayError(400, "VALIDATION", "variant is invalid");
      }
      for (const segment of variant.segments) {
        if (!isSegmentName(segment.name) || !(segment.duration > 0)) {
          throw new GatewayError(400, "VALIDATION", "segment is invalid");
        }
      }
    }
    return {
      tenant,
      assetId,
      title: body.title ?? "",
      licenseCode,
      licenseUri: body.licenseUri ?? "",
      attribution: body.attribution ?? "",
      sourceUrl: body.sourceUrl ?? "",
      publicSuffix,
      keyId: randomBytes(8).toString("hex"),
      keyHex,
      variants,
    };
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
