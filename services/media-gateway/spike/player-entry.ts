import { createProtectedHlsPlayer } from "../../../packages/media-player/src/index";

declare global {
  interface Window {
    __played?: boolean;
    __hook?: boolean;
    __ready?: boolean;
    __error?: string;
  }
}

const params = new URLSearchParams(location.search);
const root = document.querySelector<HTMLElement>("#mse");
const button = document.querySelector<HTMLButtonElement>("#play");
if (!root || !button) throw new Error("missing player nodes");

async function markPlaying(play: () => void) {
  button.addEventListener("click", () => play());
  const video = () => root.querySelector("video");
  const timer = window.setInterval(() => {
    const element = video();
    if (element && element.currentTime > 0.2) {
      window.__played = true;
      window.clearInterval(timer);
    }
  }, 200);
}

if (params.get("mode") === "hook") {
  const xg = (await import("xgplayer")) as { default: new (config: Record<string, unknown>) => { play?: () => void; on: (name: string, fn: () => void) => void } };
  const hls = (await import("xgplayer-hls")) as { default?: unknown };
  const HlsPlayer = hls.default ?? hls;
  let hookSeen = false;
  const player = new xg.default({
    el: root,
    url: params.get("playlist") ?? "",
    plugins: [HlsPlayer],
    autoplay: false,
    playsinline: true,
    hls: {
      onPreM3U8Parse(text: string) {
        hookSeen = true;
        window.__hook = true;
        return text.replace(/\.ts/g, ".seg");
      },
    },
  });
  player.on("error", () => {
    if (!hookSeen) window.__error = "hook-missing";
  });
  await markPlaying(() => player.play?.());
  window.__ready = true;
} else {
  const handle = await createProtectedHlsPlayer({
    el: root,
    playlistUrl: params.get("playlist") ?? "",
    autoplay: false,
  });
  await markPlaying(() => handle.play());
  window.__ready = true;
}
