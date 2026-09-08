/**
 * Offline Compose pack: images + compose + install script.
 * Built on a workstation / CI; the target host only docker load + compose up.
 */
export const CONTROL_PLANE_PACK_IMAGES = [
  "postgres:16-alpine",
  "redis:7-alpine",
  "svhd/logto:latest",
  "luminaryworks/auth-gateway:local",
  "luminaryworks/entitlement:local",
  "luminaryworks/control-console:local",
];

export function packName({ target, platform, version }) {
  const safePlatform = String(platform || "linux-arm64").replace(/[^a-z0-9._-]+/gi, "-");
  const safeTarget = String(target || "control-plane").replace(/[^a-z0-9._-]+/gi, "-");
  const safeVersion = String(version || "dev").replace(/[^a-z0-9._-]+/gi, "-");
  return `luminaryworks-${safeTarget}-${safePlatform}-${safeVersion}`;
}

export function dockerPlatformToPackArch(platform) {
  const p = String(platform || "").toLowerCase();
  if (p.includes("arm64") || p.includes("aarch64")) return "linux-arm64";
  if (p.includes("amd64") || p.includes("x86_64")) return "linux-amd64";
  return p.replace("/", "-") || "linux-arm64";
}

export const PACK_PRODUCT_PROJECT = {
  vistacast: "lw-vistacast",
  syncrobrain: "lw-syncrobrain",
  doerflow: "lw-doerflow",
  vistaremote: "lw-vistaremote",
  dataluminary: "lw-dataluminary",
  blockyedu: "lw-blockyedu",
};

/** Expand --target into an ordered list of pack ids. */
export function expandPackTargets(target) {
  const raw = String(target || "control-plane").trim().toLowerCase();
  if (raw === "control-plane") return ["control-plane"];
  if (raw === "products") {
    return Object.keys(PACK_PRODUCT_PROJECT);
  }
  if (raw === "all" || raw === "suite") {
    return ["control-plane", ...Object.keys(PACK_PRODUCT_PROJECT)];
  }
  if (PACK_PRODUCT_PROJECT[raw]) return [raw];
  return [];
}
