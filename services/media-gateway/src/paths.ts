export const PUBLIC_SUFFIXES = [".m4s", ".seg", ".webp", ".bin"] as const;
export type PublicSuffix = (typeof PUBLIC_SUFFIXES)[number];

const ASSET = /^[a-z0-9][a-z0-9-]{0,80}$/;
const VARIANT = /^[a-z0-9][a-z0-9-]{0,32}$/;
const SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;

export function isPublicSuffix(value: string): value is PublicSuffix {
  return (PUBLIC_SUFFIXES as readonly string[]).includes(value);
}

/** Map a public edge path to the canonical object key. Query strings are ignored by the caller. */
export function canonicalObjectKey(pathname: string): string | null {
  const match = pathname.match(/^\/hls\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const [, assetId, variant, file] = match;
  if (!ASSET.test(assetId) || !VARIANT.test(variant)) return null;
  const suffix = PUBLIC_SUFFIXES.find((item) => file.endsWith(item));
  if (!suffix) return null;
  const base = file.slice(0, -suffix.length);
  if (!SEGMENT.test(base)) return null;
  return `hls/${assetId}/${variant}/${base}.m4s`;
}

export function isAssetId(value: string): boolean {
  return ASSET.test(value);
}

export function isVariantName(value: string): boolean {
  return VARIANT.test(value);
}

export function isSegmentName(value: string): boolean {
  return SEGMENT.test(value);
}
