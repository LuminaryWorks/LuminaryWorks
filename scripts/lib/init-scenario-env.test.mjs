import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initScenarioEnv, parseDotEnv } from "../init-scenario-env.mjs";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "lw-peers-"));
}

test("parseDotEnv skips comments and keeps empty values", () => {
  const parsed = parseDotEnv(`# hi\nFOO=bar\nBAZ=\nQUX="quoted"\n`);
  assert.equal(parsed.FOO, "bar");
  assert.equal(parsed.BAZ, "");
  assert.equal(parsed.QUX, "quoted");
});

test("initScenarioEnv copies examples and generates HMAC secrets once", () => {
  const root = tempDir();
  try {
    const dir = join(root, "agent-commerce");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "env.example"), "WITH_CONTROL_PLANE=0\n");
    writeFileSync(join(dir, "peers.env.example"), "DOERFLOW_EVENTS_URL=http://doerflow-api:13008/api/v1/integrations/events\n");
    writeFileSync(
      join(dir, "peers.secrets.env.example"),
      "SYNCROBRAIN_WEBHOOK_SECRET=\nDOERFLOW_HMAC_SECRET=\nDOERFLOW_M2M_CLIENT_ID=\n",
    );
    const first = initScenarioEnv({ scenario: "agent-commerce", scenariosRoot: root });
    assert.equal(first.ok, true);
    assert.ok(first.results.some((item) => item.action === "generated"));
    const secrets = parseDotEnv(readFileSync(join(dir, "peers.secrets.env"), "utf8"));
    assert.match(secrets.SYNCROBRAIN_WEBHOOK_SECRET, /^[0-9a-f]{64}$/);
    assert.match(secrets.DOERFLOW_HMAC_SECRET, /^[0-9a-f]{64}$/);
    assert.equal(secrets.DOERFLOW_M2M_CLIENT_ID, "");
    const firstSecret = secrets.SYNCROBRAIN_WEBHOOK_SECRET;
    const second = initScenarioEnv({ scenario: "agent-commerce", scenariosRoot: root });
    assert.ok(second.results.every((item) => item.action === "kept"));
    const again = parseDotEnv(readFileSync(join(dir, "peers.secrets.env"), "utf8"));
    assert.equal(again.SYNCROBRAIN_WEBHOOK_SECRET, firstSecret);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
