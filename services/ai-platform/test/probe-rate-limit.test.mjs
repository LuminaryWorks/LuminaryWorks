import assert from "node:assert/strict";
import test from "node:test";
import { TokenBucket } from "../dist/probe-rate-limit.js";

test("probe token bucket refills and rejects an empty bucket", () => {
  const previousCapacity = process.env.AI_PLATFORM_PROBE_RATE_CAPACITY;
  const previousRefill = process.env.AI_PLATFORM_PROBE_RATE_REFILL_PER_SEC;
  process.env.AI_PLATFORM_PROBE_RATE_CAPACITY = "2";
  process.env.AI_PLATFORM_PROBE_RATE_REFILL_PER_SEC = "0.5";
  try {
    const bucket = new TokenBucket();
    assert.equal(bucket.take("user:a", 0), true);
    assert.equal(bucket.take("user:a", 0), true);
    assert.equal(bucket.take("user:a", 0), false);
    assert.equal(bucket.take("user:b", 0), true);
    assert.equal(bucket.take("user:a", 10_000), true);
  } finally {
    restore("AI_PLATFORM_PROBE_RATE_CAPACITY", previousCapacity);
    restore("AI_PLATFORM_PROBE_RATE_REFILL_PER_SEC", previousRefill);
  }
});

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
