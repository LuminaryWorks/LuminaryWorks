import { assertPlaybackGrant, type PlaybackGrant } from "./grant";

type HlsPlayer = {
  destroy(): void;
  currentTime: number;
  on(event: string, listener: () => void): void;
  once?(event: string, listener: () => void): void;
  switchURL?(url: string): void;
  play?(): Promise<void> | void;
  seek?(seconds: number): void;
};

type PlayerCtor = new (config: Record<string, unknown>) => HlsPlayer;

export type ProtectedHlsOptions = {
  el: HTMLElement;
  playlistUrl: string;
  expiresAt?: string;
  poster?: string;
  startTime?: number;
  autoplay?: boolean;
  onProgress?: (seconds: number) => void;
  renew?: () => Promise<PlaybackGrant>;
};

export async function createProtectedHlsPlayer(
  options: ProtectedHlsOptions,
): Promise<{ destroy: () => void; currentTime: () => number; play: () => void }> {
  assertPlaybackGrant({
    sessionId: "pending",
    playlistUrl: options.playlistUrl,
    expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
  });
  const xg = (await import("xgplayer")) as { default: PlayerCtor };
  const hlsMod = (await import("xgplayer-hls")) as { default?: unknown };
  const HlsPlayer = hlsMod.default ?? hlsMod;
  const player = new xg.default({
    el: options.el,
    url: options.playlistUrl,
    plugins: [HlsPlayer],
    poster: options.poster,
    width: "100%",
    height: "100%",
    fluid: true,
    playsinline: true,
    autoplay: options.autoplay ?? false,
    lang: "zh-cn",
    ...(options.startTime != null && options.startTime > 0 ? { startTime: options.startTime } : {}),
  });
  player.on("timeupdate", () => {
    options.onProgress?.(Math.floor(player.currentTime || 0));
  });
  const timer = scheduleRenew(player, options);
  return {
    destroy() {
      if (timer != null) window.clearTimeout(timer);
      player.destroy();
    },
    currentTime: () => player.currentTime || 0,
    play() {
      void player.play?.();
    },
  };
}

function scheduleRenew(player: HlsPlayer, options: ProtectedHlsOptions): number | null {
  if (!options.renew || !options.expiresAt) return null;
  const renewAt = Date.parse(options.expiresAt) - 60_000;
  const delay = Math.max(5_000, renewAt - Date.now());
  return window.setTimeout(() => {
    void options.renew?.()
      .then((next) => {
        const grant = assertPlaybackGrant(next);
        const current = player.currentTime || 0;
        player.switchURL?.(grant.playlistUrl);
        player.once?.("canplay", () => {
          if (Math.abs((player.currentTime || 0) - current) > 1 && player.seek) {
            player.seek(current);
          }
        });
      })
      .catch(() => undefined);
  }, delay);
}
