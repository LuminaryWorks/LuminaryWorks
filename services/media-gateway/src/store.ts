import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type RedisClientType } from "redis";
import type { AssetRecord, MediaStore, SessionRecord } from "./model";

type FileShape = {
  assets: Record<string, AssetRecord>;
  sessions: Record<string, SessionRecord>;
};

function assetKey(tenant: string, assetId: string): string {
  return `${tenant}/${assetId}`;
}

export class FileMediaStore implements MediaStore {
  private chain: Promise<void> = Promise.resolve();
  private data: FileShape = { assets: {}, sessions: {} };

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.data = JSON.parse(await readFile(this.filePath, "utf8")) as FileShape;
    } catch {
      this.data = { assets: {}, sessions: {} };
      await this.persist();
    }
  }

  async putAsset(asset: AssetRecord): Promise<void> {
    await this.mutate(() => {
      this.data.assets[assetKey(asset.tenant, asset.assetId)] = asset;
    });
  }

  async getAsset(tenant: string, assetId: string): Promise<AssetRecord | null> {
    return this.data.assets[assetKey(tenant, assetId)] ?? null;
  }

  async putSession(session: SessionRecord, _ttlSec: number): Promise<void> {
    await this.mutate(() => {
      this.data.sessions[session.sessionId] = session;
    });
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const row = this.data.sessions[sessionId];
    if (!row) return null;
    if (row.exp < Math.floor(Date.now() / 1000)) {
      await this.mutate(() => {
        delete this.data.sessions[sessionId];
      });
      return null;
    }
    return row;
  }

  private async mutate(change: () => void): Promise<void> {
    const run = this.chain.then(async () => {
      change();
      await this.persist();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
  }

  private async persist(): Promise<void> {
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data), { encoding: "utf8", mode: 0o600 });
    await rename(tmp, this.filePath);
  }
}

export class RedisMediaStore implements MediaStore {
  private client: RedisClientType | null = null;

  constructor(private readonly url: string) {}

  async init(): Promise<void> {
    const client = createClient({ url: this.url });
    await client.connect();
    this.client = client as RedisClientType;
  }

  private redis(): RedisClientType {
    if (!this.client) throw new Error("redis is not connected");
    return this.client;
  }

  async putAsset(asset: AssetRecord): Promise<void> {
    await this.redis().set(this.assetKey(asset.tenant, asset.assetId), JSON.stringify(asset));
  }

  async getAsset(tenant: string, assetId: string): Promise<AssetRecord | null> {
    const raw = await this.redis().get(this.assetKey(tenant, assetId));
    return raw ? (JSON.parse(raw) as AssetRecord) : null;
  }

  async putSession(session: SessionRecord, ttlSec: number): Promise<void> {
    await this.redis().set(`mg:session:${session.sessionId}`, JSON.stringify(session), {
      EX: ttlSec,
    });
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.redis().get(`mg:session:${sessionId}`);
    if (!raw) return null;
    const row = JSON.parse(raw) as SessionRecord;
    if (row.exp < Math.floor(Date.now() / 1000)) return null;
    return row;
  }

  private assetKey(tenant: string, assetId: string): string {
    return `mg:asset:${tenant}:${assetId}`;
  }
}
