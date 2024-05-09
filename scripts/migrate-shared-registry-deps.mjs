/**
 * Unify @luminary/* login packages → @luminaryworks/* and switch file: → semver.
 * UTF-8 no BOM. Run: node scripts/migrate-shared-registry-deps.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const metaRoot = path.resolve(__dirname, "..");
const sharedRoot = path.join(metaRoot, "shared");

const VERSIONS = {
  "@luminaryworks/auth-core": "^0.2.2",
  "@luminaryworks/auth-react": "^0.3.0",
  "@luminaryworks/auth-dev-proxy": "^0.1.0",
  "@luminaryworks/pal": "^0.2.0",
  "@luminaryworks/entitlement-client": "^0.1.0",
  "@luminaryworks/notification": "^0.1.0",
};

const RENAME = [
  ["@luminary/auth-react", "@luminaryworks/auth-react"],
  ["@luminary/auth-dev-proxy", "@luminaryworks/auth-dev-proxy"],
  ["@luminary/pal", "@luminaryworks/pal"],
];

const NPMRC = `@luminaryworks:registry=https://registry.npmjs.org
`;

const PACKAGE_JSON_TARGETS = [
  "C:/www/dataluminary/DataTalk/package.json",
  "C:/www/dataluminary/DataView/package.json",
  "C:/www/blockyedu/code-app-web/package.json",
  "C:/www/blockyedu/edu-app-web/package.json",
  "C:/www/blockyedu/edu-server/package.json",
  "C:/www/blockyedu/server/package.json",
  "C:/www/doerflow/repos/admin/package.json",
  "C:/www/doerflow/repos/api/package.json",
  "C:/www/doerflow/repos/web/package.json",
  "C:/www/vistaremote/desktop/package.json",
  "C:/www/vistaremote/server/package.json",
  "C:/www/vistaremote/web/apps/admin/package.json",
  "C:/www/vistaremote/web/apps/client/package.json",
  "C:/www/syncrobrain/iot-gateway/package.json",
  path.join(metaRoot, "services/entitlement/package.json"),
];

const SOURCE_ROOTS = [
  "C:/www/dataluminary",
  "C:/www/blockyedu",
  "C:/www/doerflow",
  "C:/www/vistaremote",
  "C:/www/syncrobrain",
  sharedRoot,
  path.join(metaRoot, "services"),
  path.join(metaRoot, ".cursor"),
  path.join(metaRoot, "spec"),
  path.join(metaRoot, "README.md"),
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "doc_build",
  ".turbo",
]);

function writeUtf8(file, text) {
  if (text.includes("\uFFFD")) throw new Error(`mojibake refuse: ${file}`);
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, {
    encoding: "utf8",
  });
}

function renameText(text) {
  let out = text;
  for (const [from, to] of RENAME) {
    out = out.split(from).join(to);
  }
  return out;
}

function updateSharedPackages() {
  const bumps = {
    "auth-core": { name: "@luminaryworks/auth-core", version: "0.2.2" },
    "auth-react": { name: "@luminaryworks/auth-react", version: "0.3.0" },
    "auth-dev-proxy": {
      name: "@luminaryworks/auth-dev-proxy",
      version: "0.1.0",
    },
    pal: { name: "@luminaryworks/pal", version: "0.2.0" },
    "entitlement-client": {
      name: "@luminaryworks/entitlement-client",
      version: "0.1.0",
    },
    notification: {
      name: "@luminaryworks/notification",
      version: "0.1.0",
    },
  };

  for (const [dir, meta] of Object.entries(bumps)) {
    const pj = path.join(sharedRoot, "packages", dir, "package.json");
    const j = JSON.parse(fs.readFileSync(pj, "utf8"));
    j.name = meta.name;
    j.version = meta.version;
    writeUtf8(pj, JSON.stringify(j, null, 2));
    console.log(`shared ${dir}: ${j.name}@${j.version}`);
  }

  const rootPj = path.join(sharedRoot, "package.json");
  const root = JSON.parse(fs.readFileSync(rootPj, "utf8"));
  root.scripts["publish:packages"] =
    "pnpm --filter @luminaryworks/auth-core --filter @luminaryworks/auth-react --filter @luminaryworks/auth-dev-proxy --filter @luminaryworks/pal --filter @luminaryworks/notification --filter @luminaryworks/entitlement-client publish --no-git-checks";
  writeUtf8(rootPj, JSON.stringify(root, null, 2));

  // Docs in shared that still say @luminary/
  for (const rel of [
    "README.md",
    "PUBLISH.md",
    "MIGRATION.md",
    "packages/auth-react/README.md",
    "packages/auth-dev-proxy/README.md",
    "packages/auth-dev-proxy/src/index.ts",
    "packages/pal/README.md",
  ]) {
    const f = path.join(sharedRoot, rel);
    if (!fs.existsSync(f)) continue;
    const t = fs.readFileSync(f, "utf8");
    const n = renameText(t);
    if (n !== t) {
      writeUtf8(f, n);
      console.log(`rewrote ${rel}`);
    }
  }
}

function isFileDep(v) {
  return typeof v === "string" && (v.startsWith("file:") || v.includes("LuminaryWorks/shared/packages"));
}

function updatePackageJson(file) {
  if (!fs.existsSync(file)) {
    console.warn("skip missing", file);
    return;
  }
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = false;

  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = j[section];
    if (!deps || typeof deps !== "object") continue;
    const next = {};
    for (const [k, v] of Object.entries(deps)) {
      let name = k;
      for (const [from, to] of RENAME) {
        if (name === from) name = to;
      }
      let ver = v;
      if (
        Object.prototype.hasOwnProperty.call(VERSIONS, name) &&
        (isFileDep(String(v)) || name !== k || String(v).startsWith("file:"))
      ) {
        ver = VERSIONS[name];
        changed = true;
      } else if (name !== k) {
        changed = true;
        if (Object.prototype.hasOwnProperty.call(VERSIONS, name)) {
          ver = VERSIONS[name];
        }
      }
      if (name !== k) changed = true;
      next[name] = ver;
    }
    j[section] = next;
  }

  // Also force-convert any remaining file: for known packages
  for (const section of ["dependencies", "devDependencies"]) {
    const deps = j[section];
    if (!deps) continue;
    for (const name of Object.keys(VERSIONS)) {
      if (deps[name] && isFileDep(String(deps[name]))) {
        deps[name] = VERSIONS[name];
        changed = true;
      }
    }
  }

  if (changed) {
    writeUtf8(file, JSON.stringify(j, null, 2));
    console.log(`package.json → ${file}`);
  }

  const npmrcPath = path.join(path.dirname(file), ".npmrc");
  if (!fs.existsSync(npmrcPath)) {
    writeUtf8(npmrcPath, NPMRC);
    console.log(`+ .npmrc ${npmrcPath}`);
  } else {
    const cur = fs.readFileSync(npmrcPath, "utf8");
    if (!cur.includes("@luminaryworks:registry")) {
      writeUtf8(npmrcPath, `${cur.trimEnd()}\n${NPMRC}`);
      console.log(`~ .npmrc ${npmrcPath}`);
    }
  }
}

function walkFiles(root, out = []) {
  if (fs.statSync(root).isFile()) {
    out.push(root);
    return out;
  }
  let ents;
  try {
    ents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|md|mdc|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

function rewriteSources() {
  const skipNames = new Set(["package-lock.json", "pnpm-lock.yaml"]);
  for (const root of SOURCE_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const f of walkFiles(root)) {
      if (skipNames.has(path.basename(f))) continue;
      // package.json handled separately for dep versions
      if (path.basename(f) === "package.json" && PACKAGE_JSON_TARGETS.some((t) => path.resolve(t) === path.resolve(f))) {
        continue;
      }
      // Don't rewrite shared package.json names again incorrectly via naive replace on tooling
      if (f.includes(`${path.sep}shared${path.sep}packages${path.sep}`) && f.endsWith("package.json")) {
        // Still rename @luminary/auth-* keys if any left in tooling refs — tooling stays @luminary/tooling
        const t = fs.readFileSync(f, "utf8");
        let n = t;
        for (const [from, to] of RENAME) {
          n = n.split(from).join(to);
        }
        if (n !== t) {
          writeUtf8(f, n);
          console.log(`src ${path.relative(metaRoot, f)}`);
        }
        continue;
      }
      const t = fs.readFileSync(f, "utf8");
      const n = renameText(t);
      if (n !== t) {
        if (n.includes("\uFFFD")) throw new Error(`mojibake ${f}`);
        writeUtf8(f, n);
        console.log(`src ${f}`);
      }
    }
  }
}

function updateMetaSkillAndReadme() {
  // Already covered by SOURCE_ROOTS including .cursor and spec
}

updateSharedPackages();
for (const f of PACKAGE_JSON_TARGETS) updatePackageJson(f);
rewriteSources();
updateMetaSkillAndReadme();
console.log("done");
