export type PlaybackGrant = {
  sessionId: string;
  playlistUrl: string;
  expiresAt: string;
};

const STORAGE_HOST = /backblazeb2\.com|amazonaws\.com|r2\.cloudflarestorage\.com/i;

export function assertPlaybackGrant(value: unknown): PlaybackGrant {
  if (!value || typeof value !== "object") {
    throw new Error("PLAYBACK_GRANT_INVALID");
  }
  const row = value as Record<string, unknown>;
  const sessionId = typeof row.sessionId === "string" ? row.sessionId : "";
  const playlistUrl = typeof row.playlistUrl === "string" ? row.playlistUrl : "";
  const expiresAt = typeof row.expiresAt === "string" ? row.expiresAt : "";
  if (!sessionId || !playlistUrl || !expiresAt) {
    throw new Error("PLAYBACK_GRANT_INVALID");
  }
  let parsed: URL;
  try {
    parsed = new URL(playlistUrl);
  } catch {
    throw new Error("PLAYBACK_GRANT_INVALID");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("PLAYBACK_GRANT_INVALID");
  }
  if (STORAGE_HOST.test(playlistUrl)) {
    throw new Error("PLAYBACK_URL_REJECTED");
  }
  return { sessionId, playlistUrl, expiresAt };
}
