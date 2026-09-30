import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const www = path.join(root, "spike/www");
const packed = path.join(root, "spike/out");
const origin = path.join(root, "spike/origin");
const gatewayPort = 18190;
const edgePort = 18191;
const serviceKey = "spike-service-key-32";
const signingSecret = "spike-signing-secret-32";
const keyHex = "00112233445566778899aabbccddeeff";

const children = [];

function loadCredentialFile(file) {
  let text = "";
  try {
    text = require("node:fs").readFileSync(file, "utf8");
  } catch {
    return;
  }
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
}

async function waitFor(url, okOnly = true) {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(url);
      if (!okOnly || response.ok) return;
    } catch {
      // process still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function startProcess(script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.once("exit", (code) => {
    if (code) console.error(log.slice(-2000));
  });
  return child;
}

async function serveStatic(dir) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const file = path.resolve(dir, `.${url.pathname}`);
    if (!file.startsWith(dir)) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      const type = file.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".html")
            ? "text/html"
            : "video/mp2t";
      res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : 0,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function copySuffix(fromDir, toDir, suffix) {
  await mkdir(toDir, { recursive: true });
  const playlist = await readFile(path.join(fromDir, "index.m3u8"), "utf8");
  await writeFile(path.join(toDir, "index.m3u8"), playlist.replace(/\.ts/g, suffix));
  for (const file of await readdir(fromDir)) {
    if (!file.endsWith(".ts")) continue;
    await copyFile(path.join(fromDir, file), path.join(toDir, file.replace(/\.ts$/, suffix)));
  }
}

async function play(pageUrl) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const failed = [];
    page.on("requestfailed", (request) => {
      failed.push(`${request.failure()?.errorText ?? ""} ${request.url()}`);
    });
    await page.goto(pageUrl);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20_000 });
    await page.click("#play");
    await page.waitForFunction(() => window.__played === true, null, { timeout: 20_000 });
    return { played: true, hook: await page.evaluate(() => window.__hook === true), failed };
  } finally {
    await browser.close();
  }
}

