import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { redactText } from "../dist/redact.js";
import { pinHttpUrl, runWithPin } from "../dist/ssrf.js";

test("redact strips full keys and provider-masked echoes", () => {
  const secret = "sk-body-secret";
  const masked = redactText(`Incorrect API key provided: sk-body-**cret. ${secret}`, [secret]);
  assert.equal(masked.includes(secret), false);
  assert.equal(masked.includes("sk-body"), false);
  assert.equal(masked.includes("**cret"), false);
});

test("baseUrl SSRF rejects private, metadata, and credentialed URLs", async () => {
  const previous = process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS;
  delete process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS;
  const blocked = [
    "http://127.0.0.1:9/v1",
    "http://10.0.0.8/v1",
    "http://192.168.0.2/",
    "http://172.20.1.1/",
    "http://169.254.169.254/latest",
    "http://100.100.100.200/",
    "http://localhost/v1",
    "http://[::1]/",
    "http://2130706433/",
    "http://metadata.google.internal/",
    "http://user:sk-embedded-secret@example.com/v1",
    "file:///etc/passwd",
    "gopher://127.0.0.1/",
  ];
  try {
    for (const baseUrl of blocked) {
      await assert.rejects(pinHttpUrl(baseUrl), (error) => {
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.equal(String(error.message).includes("sk-embedded-secret"), false);
        return true;
      });
    }
  } finally {
    if (previous === undefined) delete process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS;
    else process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS = previous;
  }
});

test("allow-private pins loopback and blocks redirects", async () => {
  const previous = process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS;
  process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS = "true";
  const server = createServer((req, res) => {
    if ((req.url || "").startsWith("/redir")) {
      res.writeHead(302, { location: "http://169.254.169.254/" });
      res.end();
      return;
    }
    res.end("pinned");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const pin = await pinHttpUrl(`http://127.0.0.1:${port}/ok`);
    assert.equal(pin.address, "127.0.0.1");
    const ok = await runWithPin(pin, () => fetch(`http://127.0.0.1:${port}/ok`));
    assert.equal(await ok.text(), "pinned");
    const redir = await pinHttpUrl(`http://127.0.0.1:${port}/redir`);
    await assert.rejects(runWithPin(redir, () => fetch(`http://127.0.0.1:${port}/redir`)), /redirect/i);
  } finally {
    if (previous === undefined) delete process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS;
    else process.env.AI_PLATFORM_ALLOW_PRIVATE_BASE_URLS = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});
