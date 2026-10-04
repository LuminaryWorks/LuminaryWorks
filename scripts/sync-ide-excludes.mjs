/**
 * Merge ecosystem IDE exclude settings into MetaRepo + product repos.
 *
 * Usage: node scripts/sync-ide-excludes.mjs
 *        node scripts/sync-ide-excludes.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { metaRoot, PRODUCT_REPOS, productDir } from "./lib/workspace.mjs";

const dryRun = process.argv.includes("--dry-run");
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(metaRoot, "tooling/ide/ecosystem-vscode-excludes.json");

const META_EXTRA_WATCH_SEARCH = {
  "website/**": true,
  "share-demo/**": true,
};

const KEYS_TO_REMOVE = [
  "search.useGlobalIgnoreFiles",
  "search.useParentIgnoreFiles",
];

/**
 * Strip full-line // comments and trailing commas (JSONC → JSON).
 * Do not strip block comments — globs like `@types/*` contain `/*`.
 */
function parseJsonc(text) {
  let s = text.replace(/^\uFEFF/, "");
  s = s.replace(/^\s*\/\/.*$/gm, "");
  s = s.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(s);
}

function readJsoncFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return parseJsonc(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, obj) {
  const body = `${JSON.stringify(obj, null, 2)}\n`;
  if (dryRun) {
    console.log(`[dry-run] would write ${filePath}`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, { encoding: "utf8" });
  const buf = fs.readFileSync(filePath);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    throw new Error(`BOM written: ${filePath}`);
  }
  JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`wrote ${filePath}`);
}

function applyTemplate(settings, template, { metaExtras = false } = {}) {
  const next = { ...(settings && typeof settings === "object" ? settings : {}) };

  for (const key of KEYS_TO_REMOVE) {
    delete next[key];
  }

  // Replace exclude maps from the ecosystem template (do not keep stale/corrupt keys).
  next["files.watcherExclude"] = { ...template["files.watcherExclude"] };
  next["files.exclude"] = { ...template["files.exclude"] };
  next["search.exclude"] = { ...template["search.exclude"] };
  next["search.useIgnoreFiles"] = true;

  if (metaExtras) {
    Object.assign(next["files.watcherExclude"], META_EXTRA_WATCH_SEARCH);
    Object.assign(next["search.exclude"], META_EXTRA_WATCH_SEARCH);
  }

  return next;
}

function syncSettingsJson(repoRoot, template, { metaExtras = false } = {}) {
  const filePath = path.join(repoRoot, ".vscode", "settings.json");
  const existing = readJsoncFile(filePath) ?? {};
  const merged = applyTemplate(existing, template, { metaExtras });
  writeJson(filePath, merged);
}

function syncCodeWorkspaces(repoRoot, template, { metaExtras = false } = {}) {
  if (!fs.existsSync(repoRoot)) return;
  for (const name of fs.readdirSync(repoRoot)) {
    if (!name.endsWith(".code-workspace")) continue;
    const filePath = path.join(repoRoot, name);
    const existing = readJsoncFile(filePath);
    if (!existing || typeof existing !== "object") {
      console.warn(`skip unreadable workspace: ${filePath}`);
      continue;
    }
    existing.settings = applyTemplate(existing.settings ?? {}, template, { metaExtras });
    writeJson(filePath, existing);
  }
}

function writeMetaWorkspace(template) {
  const filePath = path.join(metaRoot, "luminaryworks.code-workspace");
  const settings = applyTemplate({}, template, { metaExtras: true });
  const workspace = {
    folders: [
      { name: "LuminaryWorks", path: "." },
      { name: "control-console", path: "apps/control-console" },
      { name: "entitlement", path: "services/entitlement" },
      { name: "ai-platform", path: "services/ai-platform" },
      { name: "notification", path: "services/notification" },
      { name: "media-gateway", path: "services/media-gateway" },
      { name: "shared", path: "shared" },
    ],
    settings,
  };
  writeJson(filePath, workspace);
}

const template = parseJsonc(fs.readFileSync(templatePath, "utf8"));

syncSettingsJson(metaRoot, template, { metaExtras: true });
writeMetaWorkspace(template);
syncCodeWorkspaces(metaRoot, template, { metaExtras: true });

for (const product of PRODUCT_REPOS) {
  const root = productDir(product.dir);
  if (!fs.existsSync(root)) {
    console.warn(`skip missing product: ${root}`);
    continue;
  }
  syncSettingsJson(root, template, { metaExtras: false });
  syncCodeWorkspaces(root, template, { metaExtras: false });
}

console.log(dryRun ? "dry-run done" : "sync:ide-excludes done");
