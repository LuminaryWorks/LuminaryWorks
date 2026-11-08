import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connectionsFromEnv, parseDotEnv } from "../scripts/seed-deployment-connection.mjs";

const SECRET = "sk-seed-test-secret-value";
const SERVICE_KEY = "seed-service-key-012345";

test("dotenv parser keeps provider keys and ignores comments", () => {
  const parsed = parseDotEnv(`# comment\nDEEPSEEK_API_KEY="${SECRET}"\nopenrouter_api_key='sk-or-seed'\nempty=\n`);
  assert.equal(parsed.deepseek_api_key, SECRET);
  assert.equal(parsed.openrouter_api_key, "sk-or-seed");
  const planned = connectionsFromEnv(parsed);
  assert.equal(planned[0].uid, "conn_deploy_deepseek");
  assert.equal(planned[0].providerType, "deepseek");
  assert.equal(planned[1].providerType, "openai-compatible");
  assert.equal(planned[1].baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(planned[1].uid, "conn_deploy_openrouter");
});

test("seed script writes deployment connections and does not print secrets", async () => {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    seen.push({ authorization: req.headers["x-service-key"], body });
    const secret = typeof body.secret === "string" ? body.secret : "";
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        uid: body.uid,
        providerType: body.providerType,
        secretFingerprint: secret.slice(-4),
        hasSecret: secret.length > 0,
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const dir = mkdtempSync(join(tmpdir(), "lw-ai-seed-"));
  const envFile = join(dir, "providers.env");
  writeFileSync(envFile, `deepseek_api_key=${SECRET}\nopenrouter_api_key=sk-or-seed-value\n`, "utf8");
  const script = fileURLToPath(new URL("../scripts/seed-deployment-connection.mjs", import.meta.url));
  try {
    const result = await run(process.execPath, [script, "--env-file", envFile, "--api-base", `http://127.0.0.1:${port}`], {
      AI_PLATFORM_SERVICE_API_KEY: SERVICE_KEY,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.includes(SECRET), false);
    assert.equal(result.stdout.includes("sk-or-seed-value"), false);
    assert.equal(result.stdout.includes(SERVICE_KEY), false);
    assert.equal(result.stderr.includes(SECRET), false);
    assert.match(result.stdout, /uid=conn_deploy_deepseek/);
    assert.match(result.stdout, /fingerprint=alue/);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].authorization, SERVICE_KEY);
    assert.equal(seen[0].body.ownerKind, "deployment");
    assert.equal(seen[0].body.ownerUid, "deployment");
    assert.equal(seen[0].body.secret, SECRET);
    assert.equal(seen[1].body.providerType, "openai-compatible");
    assert.equal(seen[1].body.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(seen[1].body.isDefault, false);
    assert.equal(seen[0].body.isDefault, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
