/**
 * Phase A: TS6 prep + bump typescript to 6.0.3 across ecosystem.
 * UTF-8 no BOM. Run: node scripts/upgrade-ecosystem-ts6-nest12-rsbuild2.mjs --phase=a
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { metaRoot, workspaceRoot } from "./lib/workspace.mjs";

const TS_TARGET = "6.0.3";
const PRODUCTS = [
  "LuminaryWorks",
  "BlockyEdu",
  "DataLuminary",
  "DoerFlow",
  "VistaRemote",
  "VistaCast",
  "SyncroBrain",
];

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "coverage",
  "build",
  ".turbo",
  "out",
  ".worktrees",
  "artifacts",
  ".cache",
]);

function writeUtf8(file, text) {
  if (text.includes("\uFFFD")) throw new Error(`mojibake: ${file}`);
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, { encoding: "utf8" });
}

function walk(dir, acc = []) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of ents) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name === "package.json" || e.name === "tsconfig.json" || e.name.startsWith("tsconfig.")) {
      acc.push(p);
    }
  }
  return acc;
}

/** Fix moduleResolution: Node -> NodeNext via text (preserve comments/JSONC). */
function fixTsconfigText(file, text) {
  let next = text;
  let changed = false;

  // Explicit Node / node / Node10 -> NodeNext for library/Nest style
  const mrRe = /("moduleResolution"\s*:\s*")(Node|node|Node10|node10)(")/g;
  if (mrRe.test(next)) {
    next = next.replace(mrRe, '$1NodeNext$3');
    changed = true;
  }

  // DataView: esModuleInterop false -> true
  if (file.includes(`${path.sep}DataView${path.sep}`) && /"esModuleInterop"\s*:\s*false/.test(next)) {
    next = next.replace(/("esModuleInterop"\s*:\s*)false/, "$1true");
    changed = true;
  }

  return { next, changed };
}

function bumpTypescript(pkgPath) {
  const raw = fs.readFileSync(pkgPath, "utf8");
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return false;
  }
  let changed = false;
  for (const sec of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = j[sec];
    if (!deps || typeof deps.typescript !== "string") continue;
    const cur = deps.typescript;
    // Only bump 5.x (or older) floors to 6.0.3; leave workspace/file alone
    if (cur.startsWith("file:") || cur.startsWith("workspace:")) continue;
    if (cur === TS_TARGET || cur === `^${TS_TARGET}`) continue;
    // Pin exact 6.0.3 for reproducibility across ecosystem (plan says 6.0.3)
    if (/^[~^]?5\./.test(cur) || cur === "5.9.3" || cur === "5.7.3" || /^[~^]?6\./.test(cur) === false) {
      // if already ^6.0.3 ok; if 6.0.x range, normalize to 6.0.3 exact or ^6.0.3
      deps.typescript = TS_TARGET;
      changed = true;
    } else if (/^[~^]?6\./.test(cur) && cur !== TS_TARGET) {
      deps.typescript = TS_TARGET;
      changed = true;
    }
  }
  if (changed) {
    writeUtf8(pkgPath, JSON.stringify(j, null, 2));
  }
  return changed;
}

function phaseA() {
  const roots = PRODUCTS.map((p) =>
    p === "LuminaryWorks" ? metaRoot : path.join(workspaceRoot, p),
  ).filter((r) => fs.existsSync(r));

  let tsconfigFixed = 0;
  let pkgFixed = 0;

  for (const root of roots) {
    const files = walk(root);
    for (const f of files) {
      if (f.endsWith("package.json")) {
        if (bumpTypescript(f)) {
          pkgFixed++;
          console.log("ts bump", path.relative(workspaceRoot, f));
        }
        continue;
      }
      if (!/tsconfig.*\.json$/.test(path.basename(f))) continue;
      const text = fs.readFileSync(f, "utf8");
      const { next, changed } = fixTsconfigText(f, text);
      if (changed) {
        writeUtf8(f, next);
        tsconfigFixed++;
        console.log("tsconfig", path.relative(workspaceRoot, f));
      }
    }
  }

  // Nest services: if moduleResolution unset and module CommonJS, set NodeNext via careful insert
  const nestTsconfigs = [
    "LuminaryWorks/services/entitlement/tsconfig.json",
    "LuminaryWorks/services/media-gateway/tsconfig.json",
    "LuminaryWorks/services/notification/tsconfig.json",
    "LuminaryWorks/services/ai-platform/tsconfig.json",
    "BlockyEdu/code-server/tsconfig.json",
    "BlockyEdu/edu-server/tsconfig.json",
    "BlockyEdu/media-platform/tsconfig.json",
    "DataLuminary/DataTalk/tsconfig.json",
    "DoerFlow/repos/api/tsconfig.json",
    "VistaRemote/server/tsconfig.json",
    "VistaCast/server/tsconfig.json",
    "SyncroBrain/iot-gateway/tsconfig.json",
  ].map((p) => path.join(workspaceRoot, p));

  for (const f of nestTsconfigs) {
    if (!fs.existsSync(f)) continue;
    let text = fs.readFileSync(f, "utf8");
    let changed = false;
    if (!/"moduleResolution"\s*:/.test(text)) {
      // insert after "module": "..."
      if (/"module"\s*:\s*"[^"]+"/.test(text)) {
        text = text.replace(/("module"\s*:\s*"[^"]+")/, '$1,\n    "moduleResolution": "NodeNext"');
        changed = true;
      } else if (/"compilerOptions"\s*:\s*\{/.test(text)) {
        text = text.replace(/("compilerOptions"\s*:\s*\{)/, '$1\n    "moduleResolution": "NodeNext",');
        changed = true;
      }
    } else {
      const { next, changed: c2 } = fixTsconfigText(f, text);
      text = next;
      changed = c2;
    }
    // Prefer CommonJS + NodeNext or keep NodeNext pair
    if (/"moduleResolution"\s*:\s*"Node"/.test(text)) {
      text = text.replace(/("moduleResolution"\s*:\s*")Node(")/, "$1NodeNext$2");
      changed = true;
    }
    if (changed) {
      writeUtf8(f, text);
      console.log("nest tsconfig", path.relative(workspaceRoot, f));
      tsconfigFixed++;
    }
  }

  console.log(`phase A done: package.json=${pkgFixed} tsconfig=${tsconfigFixed}`);
}

const phase = process.argv.find((a) => a.startsWith("--phase="))?.split("=")[1] || "a";
if (phase === "a") phaseA();
else console.error("unknown phase", phase);
