#!/usr/bin/env node
/**
 * Alias: Hong Kong first-install kit is the LuminaryWorks source kit.
 * Does not pack Docker Engine or images (see scripts/pack-luminaryworks.mjs).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const result = spawnSync(
  process.execPath,
  [join(dirname(fileURLToPath(import.meta.url)), "pack-luminaryworks.mjs"), ...process.argv.slice(2)],
  { stdio: "inherit", shell: false, env: process.env },
);
process.exit(result.status ?? 1);
