import { describe, expect, it } from "@rstest/core";
import { validateRateCardDraft } from "./rate-card-draft";

const line = {
  capability: "chat.text",
  providerType: "openai",
  model: "gpt-4o-mini",
  unit: "1k_input_tokens",
  upstreamCostMicroUsd: 1000,
  markupBps: 1500,
  fixedFeeMicro: 0,
};

describe("validateRateCardDraft", () => {
  it("accepts a higher version and rejects a replay", () => {
    const text = JSON.stringify({
      id: "default",
      version: 2,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      lines: [line],
    });
    expect(
      validateRateCardDraft(text, [{ id: "default", version: 1 }]).ok,
    ).toBe(true);
    const replay = JSON.stringify({
      id: "default",
      version: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      lines: [line],
    });
    expect(
      validateRateCardDraft(replay, [{ id: "default", version: 1 }]),
    ).toEqual({
      ok: false,
      error: "version",
    });
  });

  it("rejects malformed JSON and unknown units", () => {
    expect(validateRateCardDraft("{", [])).toEqual({
      ok: false,
      error: "invalid",
    });
    const badUnit = JSON.stringify({
      id: "default",
      version: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      lines: [{ ...line, unit: "token" }],
    });
    expect(validateRateCardDraft(badUnit, [])).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});
