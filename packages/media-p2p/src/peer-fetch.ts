import {
  P2P_REALM_ENTFUNHUB,
  P2P_REALM_LUMINARYWORKS,
  swarmIdForSegment,
  type P2pRealm,
} from "./realms";

export type PeerFetch = (
  objectKey: string,
  url: string,
) => Promise<ArrayBuffer | null>;

export type RealmPeerFetchOptions = {
  realm: P2pRealm;
  /** WebSocket signaling base, e.g. wss://p2p.example/ws — must be realm-dedicated. */
  signalingUrl?: string | null;
  /**
   * Optional injected client (tests / native shells).
   * `fetchChunk` must use swarmId as the P2P cache id (full object key), not bare filenames.
   */
  getClient?: () => {
    fetchChunk(signedUrl: string, swarmId: string): Promise<ArrayBuffer>;
  } | null;
};

/**
 * Build a media-player `peerFetch`. Without signaling/client → always null (CDN path).
 * Callers must not point LuminaryWorks and EntFunHub at the same signaling URL.
 */
export function createRealmPeerFetch(options: RealmPeerFetchOptions): PeerFetch {
  const signaling = (options.signalingUrl ?? "").trim();
  return async (objectKey, url) => {
    const client = options.getClient?.() ?? null;
    if (!client && !signaling) return null;
    if (!client) {
      // Signaling URL present but no browser client wired yet → CDN.
      // Operator deploys a realm-dedicated signaling process; client lands in a follow-up.
      void signaling;
      return null;
    }
    const swarmId = swarmIdForSegment(options.realm, objectKey);
    try {
      const buf = await client.fetchChunk(url, swarmId);
      if (!buf || buf.byteLength < 1) return null;
      return buf;
    } catch {
      return null;
    }
  };
}

/** BlockyEdu / LW media-gateway playback only. */
export function createLwPeerFetch(
  options: Omit<RealmPeerFetchOptions, "realm"> = {},
): PeerFetch {
  return createRealmPeerFetch({
    ...options,
    realm: P2P_REALM_LUMINARYWORKS,
  });
}

/**
 * EntFunHub / 极光 stack only — separate signaling, separate realm.
 * Do not pass LuminaryWorks `MEDIA_GATEWAY_*` or LW signaling URLs here.
 */
export function createEfhPeerFetch(
  options: Omit<RealmPeerFetchOptions, "realm"> = {},
): PeerFetch {
  return createRealmPeerFetch({
    ...options,
    realm: P2P_REALM_ENTFUNHUB,
  });
}
