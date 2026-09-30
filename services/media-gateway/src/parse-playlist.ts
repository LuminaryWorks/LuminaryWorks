export type PackedSegment = {
  name: string;
  duration: number;
  iv?: string;
};

export function parsePackedPlaylist(text: string): {
  targetDuration: number;
  segments: PackedSegment[];
} {
  if (!text.includes("#EXTM3U")) throw new Error("not a playlist");
  let targetDuration = 6;
  let iv: string | undefined;
  let duration = 0;
  const segments: PackedSegment[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDuration = Number(line.split(":")[1]) || targetDuration;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      const match = /IV=0x([0-9A-Fa-f]+)/.exec(line);
      if (match) iv = match[1].toLowerCase();
    }
    if (line.startsWith("#EXTINF:")) {
      duration = Number(line.slice("#EXTINF:".length).split(",")[0]) || 0;
    }
    if (line && !line.startsWith("#")) {
      const name = (line.split("/").pop() ?? "").replace(/\.(ts|m4s|seg)$/i, "");
      if (!name) continue;
      segments.push({ name, duration: duration || targetDuration, iv });
    }
  }
  if (segments.length < 1) throw new Error("playlist has no segments");
  return { targetDuration, segments };
}
