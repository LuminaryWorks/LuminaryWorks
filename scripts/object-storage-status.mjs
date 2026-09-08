#!/usr/bin/env node
/**
 * Host/operator object-storage watermark check (machine-readable JSON).
 *
 *   node scripts/object-storage-status.mjs --used-bytes 0
 *   node scripts/object-storage-status.mjs --data-path /var/lib/docker/volumes/…/_data
 *
 * Second guard only. Hard cap is AIStor `mc quota set --hard` on each bucket.
 * `df` on a Docker named volume often measures the backing filesystem
 * (commonly all of /var/lib/docker), not isolated object-bytes — prefer
 * --used-bytes from `mc du` / quota info.
 *
 * Does not start AIStor, does not pull images, does not mount docker.sock
 * into application containers. Run on the host (or an operator jump host).
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  OBJECT_STORAGE_BUDGET_BYTES,
  buildAdmissionStatus,
} from "./lib/object-storage.mjs";

function parseArgs(argv) {
  const options = {
    usedBytes: null,
    dataPath: null,
    budgetBytes: OBJECT_STORAGE_BUDGET_BYTES,
    outFile: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--used-bytes":
        options.usedBytes = next();
        break;
      case "--data-path":
        options.dataPath = next();
        break;
      case "--budget-bytes":
        options.budgetBytes = next();
        break;
      case "--out":
        options.outFile = next();
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(78);
    }
  }
  return options;
}

function dfUsedBytes(dataPath) {
  const path = resolve(dataPath);
  if (!existsSync(path)) {
    throw new Error(`data path not found: ${path}`);
  }
  const st = statSync(path);
  if (!st.isDirectory()) {
    throw new Error(`data path is not a directory: ${path}`);
  }
  const result = spawnSync("df", ["-B1", "-P", path], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "df failed").trim());
  }
  const lines = String(result.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const dataLine = lines[lines.length - 1] || "";
  const parts = dataLine.split(/\s+/);
  // Filesystem Size Used Avail Use% Mounted
  const used = Number(parts[2]);
  if (!Number.isFinite(used)) {
    throw new Error(`could not parse df output: ${dataLine}`);
  }
  return used;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node scripts/object-storage-status.mjs [options]

  --used-bytes <n>     Skip df; use this used-byte count (tests / dry-run)
  --data-path <dir>    df -B1 the MinIO data directory (host operator)
  --budget-bytes <n>   Default 120 GiB (${OBJECT_STORAGE_BUDGET_BYTES})
  --out <file>         Also write JSON to this path

Hard cap is AIStor bucket quota. This JSON is a second guard.
CDN does not reduce disk. df on a named volume may include the whole Docker FS.
`);
    return 0;
  }

  let used;
  let source;
  if (options.usedBytes != null) {
    used = Number(options.usedBytes);
    source = "used-bytes";
  } else if (options.dataPath) {
    used = dfUsedBytes(options.dataPath);
    source = `df:${resolve(options.dataPath)}`;
  } else {
    console.error("provide --used-bytes or --data-path");
    return 78;
  }

  const status = buildAdmissionStatus(used, {
    budgetBytes: Number(options.budgetBytes),
    source,
  });
  const json = `${JSON.stringify(status, null, 2)}\n`;
  process.stdout.write(json);
  if (options.outFile) writeFileSync(options.outFile, json, { encoding: "utf8" });
  return 0;
}

process.exit(main());
