#!/usr/bin/env node
/**
 * Restore UTF-8 (no BOM) JSON/JSONC-safe text files across LuminaryWorks ecosystem.
 * - Strips UTF-8 BOM
 * - Validates JSON after edits
 * - Applies Polyform-NC license string replacements (DataLuminary website only)
 *
 * Usage:
 *   node scripts/ecosystem-fix-json-encoding.mjs --strip-bom --roots ../LuminaryWorks
 *   node scripts/ecosystem-fix-json-encoding.mjs --fix-dataluminary-website
 *   node scripts/ecosystem-fix-json-encoding.mjs --fix-doerflow-licenses
 *   node scripts/ecosystem-fix-json-encoding.mjs --verify
 *
 * Default roots resolve from this MetaRepo → sibling workspace ({workspace}/).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ecosystemRoots, resolveWorkspacePath } from "./lib/workspace.mjs";

const DEFAULT_ROOTS = [
  ...ecosystemRoots(),
  resolveWorkspacePath("DataLuminary", "website"),
];

const SKIP =
  /(?:^|[\\/])(node_modules|\.next|dist|out|doc_build|\.git|artifacts|cache|release)(?:[\\/]|$)/i;

const POLYFORM_REPLACEMENTS = [
  [
    "LuminaryWorks AI Ecosystem · Open Source MIT License",
    "LuminaryWorks AI Ecosystem · Open Source Polyform Noncommercial License",
  ],
  [
    "LuminaryWorks AI エコシステム · オープンソース MIT ライセンス",
    "LuminaryWorks AI エコシステム · オープンソース Polyform Noncommercial ライセンス",
  ],
  [
    "LuminaryWorks AI 생태계 · 오픈소스 MIT 라이선스",
    "LuminaryWorks AI 생태계 · 오픈소스 Polyform Noncommercial 라이선스",
  ],
  ["MIT open source", "Polyform Noncommercial open source"],
  ["MIT 오픈소스", "Polyform Noncommercial 오픈소스"],
  ["MIT オープンソース", "Polyform Noncommercial オープンソース"],
  [
    "Open source & free · No credit card · Private deployment · MIT License",
    "Open source & free · No credit card · Private deployment · Polyform Noncommercial License",
  ],
  [
    "오픈소스 & 무료 · 신용카드 불필요 · 프라이빗 배포 · MIT 라이선스",
    "오픈소스 & 무료 · 신용카드 불필요 · 프라이빗 배포 · Polyform Noncommercial 라이선스",
  ],
  [
    "オープンソース＆無料 · クレジットカード不要 · プライベートデプロイ · MIT ライセンス",
    "オープンソース＆無料 · クレジットカード不要 · プライベートデプロイ · Polyform Noncommercial ライセンス",
  ],
  ["MIT License", "Polyform Noncommercial License"],
  ["Open source MIT", "Open source Polyform Noncommercial"],
  ["Código abierto MIT", "Código abierto Polyform Noncommercial"],
];

function readUtf8NoBom(filePath) {
  const buf = fs.readFileSync(filePath);
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  return { text: (hasBom ? buf.subarray(3) : buf).toString("utf8"), hadBom: hasBom };
}

function writeUtf8NoBom(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, { encoding: "utf8" });
}

function applyReplacements(text) {
  let out = text;
  for (const [from, to] of POLYFORM_REPLACEMENTS) {
    out = out.split(from).join(to);
  }
  return out;
}

function walkJsonFiles(root) {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (SKIP.test(p)) continue;
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".json")) files.push(p);
    }
  }
  walk(root);
  return files;
}

function verifyFile(filePath) {
  const { text, hadBom } = readUtf8NoBom(filePath);
  const trim = text.trimStart();
  const badStart = trim.length > 0 && trim[0] !== "{" && trim[0] !== "[";
  let parseOk = true;
  let parseErr = "";
  try {
    JSON.parse(text);
  } catch (e) {
    parseOk = false;
    parseErr = e.message;
  }
  const mojibake = /鈥|锟|杩愯惀|绠＄悊|浠ュお鍧/.test(text);
  return { filePath, hadBom, badStart, parseOk, parseErr, mojibake };
}

function stripBomInRoots(roots) {
  let fixed = 0;
  for (const root of roots) {
    for (const file of walkJsonFiles(root)) {
      const { text, hadBom } = readUtf8NoBom(file);
      if (!hadBom) continue;
      writeUtf8NoBom(file, text);
      fixed++;
      console.log("strip BOM:", file);
    }
  }
  console.log(`Stripped BOM from ${fixed} file(s).`);
}

function fixDataluminaryWebsite() {
  const repo = resolveWorkspacePath("DataLuminary", "website");
  console.log("Restoring scripts/ and messages/ from git HEAD...");
  execSync("git checkout HEAD -- scripts messages", { cwd: repo, stdio: "inherit" });

  const dirs = ["scripts", "messages"].map((d) => path.join(repo, d));
  let updated = 0;
  for (const dir of dirs) {
    for (const file of walkJsonFiles(dir)) {
      const { text } = readUtf8NoBom(file);
      const next = applyReplacements(text);
      if (next === text) continue;
      JSON.parse(next);
      const formatted =
        file.includes(`${path.sep}messages${path.sep}`) ||
        file.endsWith("locale-pairs-ja.json") ||
        file.endsWith("locale-pairs-ko.json") ||
        file.endsWith("locale-pairs-pt.json") ||
        file.endsWith("locale-pairs-base.json") ||
        file.endsWith("locale-bundles.json") ||
        file.endsWith("ja-ko-maps.json") ||
        file.endsWith("ja-overrides.json") ||
        file.endsWith("ko-overrides.json") ||
        file.endsWith("nl-overrides.json") ||
        file.endsWith("en-to-ja.json") ||
        file.endsWith("en-to-ko.json") ||
        file.endsWith("ja-by-en.json") ||
        file.endsWith("ko-by-en.json") ||
        file.endsWith("en-keys.json")
          ? `${JSON.stringify(JSON.parse(next), null, 2)}\n`
          : next;
      writeUtf8NoBom(file, formatted);
      updated++;
      console.log("polyform:", path.relative(repo, file));
    }
  }
  console.log(`Updated ${updated} DataLuminary website JSON file(s).`);
}

function setLicenseField(pkgPath, license) {
  const { text, hadBom } = readUtf8NoBom(pkgPath);
  const pkg = JSON.parse(text);
  pkg.license = license;
  writeUtf8NoBom(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  if (hadBom) console.log("(had BOM)", pkgPath);
  console.log("license:", pkgPath);
}

function fixDoerflowLicenses() {
  const repos = [
    "admin",
    "api",
    "contracts",
    "docs",
    "p2p",
    "shared",
    "wallet",
    "web",
    "worker",
    "site",
  ].map((name) => resolveWorkspacePath("DoerFlow", "repos", name));
  for (const repo of repos) {
    const pkgPath = path.join(repo, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    if (fs.existsSync(path.join(repo, ".git"))) {
      try {
        execSync("git checkout HEAD -- package.json", { cwd: repo, stdio: "pipe" });
      } catch {
        /* new repo or no HEAD */
      }
    }
    const { text } = readUtf8NoBom(pkgPath);
    try {
      JSON.parse(text);
      setLicenseField(pkgPath, "Polyform-Noncommercial-1.0.0");
    } catch (e) {
      console.error("SKIP corrupt package.json:", pkgPath, e.message);
    }
  }
}

