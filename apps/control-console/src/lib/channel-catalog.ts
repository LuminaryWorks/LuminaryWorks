import type { ChannelRow } from "./channel-ops";
import { channelCanEnable } from "./channel-ops";
import {
  isCryptoProvider,
  type ProviderId,
  STRUCTURED_CREDENTIAL_FIELDS,
} from "./payment-providers";

/** Buyer checkout channels, in the default cashier order. */
export const CHECKOUT_CHANNEL_IDS = [
  "alipay_f2f",
  "paypal",
  "wechat_pay_v3",
  "unionpay_quickpass",
  "stripe_checkout",
  "coinbase_commerce",
  "okx_onchain",
  "bitpay",
  "doerflow_credit",
] as const satisfies readonly ProviderId[];

/** Adapters that already exist, kept off the default cashier list. */
export const MORE_CHANNEL_IDS = [
  "creem",
  "polar",
  "paddle",
] as const satisfies readonly ProviderId[];

export const CATALOG_CHANNEL_IDS = [
  ...CHECKOUT_CHANNEL_IDS,
  ...MORE_CHANNEL_IDS,
] as const satisfies readonly ProviderId[];

export type CatalogChannelId = (typeof CATALOG_CHANNEL_IDS)[number];

export type ChannelTag = "cn" | "global" | "crypto" | "mor" | "offline";

export type ChannelPhase =
  | "unconfigured"
  | "needs_test"
  | "test_failed"
  | "ready"
  | "enabled"
  | "enabled_retest";

export type CatalogConfig = ChannelRow & {
  id: string;
  providerId: string;
  enabled: unknown;
  priority: number;
  status?: string;
  marketScopes?: string[];
  currencies?: string[];
  merchantId?: string | null;
  credentialLastFour?: string | null;
  metadata?: Record<string, unknown>;
  lastTestIssues?: string[];
  updatedAt?: string;
  credentialPublic?: Record<string, string>;
};

const CHECKOUT_SET = new Set<string>(CHECKOUT_CHANNEL_IDS);
const CATALOG_SET = new Set<string>(CATALOG_CHANNEL_IDS);

export function isCheckoutChannel(providerId: string): boolean {
  return CHECKOUT_SET.has(providerId);
}

export function isCatalogChannel(
  providerId: string,
): providerId is CatalogChannelId {
  return CATALOG_SET.has(providerId);
}

export function isEnabledFlag(value: unknown): boolean {
  return value === true || value === "true";
}

export function priorityForIndex(index: number): number {
  return (index + 1) * 10;
}

export function channelTag(providerId: string): ChannelTag {
  if (providerId === "manual" || providerId === "contract") return "offline";
  if (
    providerId === "creem" ||
    providerId === "polar" ||
    providerId === "paddle"
  ) {
    return "mor";
  }
  if (
    providerId === "alipay_f2f" ||
    providerId === "wechat_pay_v3" ||
    providerId === "unionpay_quickpass"
  ) {
    return "cn";
  }
  if (isCryptoProvider(providerId)) return "crypto";
  return "global";
}

export function isChannelConfigured(
  providerId: string,
  row: CatalogConfig | null,
): boolean {
  if (!row) return false;
  if (providerId === "manual" || providerId === "contract") return true;
  return Boolean(row.credentialFingerprint);
}

export function channelPhase(
  providerId: string,
  row: CatalogConfig | null,
): ChannelPhase {
  if (!isChannelConfigured(providerId, row) || !row) return "unconfigured";
  const ready = channelCanEnable(row);
  if (isEnabledFlag(row.enabled) && ready) return "enabled";
  if (isEnabledFlag(row.enabled)) return "enabled_retest";
  if (ready) return "ready";
  if (row.lastTestOk === false) return "test_failed";
  return "needs_test";
}

export function enableNeedsSetup(
  providerId: string,
  row: CatalogConfig | null,
): boolean {
  if (!isChannelConfigured(providerId, row) || !row) return true;
  return !channelCanEnable(row);
}

export function representativeConfig(
  items: readonly CatalogConfig[],
  providerId: string,
): CatalogConfig | null {
  const rows = items.filter((item) => item.providerId === providerId);
  if (rows.length === 0) return null;
  const enabled = rows.filter((item) => isEnabledFlag(item.enabled));
  const pool = enabled.length > 0 ? enabled : rows;
  return pool.slice().sort((a, b) => {
    if (a.environment !== b.environment) {
      if (a.environment === "live") return -1;
      if (b.environment === "live") return 1;
    }
    return a.priority - b.priority;
  })[0];
}

export function resolveCatalogOrder(
  saved: readonly string[] | null | undefined,
): CatalogChannelId[] {
  const next: CatalogChannelId[] = [];
  for (const id of saved ?? []) {
    if (!isCatalogChannel(id) || next.includes(id)) continue;
    next.push(id);
  }
  for (const id of CATALOG_CHANNEL_IDS) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

export function reorderVisibleCatalog(
  order: readonly CatalogChannelId[],
  visible: readonly CatalogChannelId[],
  activeId: string,
  overId: string,
): CatalogChannelId[] {
  if (!isCatalogChannel(activeId) || !isCatalogChannel(overId))
    return [...order];
  if (activeId === overId) return [...order];
  if (!visible.includes(activeId) || !visible.includes(overId))
    return [...order];
  const from = visible.indexOf(activeId);
  const next = order.filter((id) => id !== activeId);
  const overIndex = next.indexOf(overId);
  if (from < 0 || overIndex < 0) return [...order];
  next.splice(
    from < visible.indexOf(overId) ? overIndex + 1 : overIndex,
    0,
    activeId,
  );
  return next;
}

export function credentialWriteMode(
  providerId: ProviderId,
  values: Record<string, string>,
): "absent" | "partial" | "complete" {
  const fields = STRUCTURED_CREDENTIAL_FIELDS[providerId];
  if (!fields?.length) return "absent";
  let any = false;
  let missing = false;
  for (const field of fields) {
    const filled = Boolean(values[field.key]?.trim());
    if (filled) any = true;
    if (!field.optional && !filled) missing = true;
  }
  if (!any) return "absent";
  return missing ? "partial" : "complete";
}

export function canSaveChannel(
  providerId: ProviderId,
  values: Record<string, string>,
  exists: boolean,
): boolean {
  if (providerId === "manual" || providerId === "contract") return true;
  const mode = credentialWriteMode(providerId, values);
  if (!exists) return mode === "complete";
  if (mode === "absent" || mode === "complete") return true;
  const fields = STRUCTURED_CREDENTIAL_FIELDS[providerId] ?? [];
  const secretTouched = fields.some(
    (field) => field.secret && values[field.key]?.trim(),
  );
  return !secretTouched;
}
