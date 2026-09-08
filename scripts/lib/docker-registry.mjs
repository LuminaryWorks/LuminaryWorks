/**
 * Docker Hub reachability and China-mainland pull fallback.
 *
 * Probe the *official* registry (not `docker pull`, which may already use a
 * daemon mirror). 401 on /v2/ means Hub is reachable (auth required).
 */
export const DOCKER_HUB_PROBE_URL = "https://registry-1.docker.io/v2/";
export const CN_DOCKER_MIRROR = "https://docker.m.daocloud.io";

export function classifyHubHttpStatus(httpStatus) {
  const code = Number(httpStatus);
  if (code === 200 || code === 401) {
    return { ok: true, reason: "reachable", status: code };
  }
  if (!Number.isFinite(code) || code === 0) {
    return { ok: false, reason: "network", status: 0 };
  }
  return { ok: false, reason: `http_${code}`, status: code };
}

/**
 * Rewrite a Docker Hub image to a pull-through mirror, then tag back to Hub name.
 * Leaves GHCR / Quay / already-mirrored refs unchanged.
 */
export function hubMirrorImage(image, mirrorHost = "docker.m.daocloud.io") {
  const host = String(mirrorHost)
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
  const raw = String(image || "").trim();
  if (!raw || !host) return raw;

  const { name, tag, digest } = splitImageRef(raw);
  const first = name.split("/")[0];
  if (first === host) return raw;
  if (first.includes(".") || first.includes(":")) return raw;

  const mirroredName = name.includes("/") ? `${host}/${name}` : `${host}/library/${name}`;
  if (digest) return `${mirroredName}@${digest}`;
  if (tag) return `${mirroredName}:${tag}`;
  return mirroredName;
}

export function splitImageRef(image) {
  const raw = String(image || "").trim();
  const at = raw.indexOf("@");
  if (at > 0) {
    return { name: raw.slice(0, at), tag: "", digest: raw.slice(at + 1) };
  }
  const slash = raw.lastIndexOf("/");
  const colon = raw.lastIndexOf(":");
  if (colon > slash) {
    return { name: raw.slice(0, colon), tag: raw.slice(colon + 1), digest: "" };
  }
  return { name: raw, tag: "", digest: "" };
}

export function shouldPullFromHub(image) {
  const raw = String(image || "").trim();
  if (!raw) return false;
  const { name } = splitImageRef(raw);
  const first = name.split("/")[0];
  if (first.includes(".") || first.includes(":")) return false;
  if (raw.startsWith("luminaryworks/")) return false;
  if (/:(local|dev|core|acceptance)(-|$)/.test(raw)) return false;
  return true;
}

export function collectComposeVars(text) {
  const keys = new Set();
  const src = String(text || "");
  for (const match of src.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::[^}]*)?\}/g)) {
    keys.add(match[1]);
  }
  return [...keys].sort();
}

/** Keys that Compose will refuse to parse unless set (`${VAR:?...}`). */
export function collectRequiredComposeVars(text) {
  const keys = new Set();
  const src = String(text || "");
  for (const match of src.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?[^}]*\}/g)) {
    keys.add(match[1]);
  }
  return [...keys].sort();
}
