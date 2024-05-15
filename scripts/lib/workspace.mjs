/**
 * Cross-platform workspace layout for LuminaryWorks scripts.
 *
 * Layout: {workspace}/LuminaryWorks sits beside product MetaRepos.
 * Never hardcode D:\www / C:\www / ~/www.
 *
 * Directory names are PascalCase (case-sensitive on macOS/Linux).
 * Lookup is case-insensitive so older Windows clones still resolve.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/** LuminaryWorks MetaRepo root (this repo). */
export const metaRoot = path.resolve(thisDir, "..", "..");

/** Parent of LuminaryWorks — sibling product MetaRepos live here. */
export const workspaceRoot = path.resolve(metaRoot, "..");

/**
 * Product MetaRepos beside LuminaryWorks.
 * `key` is the lowercase product code (entitlement / docs); `dir` is the folder name.
 */
export const PRODUCT_REPOS = [
  {
    key: "dataluminary",
    dir: "DataLuminary",
    org: "DataLuminary",
    repo: "DataLuminary",
    required: true,
  },
  {
    key: "blockyedu",
    dir: "BlockyEdu",
    org: "BlockyEdu",
    repo: "BlockyEdu",
    required: true,
  },
  {
    key: "doerflow",
    dir: "DoerFlow",
    org: "DoerFlow",
    repo: "DoerFlow",
    required: true,
  },
  {
    key: "vistaremote",
    dir: "VistaRemote",
    org: "VistaRemote",
    repo: "VistaRemote",
    required: true,
  },
  {
    key: "vistacast",
    dir: "VistaCast",
    org: "VistaCast",
    repo: "VistaCast",
    required: false,
  },
  {
    key: "syncrobrain",
    dir: "SyncroBrain",
    org: "SyncroBrain",
    repo: "SyncroBrain",
    required: true,
  },
];

export function sshRemote(org, repo) {
  return `git@github.com:${org}/${repo}.git`;
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
}

/**
 * Join segments under {workspace}/, matching each segment case-insensitively.
 * If a segment is missing, continues with the canonical (PascalCase) name so
 * callers can still Test-Path / existsSync.
 */
export function resolveWorkspacePath(...segments) {
  let current = workspaceRoot;
  for (const seg of segments) {
    if (!seg) continue;
    const exact = path.join(current, seg);
    if (fs.existsSync(exact)) {
      current = exact;
      continue;
    }
    const found = listDirs(current).find(
      (e) => e.name.toLowerCase() === String(seg).toLowerCase(),
    );
    current = found ? path.join(current, found.name) : exact;
  }
  return current;
}

export function productDir(keyOrDir) {
  const needle = String(keyOrDir).toLowerCase();
  const p = PRODUCT_REPOS.find((x) => x.key === needle || x.dir.toLowerCase() === needle);
  return resolveWorkspacePath(p ? p.dir : keyOrDir);
}

export function productByKey(key) {
  const needle = String(key).toLowerCase();
  return PRODUCT_REPOS.find((x) => x.key === needle || x.dir.toLowerCase() === needle);
}

/** Roots used by ecosystem-wide walkers (encoding, node24 lock, etc.). */
export function ecosystemRoots({ includeWebsite = false } = {}) {
  const roots = [
    metaRoot,
    path.join(metaRoot, "docs"),
    path.join(metaRoot, "identity"),
    path.join(metaRoot, "shared"),
    path.join(metaRoot, "services"),
  ];
  for (const p of PRODUCT_REPOS) {
    roots.push(productDir(p.dir));
  }
  if (includeWebsite) {
    roots.push(resolveWorkspacePath("DataLuminary", "website"));
  }
  return roots;
}

export function parseGithubRemote(url) {
  if (!url) return null;
  const s = String(url).trim().replace(/\.git$/i, "");
  const m =
    s.match(/^git@github\.com:([^/]+)\/(.+)$/i) ||
    s.match(/^https?:\/\/github\.com\/([^/]+)\/(.+)$/i) ||
    s.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/i);
  if (!m) return null;
  return { org: m[1], repo: m[2] };
}

export function remotesMatch(actual, expected) {
  const a = parseGithubRemote(actual);
  const b = parseGithubRemote(expected);
  if (!a || !b) return actual === expected;
  return a.org.toLowerCase() === b.org.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();
}
