/** 1 credit = 1_000_000 micro. Display helper for wallet amounts. */
export function formatMicro(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "0";
  const negative = value < 0;
  const abs = Math.abs(Math.trunc(value));
  const whole = Math.trunc(abs / 1_000_000);
  const frac = String(abs % 1_000_000).padStart(6, "0");
  const trimmed = frac.replace(/0+$/, "");
  const text = trimmed ? `${whole}.${trimmed}` : String(whole);
  return negative ? `-${text}` : text;
}
