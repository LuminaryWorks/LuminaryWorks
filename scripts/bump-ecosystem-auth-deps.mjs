/**
 * Bump @luminaryworks/auth-* (and related) to latest npm semver in ecosystem package.json.
 * UTF-8 no BOM. Run: node scripts/bump-ecosystem-auth-deps.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ecosystemRoots, metaRoot, resolveWorkspacePath } from "./lib/workspace.mjs";

const TARGETS = [
  resolveWorkspacePath("DataLuminary", "DataTalk", "package.json"),
  resolveWorkspacePath("DataLuminary", "DataView", "package.json"),
  resolveWorkspacePath("BlockyEdu", "code-app-web", "package.json"),
  resolveWorkspacePath("BlockyEdu", "edu-app-web", "package.json"),
  resolveWorkspacePath("BlockyEdu", "edu-server", "package.json"),
  resolveWorkspacePath("BlockyEdu", "code-server", "package.json"),
  resolveWorkspacePath("DoerFlow", "repos", "web", "package.json"),
  resolveWorkspacePath("DoerFlow", "repos", "admin", "package.json"),
  resolveWorkspacePath("DoerFlow", "repos", "api", "package.json"),
  resolveWorkspacePath("VistaCast", "web", "package.json"),
  resolveWorkspacePath("VistaCast", "server", "package.json"),
  resolveWorkspacePath("VistaRemote", "web", "apps", "admin", "package.json"),
  resolveWorkspacePath("VistaRemote", "web", "apps", "client", "package.json"),
  resolveWorkspacePath("VistaRemote", "desktop", "package.json"),
  resolveWorkspacePath("VistaRemote", "server", "package.json"),
  resolveWorkspacePath("SyncroBrain", "iot-console-web", "package.json"),
  resolveWorkspacePath("SyncroBrain", "iot-gateway", "package.json"),
  path.join(metaRoot, "services", "entitlement", "package.json"),
];

const LATEST = {
  "@luminaryworks/auth-core": "^0.2.4",
  "@luminaryworks/auth-react": "^0.4.2",
  "@luminaryworks/auth-dev-proxy": "^0.2.1",
  "@luminaryworks/pal": "^0.3.0",
  "@luminaryworks/notification": "^0.2.0",
  "@luminaryworks/entitlement-client": "^0.2.0",
};

function writeUtf8(file, text) {
  if (text.includes("\uFFFD")) throw new Error(`mojibake refuse: ${file}`);
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, { encoding: "utf8" });
}

function bumpPackageJson(file) {
  if (!fs.existsSync(file)) {
    console.warn("skip missing", file);
    return false;
  }
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = false;
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = j[section];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, target] of Object.entries(LATEST)) {
      if (deps[name] && deps[name] !== target) {
        deps[name] = target;
        changed = true;
      }
    }
  }
  if (changed) {
    writeUtf8(file, JSON.stringify(j, null, 2));
    console.log("updated", file);
  }
  return changed;
}

let count = 0;
for (const file of TARGETS) {
  if (bumpPackageJson(file)) count++;
}
console.log(`done: ${count} package.json updated`);
