#!/usr/bin/env node
/**
 * Validate deploy/site.json (no secrets) and print pack + seed env patches.
 *
 *   pnpm site:check
 *   node scripts/site-check.mjs deploy/site.json
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSiteReport, parseSiteIntent } from "./lib/site-intent.mjs";

const metaRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requested = process.argv[2];
const path = requested
  ? resolve(requested)
  : existsSync(join(metaRoot, "deploy", "site.json"))
    ? join(metaRoot, "deploy", "site.json")
    : join(metaRoot, "deploy", "site.example.json");

if (!existsSync(path)) {
  console.error(`site file not found: ${path}`);
  process.exit(78);
}

const text = readFileSync(path, "utf8");
if (text.includes("\uFFFD")) {
  console.error("site file is not valid UTF-8");
  process.exit(65);
}

let raw;
try {
  raw = JSON.parse(text);
} catch (err) {
  console.error(`invalid JSON: ${err.message}`);
  process.exit(65);
}

const intent = parseSiteIntent(raw);
process.stdout.write(formatSiteReport(intent));
if (!intent.ok) process.exit(1);
console.log(`[site] ok ${path}`);
