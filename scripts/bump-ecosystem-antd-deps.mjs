/**
 * Bump antd / @ant-design/icons / @luminaryworks/* floors across the ecosystem.
 * UTF-8 no BOM. Run: node scripts/bump-ecosystem-antd-deps.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { metaRoot, resolveWorkspacePath } from "./lib/workspace.mjs";

const ANTD = "^6.6.5";
const ICONS = "^6.3.4";

/** Latest published @luminaryworks floors (npmjs as of bump). */
const LUMINARY = {
  "@luminaryworks/ai-client": "^0.2.7",
  "@luminaryworks/ai-react": "^0.1.9",
  "@luminaryworks/auth-core": "^0.2.4",
  "@luminaryworks/auth-react": "^0.5.0",
  "@luminaryworks/auth-dev-proxy": "^0.2.2",
  "@luminaryworks/entitlement-client": "^0.2.6",
  "@luminaryworks/notification": "^0.3.0",
  "@luminaryworks/formily-antd-v6": "^1.0.1",
  "@luminaryworks/pal": "^0.3.1",
};

const TARGETS = [
  // LuminaryWorks
  path.join(metaRoot, "website", "package.json"),
  path.join(metaRoot, "apps", "control-console", "package.json"),
  path.join(metaRoot, "shared", "packages", "ai-react", "package.json"),
  path.join(metaRoot, "services", "entitlement", "package.json"),
  // DataLuminary
  resolveWorkspacePath("DataLuminary", "DataView", "package.json"),
  resolveWorkspacePath("DataLuminary", "DataTalk", "package.json"),
  resolveWorkspacePath("DataLuminary", "share-demo", "package.json"),
  // BlockyEdu
  resolveWorkspacePath("BlockyEdu", "code-app-web", "package.json"),
  resolveWorkspacePath("BlockyEdu", "edu-app-web", "package.json"),
  resolveWorkspacePath("BlockyEdu", "edu-server", "package.json"),
  resolveWorkspacePath("BlockyEdu", "code-server", "package.json"),
  // DoerFlow
  resolveWorkspacePath("DoerFlow", "repos", "web", "package.json"),
  resolveWorkspacePath("DoerFlow", "repos", "admin", "package.json"),
  resolveWorkspacePath("DoerFlow", "repos", "api", "package.json"),
  resolveWorkspacePath("DoerFlow", "repos", "site", "package.json"),
  resolveWorkspacePath("DoerFlow", "repos", "website", "package.json"),
  // VistaRemote (canonical trees only — skip .worktrees)
  resolveWorkspacePath("VistaRemote", "web", "apps", "admin", "package.json"),
  resolveWorkspacePath("VistaRemote", "web", "apps", "client", "package.json"),
  resolveWorkspacePath("VistaRemote", "web", "packages", "ui", "package.json"),
  resolveWorkspacePath("VistaRemote", "desktop", "package.json"),
  resolveWorkspacePath("VistaRemote", "server", "package.json"),
  resolveWorkspacePath("VistaRemote", "website", "package.json"),
  // VistaCast
  resolveWorkspacePath("VistaCast", "web", "package.json"),
  resolveWorkspacePath("VistaCast", "server", "package.json"),
  resolveWorkspacePath("VistaCast", "website", "package.json"),
  // SyncroBrain
  resolveWorkspacePath("SyncroBrain", "iot-console-web", "package.json"),
  resolveWorkspacePath("SyncroBrain", "iot-gateway", "package.json"),
].filter(Boolean);

function writeUtf8(file, text) {
  if (text.includes("\uFFFD") || /\?{2,}/.test(text)) {
    throw new Error(`mojibake refuse: ${file}`);
  }
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, { encoding: "utf8" });
}

function bumpSection(deps, changes) {
  if (!deps || typeof deps !== "object") return false;
  let changed = false;
  if (deps.antd && deps.antd !== ANTD) {
    // Only bump antd 6.x ranges; leave antd 5.x alone (none expected in targets)
    if (String(deps.antd).includes("5.")) {
      console.warn("skip antd 5.x", deps.antd);
    } else {
      deps.antd = ANTD;
      changes.push(`antd -> ${ANTD}`);
      changed = true;
    }
  }
  if (deps["@ant-design/icons"] && deps["@ant-design/icons"] !== ICONS) {
    deps["@ant-design/icons"] = ICONS;
    changes.push(`@ant-design/icons -> ${ICONS}`);
    changed = true;
  }
  for (const [name, target] of Object.entries(LUMINARY)) {
    const cur = deps[name];
    if (
      cur &&
      cur !== target &&
      !String(cur).startsWith("file:") &&
      !String(cur).startsWith("workspace:")
    ) {
      deps[name] = target;
      changes.push(`${name} -> ${target}`);
      changed = true;
    }
  }
  return changed;
}

function bumpPackageJson(file) {
  if (!fs.existsSync(file)) {
    console.warn("skip missing", file);
    return false;
  }
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const changes = [];
  let changed = false;
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (bumpSection(j[section], changes)) changed = true;
  }
  if (changed) {
    writeUtf8(file, JSON.stringify(j, null, 2));
    console.log("updated", path.relative(metaRoot, file) || file);
    for (const c of changes) console.log("  -", c);
  }
  return changed;
}

let count = 0;
for (const file of TARGETS) {
  if (bumpPackageJson(file)) count++;
}
console.log(`done: ${count} package.json updated`);
