import assert from "node:assert/strict";
import test from "node:test";
import { priceUsage } from "../dist/wallet/rate-card.js";
import { grantsForSpend } from "../dist/wallet/spend-order.js";

const card = {
  id: "fixture",
  version: 1,
  lines: [
    line("chat.text", "1k_input_tokens", 1000n, 0),
    line("chat.text", "1k_output_tokens", 2000n, 3000),
    line("chat.text", "1k_cached_input_tokens", 100n, 0),
  ],
};

test("prices capability provider model and unit with markup rounded up", () => {
  const quote = priceUsage(card, "chat.text", "openai", "fixture-model", {
    promptTokens: 1000,
    completionTokens: 1,
  });
  assert.equal(quote.chargedMicro, 1000n + 3n);
  assert.equal(quote.upstreamCostMicroUsd, 1000n + 2n);
  assert.equal(quote.usedFallback, false);
  assert.equal(quote.rateCardVersion, 1);
});

test("missing cached or reasoning rows use the most expensive line", () => {
  const bare = {
    id: "fixture",
    version: 2,
    lines: [line("chat.text", "1k_output_tokens", 5000n, 0), line("chat.text", "1k_input_tokens", 1000n, 0)],
  };
  const quote = priceUsage(bare, "chat.text", "openai", "fixture-model", { cachedPromptTokens: 1000 });
  assert.equal(quote.usedFallback, true);
  assert.equal(quote.chargedMicro, 5000n);
});

test("a revoked grant is not spendable even when remaining is positive", () => {
  const now = new Date("2026-11-07T00:00:00Z");
  const revoked = grant("topup", 800n, null, null, "revoked");
  revoked.revokedAt = now;
  const ordered = grantsForSpend(
    [revoked, grant("topup", 100n, null, null, "live")],
    { productCode: "dataluminary", capability: "chat.text", now },
  );
  assert.deepEqual(ordered.map((row) => row.grantId), ["live"]);
});

test("spend order is restricted-expiring, general-expiring, then topup", () => {
  const now = new Date("2026-11-07T00:00:00Z");
  const ordered = grantsForSpend(
    [
      grant("topup", 10n, null, null, "t"),
      grant("subscription", 10n, hours(now, 5), null, "general"),
      grant("subscription", 10n, hours(now, 4), ["dataluminary"], "restricted-late"),
      grant("subscription", 10n, hours(now, 2), ["other"], "other-product"),
      grant("promo", 10n, hours(now, 1), ["dataluminary"], "restricted-soon"),
    ],
    { productCode: "dataluminary", capability: "chat.text", now },
  );
  assert.deepEqual(
    ordered.map((row) => row.grantId),
    ["restricted-soon", "restricted-late", "general", "t"],
  );
});

function line(capability, unit, upstream, markupBps) {
  return {
    capability,
    providerType: "openai",
    model: "fixture-model",
    unit,
    upstreamCostMicroUsd: upstream,
    markupBps,
    fixedFeeMicro: 0n,
  };
}

function grant(kind, remainingMicro, expiresAt, products, grantId) {
  return {
    grantId,
    kind,
    remainingMicro,
    expiresAt,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    restrictProductCodes: products,
    restrictCapabilities: products ? ["chat.text"] : null,
  };
}

function hours(now, count) {
  return new Date(now.getTime() + count * 60 * 60 * 1000);
}
