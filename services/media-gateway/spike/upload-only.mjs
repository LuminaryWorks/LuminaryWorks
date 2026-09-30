import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.resolve(root, "../../../BlockyEdu/edu-server/.env");
const text = require("node:fs").readFileSync(envFile, "utf8");
for (const line of text.split("\n")) {
  const match = /^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (!match || !/^(B2_|backblaze_)/.test(match[1]) || process.env[match[1]]) continue;
  let value = match[2];
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  process.env[match[1]] = value;
}
const { probeB2Get, uploadOriginToB2 } = require(path.join(root, "dist/b2-upload.js"));
if (process.argv.includes("--probe")) {
  console.log(await probeB2Get("hls/pilot-bars/720p/seg-0000.m4s"));
} else {
  const uploaded = await uploadOriginToB2(path.join(root, "spike/origin"));
  console.log(`b2 ok bucket=${uploaded.bucket} objects=${uploaded.count}`);
}