function verifyRoots(roots) {
  const problems = [];
  for (const root of roots) {
    for (const file of walkJsonFiles(root)) {
      const r = verifyFile(file);
      if (r.hadBom || r.badStart || !r.parseOk || r.mojibake) problems.push(r);
    }
  }
  if (problems.length === 0) {
    console.log("OK: no JSON encoding/parse issues found.");
    return;
  }
  console.log(`Found ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 50)) {
    console.log(
      [
        p.filePath,
        p.hadBom ? "BOM" : "",
        p.badStart ? "BAD_START" : "",
        !p.parseOk ? `PARSE:${p.parseErr}` : "",
        p.mojibake ? "MOJIBAKE" : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }
  process.exitCode = 1;
}

const args = process.argv.slice(2);
const roots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--roots") {
    while (args[i + 1] && !args[i + 1].startsWith("--")) roots.push(args[++i]);
  }
}
const useRoots = roots.length ? roots : DEFAULT_ROOTS;

if (args.includes("--strip-bom")) stripBomInRoots(useRoots);
if (args.includes("--fix-dataluminary-website")) fixDataluminaryWebsite();
if (args.includes("--fix-doerflow-licenses")) fixDoerflowLicenses();
if (args.includes("--verify") || args.length === 0) verifyRoots(useRoots);
