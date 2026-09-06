import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ProviderConnection {
  uid: string;
  ownerKind: "user" | "space" | "organization" | "deployment";
  ownerUid: string;
  providerType: string;
  displayName: string;
  baseUrl?: string;
  model: string;
  enabled: boolean;
  isDefault?: boolean;
  purpose?: string | null;
  extra?: Record<string, string> | null;
  secretFingerprint?: string;
  ciphertext?: string;
}

export function dataDir(): string {
  return process.env.AI_PLATFORM_DATA_DIR?.trim() || join(process.cwd(), "data");
}

function connectionsPath(): string {
  return join(dataDir(), "connections.json");
}

export function loadConnections(): Map<string, ProviderConnection> {
  try {
    const raw = readFileSync(connectionsPath(), "utf8");
    const parsed = JSON.parse(raw) as { items?: ProviderConnection[] };
    const map = new Map<string, ProviderConnection>();
    for (const row of parsed.items ?? []) {
      if (row?.uid) map.set(row.uid, row);
    }
    return map;
  } catch {
    return new Map();
  }
}

export function saveConnections(rows: Iterable<ProviderConnection>): void {
  const file = connectionsPath();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ items: [...rows] }, null, 2)}\n`, { encoding: "utf8" });
  renameSync(tmp, file);
}
