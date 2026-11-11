/**
 * Optional ciphertext segment fetch (CDN ↔ P2P).
 * Manifest and AES key must keep using the player's native requests.
 * Consumers outside LuminaryWorks may reuse this module against their own gateway.
 */

export type SegmentFetcher = {
  /**
   * Load one encrypted media segment.
   * @param url Full signed segment URL (includes exp/sid/sig).
   * @param objectKey Pathname without query — use as P2P / CDN cache id (e.g. `/hls/{assetId}/720p/seg-0000.m4s`).
   */
  fetchSegment(url: string, objectKey: string): Promise<ArrayBuffer>;
};

const SEGMENT_EXT = /\.(m4s|seg|webp|bin)(?:\?|#|$)/i;
const MANIFEST_OR_KEY =
  /\.m3u8(?:\?|#|$)|\/(?:key|keys)(?:\/|\?|#|$)|EXT-X-KEY/i;

export function objectKeyFromSegmentUrl(url: string): string {
  try {
    const base =
      typeof globalThis !== "undefined" && "location" in globalThis
        ? String((globalThis as { location?: { href?: string } }).location?.href ?? "https://invalid.local/")
        : "https://invalid.local/";
    return new URL(url, base).pathname;
  } catch {
    return (url.split("?")[0] ?? url).split("#")[0] ?? url;
  }
}

export function isCiphertextSegmentUrl(url: string): boolean {
  if (!SEGMENT_EXT.test(url)) return false;
  if (MANIFEST_OR_KEY.test(url)) return false;
  return true;
}

/**
 * CDN-only fetcher (signed URL). Uses XHR so it stays safe under
 * `installSegmentFetchInterceptor` (which wraps `fetch`).
 */
export function createCdnSegmentFetcher(): SegmentFetcher {
  return {
    fetchSegment(url: string): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.responseType = "arraybuffer";
        xhr.withCredentials = false;
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.response as ArrayBuffer);
          } else {
            reject(new Error(`segment_http_${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("segment_network"));
        xhr.ontimeout = () => reject(new Error("segment_timeout"));
        xhr.send();
      });
    },
  };
}

/**
 * Try peer/cache first; on failure use the signed CDN URL.
 * `peerFetch` must return ciphertext for `objectKey` only — never share AES keys over P2P.
 */
export function createP2pAwareSegmentFetcher(input: {
  peerFetch: (objectKey: string, url: string) => Promise<ArrayBuffer | null>;
  cdn?: SegmentFetcher;
}): SegmentFetcher {
  const cdn = input.cdn ?? createCdnSegmentFetcher();
  return {
    async fetchSegment(url: string, objectKey: string): Promise<ArrayBuffer> {
      try {
        const fromPeer = await input.peerFetch(objectKey, url);
        if (fromPeer && fromPeer.byteLength > 0) return fromPeer;
      } catch {
        /* fall through to CDN */
      }
      return cdn.fetchSegment(url, objectKey);
    },
  };
}

/**
 * Intercept window.fetch for ciphertext segments only (xgplayer-hls uses fetch).
 * Returns uninstall. Safe no-op when fetch is missing (SSR).
 */
export function installSegmentFetchInterceptor(fetcher: SegmentFetcher): () => void {
  if (typeof globalThis.fetch !== "function") return () => undefined;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!isCiphertextSegmentUrl(url)) {
      return original(input, init);
    }
    const objectKey = objectKeyFromSegmentUrl(url);
    try {
      const buf = await fetcher.fetchSegment(url, objectKey);
      return new Response(buf, {
        status: 200,
        headers: {
          "content-type": "video/mp2t",
          "cache-control": "private, no-store",
        },
      });
    } catch {
      return original(input, init);
    }
  };
  return () => {
    globalThis.fetch = original;
  };
}