async function main() {
  loadCredentialFile(path.resolve(root, "../../../BlockyEdu/edu-server/.env"));
  await rm(www, { recursive: true, force: true });
  await rm(origin, { recursive: true, force: true });
  await mkdir(www, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn("sh", [path.join(root, "pack/pack-fixture.sh"), packed, keyHex], {
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });

  await copySuffix(path.join(packed, "clear"), path.join(www, "suffix-seg"), ".seg");
  await copySuffix(path.join(packed, "clear"), path.join(www, "suffix-m4s"), ".m4s");
  const hookDir = path.join(www, "hook");
  await mkdir(hookDir, { recursive: true });
  const clearPlaylist = await readFile(path.join(packed, "clear/index.m3u8"), "utf8");
  await writeFile(path.join(hookDir, "index.m3u8"), clearPlaylist);
  for (const file of await readdir(path.join(packed, "clear"))) {
    if (!file.endsWith(".ts")) continue;
    await copyFile(path.join(packed, "clear", file), path.join(hookDir, file.replace(/\.ts$/, ".seg")));
  }

  const esbuild = path.join(root, "node_modules/.bin/esbuild");
  await new Promise((resolve, reject) => {
    const child = spawn(
      esbuild,
      [
        path.join(root, "spike/player-entry.ts"),
        "--bundle",
        "--format=esm",
        "--platform=browser",
        `--outfile=${path.join(www, "player.js")}`,
      ],
      { stdio: "inherit" },
    );
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`esbuild exit ${code}`))));
  });
  await writeFile(
    path.join(www, "page.html"),
    `<!doctype html><meta charset="utf-8"><div id="mse" style="width:640px;height:360px"></div><button id="play">play</button><script type="module" src="/player.js"></script>`,
  );

  const { publishPackedDir } = require(path.join(root, "dist/publish-pack.js"));
  startProcess(path.join(root, "dist/main.js"), {
    PORT: String(gatewayPort),
    MEDIA_DATA_DIR: path.join(root, "spike/data"),
    MEDIA_GATEWAY_SERVICE_KEY: serviceKey,
    MEDIA_GATEWAY_SIGNING_SECRET: signingSecret,
    MEDIA_GATEWAY_PUBLIC_BASE: `http://127.0.0.1:${gatewayPort}`,
    MEDIA_EDGE_BASE: `http://127.0.0.1:${edgePort}`,
    MEDIA_LIMIT_IP_PER_MIN: "1000",
    MEDIA_LIMIT_SUBJECT_PER_10MIN: "1000",
    REDIS_URL: "",
  });
  startProcess(path.join(root, "dist/local-edge-main.js"), {
    MEDIA_EDGE_PORT: String(edgePort),
    MEDIA_ORIGIN_DIR: origin,
    MEDIA_GATEWAY_SERVICE_KEY: serviceKey,
    MEDIA_GATEWAY_SIGNING_SECRET: signingSecret,
    MEDIA_GATEWAY_PUBLIC_BASE: `http://127.0.0.1:${gatewayPort}`,
    MEDIA_EDGE_BASE: `http://127.0.0.1:${edgePort}`,
  });
  await waitFor(`http://127.0.0.1:${gatewayPort}/health`);
  await waitFor(`http://127.0.0.1:${edgePort}/`, false);
  const site = await serveStatic(www);

  let suffix = ".seg";
  let suffixPlayed = false;
  try {
    await play(`http://127.0.0.1:${site.port}/page.html?mode=play&playlist=${encodeURIComponent(`http://127.0.0.1:${site.port}/suffix-seg/index.m3u8`)}`);
    suffixPlayed = true;
  } catch (error) {
    console.error("seg suffix did not play", error instanceof Error ? error.message : error);
    try {
      await play(`http://127.0.0.1:${site.port}/page.html?mode=play&playlist=${encodeURIComponent(`http://127.0.0.1:${site.port}/suffix-m4s/index.m3u8`)}`);
      suffix = ".m4s";
      suffixPlayed = true;
    } catch (next) {
      console.error("m4s suffix did not play", next instanceof Error ? next.message : next);
    }
  }

  let hook = false;
  try {
    const result = await play(
      `http://127.0.0.1:${site.port}/page.html?mode=hook&playlist=${encodeURIComponent(`http://127.0.0.1:${site.port}/hook/index.m3u8`)}`,
    );
    hook = result.hook;
  } catch {
    hook = false;
  }

  if (!suffixPlayed) {
    throw new Error("xgplayer-hls did not play a non-ts suffix or m4s");
  }

  await publishPackedDir({
    segmentDir: path.join(packed, "enc"),
    originDir: origin,
    gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
    serviceKey,
    tenant: "blockyedu",
    assetId: "pilot-bars",
    publicSuffix: suffix,
    keyHex,
    title: "Color bars",
    licenseCode: "PD",
    licenseUri: "https://creativecommons.org/publicdomain/zero/1.0/",
    attribution: "LuminaryWorks synthetic fixture",
    sourceUrl: "https://luminaryworks.dev/media/pilot-bars",
  });
  const session = await fetch(`http://127.0.0.1:${gatewayPort}/v1/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({ tenant: "blockyedu", assetId: "pilot-bars", subjectId: "spike" }),
  });
  if (!session.ok) throw new Error(`session ${session.status}`);
  const grant = await session.json();
  if (/backblazeb2|amazonaws/i.test(grant.playlistUrl)) throw new Error("playlist leaked storage host");
  await play(
    `http://127.0.0.1:${site.port}/page.html?mode=play&playlist=${encodeURIComponent(grant.playlistUrl)}`,
  );

  const expired = new URL(grant.playlistUrl);
  expired.searchParams.set("exp", "1");
  const stale = await fetch(expired);
  if (stale.status !== 401) throw new Error(`expired playlist status ${stale.status}`);

  let oer = "skipped";
  try {
    const source = path.join(packed, "jellyfish.webm");
    const download = await fetch(
      "https://upload.wikimedia.org/wikipedia/commons/f/f1/Jellyfish_at_Monterey_Bay_Aquarium_15_2017-11-21.webm",
    );
    if (!download.ok) throw new Error(`download ${download.status}`);
    await writeFile(source, Buffer.from(await download.arrayBuffer()));
    const oerDir = path.join(packed, "jellyfish");
    const oerKey = "ffeeddccbbaa99887766554433221100";
    await mkdir(oerDir, { recursive: true });
    await writeFile(path.join(oerDir, "enc.key"), Buffer.from(oerKey, "hex"));
    await writeFile(
      path.join(oerDir, "enc.keyinfo"),
      "https://gateway.invalid/key\n/work/jellyfish/enc.key\n",
    );
    await new Promise((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          "run",
          "--rm",
          "--entrypoint",
          "ffmpeg",
          "-v",
          `${packed}:/work`,
          "jrottenberg/ffmpeg:7.1-alpine",
          "-y",
          "-i",
          "/work/jellyfish.webm",
          "-t",
          "8",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-ac",
          "2",
          "-b:a",
          "96k",
          "-hls_time",
          "4",
          "-hls_playlist_type",
          "vod",
          "-hls_key_info_file",
          "/work/jellyfish/enc.keyinfo",
          "-hls_segment_filename",
          "/work/jellyfish/seg-%04d.ts",
          "/work/jellyfish/index.m3u8",
        ],
        { stdio: "inherit" },
      );
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`oer ffmpeg ${code}`))));
    });
    await rm(path.join(oerDir, "enc.key"), { force: true });
    await rm(path.join(oerDir, "enc.keyinfo"), { force: true });
    await publishPackedDir({
      segmentDir: oerDir,
      originDir: origin,
      gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
      serviceKey,
      tenant: "blockyedu",
      assetId: "monterey-jellyfish",
      publicSuffix: suffix,
      keyHex: oerKey,
      title: "Jellyfish at Monterey Bay Aquarium",
      licenseCode: "CC-BY-SA",
      licenseUri: "https://creativecommons.org/licenses/by-sa/4.0/",
      attribution: "Fastily, CC BY-SA 4.0, Wikimedia Commons",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Jellyfish_at_Monterey_Bay_Aquarium_15_2017-11-21.webm",
    });
    const oerSession = await fetch(`http://127.0.0.1:${gatewayPort}/v1/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ tenant: "blockyedu", assetId: "monterey-jellyfish", subjectId: "spike" }),
    });
    if (!oerSession.ok) throw new Error(`oer session ${oerSession.status}`);
    const oerGrant = await oerSession.json();
    await play(
      `http://127.0.0.1:${site.port}/page.html?mode=play&playlist=${encodeURIComponent(oerGrant.playlistUrl)}`,
    );
    oer = "played";
  } catch (error) {
    oer = `failed ${error instanceof Error ? error.message : error}`;
  }

  let b2 = "skipped";
  if (process.env.B2_KEY_ID || process.env.backblaze_keyID) {
    try {
      const { uploadOriginToB2 } = require(path.join(root, "dist/b2-upload.js"));
      const uploaded = await uploadOriginToB2(origin);
      b2 = `ok bucket=${uploaded.bucket} objects=${uploaded.count}`;
    } catch (error) {
      b2 = `failed ${error instanceof Error ? error.message : "error"}`;
    }
  }

  console.log(JSON.stringify({ suffix, hook, encrypted: true, oer, b2 }));
  await site.close();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const child of children) child.kill();
  });
