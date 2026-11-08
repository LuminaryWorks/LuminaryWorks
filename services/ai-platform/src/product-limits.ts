import { AiPlatformException } from "./common/errors";
import { readProductLimits, type ProductUsageLimit } from "./policy";

/**
 * Process-local rpm window and UTC-day charge ledger for hosted (non-BYOK) calls.
 * A missing product key applies no extra limit. Restart or a second replica starts empty.
 */

interface RpmWindow {
  windowStart: number;
  count: number;
}

interface DaySpend {
  day: string;
  spent: bigint;
}

const RPM_WINDOW_MS = 60_000;

export function hostedLimitApplies(byok: boolean): boolean {
  return !byok;
}

export function productLimitFor(
  productCode: string,
  env: NodeJS.ProcessEnv = process.env,
): ProductUsageLimit | null {
  const limits = loadLimits(env);
  return limits[productCode] ?? null;
}

export function enforceHostedProductRpm(
  productCode: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): void {
  const limit = productLimitFor(productCode, env);
  if (!limit) return;
  const existing = rpmWindows.get(productCode);
  if (!existing || now - existing.windowStart >= RPM_WINDOW_MS) {
    if (limit.rpm < 1) {
      throw rpmExceeded(productCode);
    }
    rpmWindows.set(productCode, { windowStart: now, count: 1 });
    return;
  }
  if (existing.count >= limit.rpm) {
    throw rpmExceeded(productCode);
  }
  existing.count += 1;
}

export function reserveHostedDailyCharge(
  productCode: string,
  micro: bigint,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): void {
  const limit = productLimitFor(productCode, env);
  if (!limit || micro <= 0n) return;
  const ceiling = BigInt(limit.dailyChargeMicro);
  const day = utcDay(now);
  const existing = daySpend.get(productCode);
  const spent = existing && existing.day === day ? existing.spent : 0n;
  if (spent + micro > ceiling) {
    throw new AiPlatformException(
      "RATE_LIMITED",
      429,
      `Product ${productCode} exceeded its daily charge ceiling`,
    );
  }
  daySpend.set(productCode, { day, spent: spent + micro });
}

export function releaseHostedDailyCharge(
  productCode: string,
  micro: bigint,
  now = Date.now(),
): void {
  if (micro <= 0n) return;
  const existing = daySpend.get(productCode);
  if (!existing || existing.day !== utcDay(now)) return;
  const next = existing.spent - micro;
  existing.spent = next > 0n ? next : 0n;
}

/** Tests only. Production callers share the process ledger. */
export function resetProductLimitLedgerForTests(): void {
  rpmWindows.clear();
  daySpend.clear();
}

const rpmWindows = new Map<string, RpmWindow>();
const daySpend = new Map<string, DaySpend>();

function loadLimits(env: NodeJS.ProcessEnv): Record<string, ProductUsageLimit> {
  try {
    return readProductLimits(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_PLATFORM_PRODUCT_LIMITS_JSON is invalid";
    throw new AiPlatformException("VALIDATION_ERROR", 503, message);
  }
}

function rpmExceeded(productCode: string): AiPlatformException {
  return new AiPlatformException("RATE_LIMITED", 429, `Product ${productCode} exceeded its request rate`);
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
