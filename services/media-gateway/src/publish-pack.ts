import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parsePackedPlaylist } from "./parse-playlist";

export async function publishPackedDir(input: {
  segmentDir: string;
  originDir: string;
  gatewayUrl: string;
  serviceKey: string;
  tenant: string;
  assetId: string;
  publicSuffix: string;
  keyHex: string;
  title: string;
  licenseCode: string;
  licenseUri: string;
  attribution: string;
  sourceUrl: string;
}): Promise<{ segmentCount: number }> {
  const playlist = await readFile(path.join(input.segmentDir, "index.m3u8"), "utf8");
  const packed = parsePackedPlaylist(playlist);
  const dest = path.join(input.originDir, "hls", input.assetId, "720p");
  await mkdir(dest, { recursive: true });
  const present = new Set<string>();
  for (const file of await readdir(input.segmentDir)) {
    if (!/\.(ts|m4s)$/i.test(file)) continue;
    const name = file.replace(/\.(ts|m4s)$/i, "");
    await copyFile(path.join(input.segmentDir, file), path.join(dest, `${name}.m4s`));
    present.add(name);
  }
  for (const segment of packed.segments) {
    if (!present.has(segment.name)) {
      throw new Error(`missing segment ${segment.name}`);
    }
  }
  const response = await fetch(`${input.gatewayUrl.replace(/\/$/, "")}/v1/assets`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      tenant: input.tenant,
      assetId: input.assetId,
      title: input.title,
      licenseCode: input.licenseCode,
      licenseUri: input.licenseUri,
      attribution: input.attribution,
      sourceUrl: input.sourceUrl,
      publicSuffix: input.publicSuffix,
      keyHex: input.keyHex,
      variants: [
        {
          name: "720p",
          targetDuration: packed.targetDuration,
          segments: packed.segments,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`register failed ${response.status}`);
  }
  return { segmentCount: packed.segments.length };
}
