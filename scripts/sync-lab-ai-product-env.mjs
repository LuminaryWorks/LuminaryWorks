#!/usr/bin/env node
/**
 * Lab helper: copy AI Platform service credential from control-plane.env into
 * product .env files so default AI_MODE=central works without hand-editing.
 *
 * Never overwrites a non-empty LUMINARY_AI_API_KEY unless --force.
 *
 * Usage (from LuminaryWorks repo root):
 *   node scripts/sync-lab-ai-product-env.mjs
 *   node scripts/sync-lab-ai-product-env.mjs --force
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lwRoot = path.resolve(__dirname, "..");
const worksAi = path.resolve(lwRoot, "..");
const force = process.argv.includes("--force");

const controlPlaneEnv = path.join(lwRoot, "deploy/env/control-plane.env");

/** @type {{ file: string; product: string; extras?: Record<string, string> }[]} */
const targets = [
  {
    product: "dataluminary",
    file: path.join(worksAi, "DataLuminary/DataTalk/.env"),
    extras: { AI_MODE: "central" },
  },
  {
    product: "blockyedu",
    file: path.join(worksAi, "BlockyEdu/edu-server/.env"),
    // BlockyEdu uses off|local|central|mock; empty AI_MODE + URL/key → central in luminary-ai.ts
    extras: { AI_MODE: "central" },
  },
  {
    product: "vistacast",
    file: path.join(worksAi, "VistaCast/server/.env"),
    extras: {
      AI_MODE: "central",
      // Platform owns host :13100; standalone API must not bind the same port.
      PORT: "13110",
      // LUMINARY_AI_CONNECTION_UID + LUMINARY_AI_FEATURE filled after seed / settings create.
    },
  },
  {
    product: "vistaremote",
    file: path.join(worksAi, "VistaRemote/ai/.env"),
    extras: {
      PRODUCT_CODE: "vistaremote",
      // LUMINARY_AI_CONNECTION_UID required for platform complete (no body secret).
    },
  },
];

function parseEnv(content) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return map;
}

/**
 * @param {string} content
 * @param {Record<string, string>} updates
 * @param {{ force?: boolean }} opts
 */
function applyUpdates(content, updates, opts = {}) {
  let next = content.endsWith("\n") ? content : `${content}\n`;
  /** @type {string[]} */
  const changed = [];
  for (const [key, value] of Object.entries(updates)) {
    const existing = parseEnv(next).get(key);
    if (existing && !opts.force) {
      continue;
    }
    const assignment = `${key}=${value}`;
    const lineRe = new RegExp(`^#?\\s*${key}\\s*=.*$`, "m");
    if (lineRe.test(next)) {
      next = next.replace(lineRe, assignment);
    } else {
      next = `${next.replace(/\s*$/, "")}\n\n# --- synced by sync-lab-ai-product-env ---\n${assignment}\n`;
    }
    changed.push(key);
  }
  return { next, changed };
}

if (!fs.existsSync(controlPlaneEnv)) {
  console.error(`missing ${controlPlaneEnv}`);
  process.exit(1);
}

const cp = parseEnv(fs.readFileSync(controlPlaneEnv, "utf8"));
const serviceKey =
  cp.get("AI_PLATFORM_SERVICE_API_KEY") ||
  (() => {
    try {
      const raw = cp.get("AI_PLATFORM_SERVICE_CREDENTIALS_JSON");
      if (!raw) return "";
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr[0]?.key ? String(arr[0].key) : "";
    } catch {
      return "";
    }
  })();

if (!serviceKey) {
  console.error("control-plane.env has no AI_PLATFORM_SERVICE_API_KEY (or credentials JSON)");
  process.exit(1);
}

const hostBase = "http://127.0.0.1:13100";
const dockerBase = "http://ai-platform:13100";

console.log(`service key fingerprint=${crypto.createHash("sha256").update(serviceKey).digest("hex").slice(0, 12)}…`);

for (const target of targets) {
  if (!fs.existsSync(target.file)) {
    console.log(`skip ${target.product}: missing ${target.file}`);
    continue;
  }
  const original = fs.readFileSync(target.file, "utf8");
  const updates = {
    LUMINARY_AI_BASE_URL: hostBase,
    LUMINARY_AI_API_KEY: serviceKey,
    ...target.extras,
  };
  // VistaCast compose-on-edge often wants docker DNS; keep host for local pnpm start.
  if (target.product === "vistacast" && /compose|docker/i.test(original)) {
    updates.LUMINARY_AI_BASE_URL = hostBase;
  }
  void dockerBase;
  let { next, changed } = applyUpdates(original, updates, { force });
  // Always migrate VistaCast API off :13100 when pointing at the platform host.
  if (target.product === "vistacast" && parseEnv(next).get("PORT") === "13100") {
    const portFix = applyUpdates(next, { PORT: "13110" }, { force: true });
    next = portFix.next;
    for (const key of portFix.changed) {
      if (!changed.includes(key)) changed.push(key);
    }
  }
  if (changed.length === 0) {
    console.log(`ok ${target.product}: already set`);
    continue;
  }
  fs.writeFileSync(target.file, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  console.log(`updated ${target.product}: ${changed.join(", ")}`);
}

console.log(`\nNext: cd ${lwRoot} && pnpm ai:dev  (AI Platform :13100; needs control-plane DB via pnpm ent:up)`);
console.log(`Host URL=${hostBase}. After seed/settings, set LUMINARY_AI_CONNECTION_UID`);
console.log(`(VistaCast managed also needs LUMINARY_AI_FEATURE). Then restart product APIs.`);
console.log(`VistaCast standalone API listens on :13110 so it does not collide with the platform.`);
