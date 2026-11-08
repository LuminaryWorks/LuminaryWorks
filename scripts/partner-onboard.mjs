#!/usr/bin/env node
/**
 * Plan onboarding for one partner from contracts/partners.manifest.json.
 * Default path is a dry-run. The only write is --write-apps, and only for a
 * missing app whose clientId is the public placeholder.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  applyWriteApps,
  buildPlan,
  defaultPaths,
  diffPartnerApps,
  HELP,
  loadWebsiteCopy,
  prepareManifest,
  readJson,
  renderCheck,
  renderList,
  renderPlan,
} from "./lib/partner-manifest.mjs";

function writeJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (text.charCodeAt(0) === 0xfeff || text.includes("\uFFFD")) {
    throw new Error("refusing to write invalid encoding");
  }
  JSON.parse(text);
  writeFileSync(path, text, "utf8");
  const raw = readFileSync(path);
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    throw new Error("refusing UTF-8 BOM");
  }
  JSON.parse(readFileSync(path, "utf8"));
}

export function parseArgs(argv) {
  const out = {
    command: "help",
    code: null,
    json: false,
    manifest: null,
    apps: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--json") out.json = true;
    else if (arg === "--help" || arg === "-h") out.command = "help";
    else if (arg === "--list") out.command = "list";
    else if (arg === "--check" || arg === "--plan" || arg === "--write-apps") {
      out.command = arg.slice(2);
      out.code = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : null;
    } else if (arg === "--manifest" || arg === "--apps") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a path`);
      out[arg.slice(2)] = value;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return out;
}

function emit(io, json, value, text) {
  io.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : text);
}

export function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const paths = defaultPaths();
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.stderr.write(`${err.message}\n${HELP}`);
    return 2;
  }
  if (args.command === "help") {
    io.stdout.write(HELP);
    return 0;
  }
  if ((args.command === "check" || args.command === "plan" || args.command === "write-apps") && !args.code) {
    io.stderr.write(`missing partner code\n${HELP}`);
    return 2;
  }

  const manifestPath = args.manifest || paths.manifest;
  const schema = readJson(paths.schema);
  const prepared = prepareManifest(readJson(manifestPath), schema);
  if (!prepared.ok) {
    io.stderr.write(`manifest invalid\n${prepared.errors.join("\n")}\n`);
    return 1;
  }
  const partners = prepared.manifest.partners;

  if (args.command === "list") {
    emit(io, args.json, partners.map((partner) => ({
      code: partner.code,
      displayName: partner.displayName,
      operatorLabel: partner.operatorLabel,
      status: partner.status,
      sellable: partner.sellable,
      domain: partner.domains[0],
    })), renderList(partners));
    return 0;
  }

  const partner = partners.find((item) => item.code === args.code);
  if (!partner) {
    io.stderr.write(`unknown partner code ${args.code}\n`);
    return 1;
  }

  const appsPath = args.apps || paths.apps;
  if (args.command === "check") {
    const appsDoc = readJson(appsPath);
    const identity = diffPartnerApps(partner, appsDoc);
    emit(io, args.json, { ok: identity.ok, code: partner.code, apps: identity.apps }, renderCheck(partner, identity));
    return identity.ok ? 0 : 1;
  }

  if (args.command === "plan") {
    const appsDoc = readJson(appsPath);
    const plan = buildPlan(partner, appsDoc, loadWebsiteCopy());
    emit(io, args.json, plan, renderPlan(plan));
    return 0;
  }

  const before = readFileSync(appsPath, "utf8");
  const appsDoc = JSON.parse(before);
  const result = applyWriteApps(appsDoc, partner);
  if (!result.wrote) {
    const payload = { wrote: false, reason: result.reason, proposals: result.proposals };
    const text = result.reason === "already-present"
      ? `${partner.code}: identity apps already present; nothing written\n`
      : `${partner.code}: refusing to write. A missing app must set clientId to PUBLIC_CLIENT_ID_PLACEHOLDER. Nothing was written.\n${JSON.stringify(result.proposals, null, 2)}\n`;
    emit(io, args.json, payload, text);
    return result.reason === "already-present" ? 0 : 1;
  }
  const again = readFileSync(appsPath, "utf8");
  if (again !== before) {
    io.stderr.write("identity/apps.json changed while preparing the write; aborted\n");
    return 1;
  }
  writeJson(appsPath, result.doc);
  emit(
    io,
    args.json,
    { wrote: true, reason: result.reason, proposals: result.proposals },
    `${partner.code}: appended ${result.proposals.length} public template app(s). No client id and no secret were written.\n`,
  );
  return 0;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  Promise.resolve(main()).then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exitCode = 2;
  });
}
