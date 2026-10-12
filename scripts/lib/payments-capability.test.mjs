import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkPaymentsCapability } from "./payments-capability.mjs";

test("rejects unknown payment modes, air-gapped checkout, and secrets", () => {
  assert.equal(checkPaymentsCapability({ capabilities: { payments: "platform" } }).length, 0);
  assert.ok(checkPaymentsCapability({ capabilities: {} }).length > 0);
  assert.ok(
    checkPaymentsCapability({
      profile: "air-gapped",
      capabilities: { payments: "platform" },
    }).some((issue) => issue.message.includes("air-gapped")),
  );
  assert.ok(
    checkPaymentsCapability({
      capabilities: { payments: "customer_managed" },
      apiKey: "sk_live_secret",
    }).some((issue) => issue.message.includes("secrets")),
  );
});

test("committed manifests declare a valid payments capability", () => {
  const dir = join(import.meta.dirname, "../../deploy/manifests");
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".json"))) {
    const manifest = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const issues = checkPaymentsCapability(manifest);
    assert.deepEqual(issues, [], name);
  }
});
