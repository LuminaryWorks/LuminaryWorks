import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./connection-store";

export interface TtsCacheEntry {
  audioBase64: string;
  mime: string;
}

function cacheDir(): string {
  return join(dataDir(), "tts-cache");
}

export function readTtsCache(key: string): TtsCacheEntry | null {
  try {
    const raw = readFileSync(join(cacheDir(), `${key}.json`), "utf8");
    const parsed = JSON.parse(raw) as TtsCacheEntry;
    if (!parsed?.audioBase64 || !parsed.mime) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeTtsCache(key: string, entry: TtsCacheEntry): void {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.json`), `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
}
