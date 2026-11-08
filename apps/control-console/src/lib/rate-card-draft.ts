const RATE_UNITS = new Set([
  "1k_input_tokens",
  "1k_output_tokens",
  "1k_cached_input_tokens",
  "audio_second_in",
  "audio_second_out",
  "image",
  "assessment",
  "video_second",
]);

export type RateCardDraftError = "invalid" | "version";

export function validateRateCardDraft(
  text: string,
  published: Array<{ id: string; version: number }>,
):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: RateCardDraftError } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "invalid" };
  }
  const row = parsed as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.trim() === "")
    return { ok: false, error: "invalid" };
  if (
    typeof row.version !== "number" ||
    !Number.isInteger(row.version) ||
    row.version <= 0
  ) {
    return { ok: false, error: "invalid" };
  }
  if (
    typeof row.effectiveFrom !== "string" ||
    Number.isNaN(Date.parse(row.effectiveFrom))
  ) {
    return { ok: false, error: "invalid" };
  }
  if (!Array.isArray(row.lines) || row.lines.length === 0)
    return { ok: false, error: "invalid" };
  for (const line of row.lines) {
    if (!line || typeof line !== "object" || Array.isArray(line))
      return { ok: false, error: "invalid" };
    const item = line as Record<string, unknown>;
    if (
      typeof item.capability !== "string" ||
      item.capability.trim() === "" ||
      typeof item.providerType !== "string" ||
      item.providerType.trim() === "" ||
      typeof item.model !== "string" ||
      item.model.trim() === "" ||
      typeof item.unit !== "string" ||
      !RATE_UNITS.has(item.unit)
    ) {
      return { ok: false, error: "invalid" };
    }
    if (
      !nonNegativeInt(item.upstreamCostMicroUsd) ||
      !nonNegativeInt(item.markupBps)
    ) {
      return { ok: false, error: "invalid" };
    }
    if (
      item.fixedFeeMicro !== undefined &&
      !nonNegativeInt(item.fixedFeeMicro)
    ) {
      return { ok: false, error: "invalid" };
    }
  }
  const max = published
    .filter((card) => card.id === row.id)
    .reduce((highest, card) => Math.max(highest, card.version), 0);
  if ((row.version as number) <= max) return { ok: false, error: "version" };
  return { ok: true, body: row };
}

function nonNegativeInt(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
