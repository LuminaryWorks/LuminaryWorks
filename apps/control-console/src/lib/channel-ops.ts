export type ChannelRow = {
  lastTestOk?: boolean | null;
  lastTestEnvironment?: string | null;
  lastTestFingerprint?: string | null;
  environment?: string | null;
  credentialFingerprint?: string | null;
};

export function metadataSaveBody(metadata: Record<string, unknown>): {
  metadata: Record<string, unknown>;
} {
  return { metadata };
}

export function rotateRequestBody(
  credentials: Record<string, string> | undefined,
): { credentials: Record<string, string> } | null {
  if (!credentials) return null;
  const filled = Object.fromEntries(
    Object.entries(credentials).filter(([, value]) => value.trim()),
  );
  return Object.keys(filled).length > 0 ? { credentials: filled } : null;
}

export function channelCanEnable(row: ChannelRow): boolean {
  if (row.lastTestOk !== true) return false;
  if (!row.lastTestEnvironment || row.lastTestEnvironment !== row.environment)
    return false;
  if (
    !row.lastTestFingerprint ||
    row.lastTestFingerprint !== row.credentialFingerprint
  ) {
    return false;
  }
  return true;
}

export function testTone(
  result: { ok: boolean } | null,
): "none" | "ok" | "fail" {
  if (!result) return "none";
  return result.ok ? "ok" : "fail";
}
