import type { AssetRecord, VariantMeta } from "./model";
import { containsStorageHost } from "./license";
import { signedUrl } from "./token";

export async function buildMasterPlaylist(input: {
  gatewayBase: string;
  secret: string;
  sessionId: string;
  exp: number;
  asset: AssetRecord;
}): Promise<string> {
  const lines = ["#EXTM3U"];
  for (const variant of input.asset.variants) {
    const bandwidth = variant.bandwidth ?? 800_000;
    const path = `/v1/playback/${input.sessionId}/${variant.name}/index.m3u8`;
    const url = await signedUrl(input.gatewayBase, path, input.secret, input.exp, input.sessionId);
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}`);
    lines.push(url);
  }
  return finish(lines);
}

export async function buildMediaPlaylist(input: {
  gatewayBase: string;
  edgeBase: string;
  secret: string;
  sessionId: string;
  exp: number;
  asset: AssetRecord;
  variant: VariantMeta;
}): Promise<string> {
  const keyPath = `/v1/keys/${input.asset.keyId}`;
  const keyUrl = await signedUrl(
    input.gatewayBase,
    keyPath,
    input.secret,
    input.exp,
    input.sessionId,
  );
  const sharedIv = sharedInitializationVector(input.variant);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(input.variant.targetDuration))}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXT-X-KEY:METHOD=AES-128,URI="${keyUrl}"${sharedIv ? `,IV=0x${sharedIv}` : ""}`,
  ];
  for (const segment of input.variant.segments) {
    if (!sharedIv && segment.iv) {
      lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="${keyUrl}",IV=0x${segment.iv}`);
    }
    lines.push(`#EXTINF:${segment.duration.toFixed(3)},`);
    const objectPath = `/hls/${input.asset.assetId}/${input.variant.name}/${segment.name}${input.asset.publicSuffix}`;
    lines.push(
      await signedUrl(input.edgeBase, objectPath, input.secret, input.exp, input.sessionId),
    );
  }
  lines.push("#EXT-X-ENDLIST");
  return finish(lines);
}

function sharedInitializationVector(variant: VariantMeta): string | undefined {
  const values = new Set(variant.segments.map((segment) => segment.iv).filter(Boolean));
  if (values.size !== 1) return undefined;
  return [...values][0];
}

function finish(lines: string[]): string {
  const text = `${lines.join("\n")}\n`;
  if (containsStorageHost(text)) {
    throw new Error("PLAYLIST_LEAKED_STORAGE_HOST");
  }
  return text;
}
