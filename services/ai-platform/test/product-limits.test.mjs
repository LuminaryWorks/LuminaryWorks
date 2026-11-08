import assert from "node:assert/strict";
import test from "node:test";
import { AiPlatformException } from "../dist/common/errors.js";
import { readProductLimits } from "../dist/policy.js";
import {
  enforceHostedProductRpm,
  hostedLimitApplies,
  releaseHostedDailyCharge,
  reserveHostedDailyCharge,
  resetProductLimitLedgerForTests,
} from "../dist/product-limits.js";

const limits = {
  AI_PLATFORM_PRODUCT_LIMITS_JSON: JSON.stringify({
    vistaremote: { rpm: 1, dailyChargeMicro: 150 },
  }),
};

test("missing product and blank env add no extra limit", () => {
  resetProductLimitLedgerForTests();
  assert.equal(hostedLimitApplies(true), false);
  assert.equal(hostedLimitApplies(false), true);
  assert.deepEqual(readProductLimits({}), {});
  assert.doesNotThrow(() => enforceHostedProductRpm("dataluminary", {}));
  assert.doesNotThrow(() => reserveHostedDailyCharge("dataluminary", 10_000n, {}));
  assert.doesNotThrow(() => enforceHostedProductRpm("dataluminary", limits));
});

test("hosted rpm and daily charge ceilings reject the next call", () => {
  resetProductLimitLedgerForTests();
  const now = Date.parse("2026-11-07T00:00:00.000Z");
  enforceHostedProductRpm("vistaremote", limits, now);
  assert.throws(
    () => enforceHostedProductRpm("vistaremote", limits, now + 1_000),
    (error) => {
      assert.ok(error instanceof AiPlatformException);
      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.getStatus(), 429);
      return true;
    },
  );
  reserveHostedDailyCharge("vistaremote", 100n, limits, now);
  assert.throws(
    () => reserveHostedDailyCharge("vistaremote", 100n, limits, now),
    (error) => error instanceof AiPlatformException && error.code === "RATE_LIMITED",
  );
  releaseHostedDailyCharge("vistaremote", 100n, now);
  assert.doesNotThrow(() => reserveHostedDailyCharge("vistaremote", 100n, limits, now));
});

test("invalid product limit JSON fails closed", () => {
  assert.throws(
    () => enforceHostedProductRpm("vistaremote", { AI_PLATFORM_PRODUCT_LIMITS_JSON: "[]" }),
    (error) => error instanceof AiPlatformException && error.code === "VALIDATION_ERROR",
  );
});
