export type CommerceJson = Record<string, unknown>;

const PRICE_FIELDS = ["amountCents", "amountMinor", "currency", "planCode", "endsAt"] as const;

export type CheckoutAction =
  | { kind: "qr"; qrPayload: string }
  | { kind: "redirect"; url: string }
  | { kind: "manual"; instructions: string }
  | { kind: "complete"; orderId: string };

export type PaymentErrorCode =
  | "PAYMENT_PROVIDER_UNAVAILABLE"
  | "PAYMENT_PROVIDER_FORBIDDEN_MARKET"
  | "PAYMENT_PRICE_MISMATCH"
  | "PAYMENT_CHANNEL_TEST_REQUIRED"
  | "UNKNOWN";

export function stripClientPriceFields(body: CommerceJson): CommerceJson {
  const next = { ...body };
  for (const field of PRICE_FIELDS) delete next[field];
  return next;
}

export function buildCreateOrderBody(input: {
  offeringId: string;
  productCode: string;
  interval: "month" | "year";
  providerHint?: string;
  returnUrl?: string;
}): CommerceJson {
  return stripClientPriceFields({
    offeringId: input.offeringId,
    productCode: input.productCode,
    interval: input.interval,
    providerHint: input.providerHint,
    returnUrl: input.returnUrl,
    amountCents: 1,
    currency: "USD",
    planCode: "pro",
  });
}

export function nextCheckoutAction(payResult: CommerceJson, orderId: string): CheckoutAction {
  const qr =
    (typeof payResult.qrPayload === "string" && payResult.qrPayload) ||
    (typeof payResult.qrCode === "string" && payResult.qrCode) ||
    "";
  if (qr) return { kind: "qr", qrPayload: qr };
  const url =
    (typeof payResult.checkoutUrl === "string" && payResult.checkoutUrl) ||
    (typeof payResult.redirectUrl === "string" && payResult.redirectUrl) ||
    "";
  if (url) return { kind: "redirect", url };
  const action = payResult.action;
  if (action && typeof action === "object") {
    const type = String((action as CommerceJson).type ?? "");
    if (type.includes("manual")) {
      return {
        kind: "manual",
        instructions: String((action as CommerceJson).instructions ?? type),
      };
    }
  }
  return { kind: "complete", orderId };
}

export function sellableOfferings(
  items: Array<CommerceJson>,
  interval: "month" | "year",
): Array<CommerceJson> {
  return items.filter((item) => {
    const plan = String(item.planCode ?? item.plan ?? "");
    const itemInterval = String(item.interval ?? item.billingInterval ?? "");
    if (plan === "free" || plan === "none") return false;
    if (plan !== "pro" && plan !== "ultra") return false;
    return itemInterval === interval;
  });
}

export function offeringIdOf(item: CommerceJson): string {
  return String(item.id ?? item.offeringId ?? item.sku ?? "");
}

export function methodsForCurrency(
  methods: CommerceJson[],
  currency: string | undefined,
): CommerceJson[] {
  const wanted = currency?.trim().toUpperCase();
  if (!wanted) return methods;
  return methods.filter((item) => {
    const currencies = Array.isArray(item.currencies) ? item.currencies : [];
    if (currencies.length === 0) return true;
    return currencies.some((value) => String(value).toUpperCase() === wanted);
  });
}

export function methodsForMarket(methods: CommerceJson[], market: "CN" | "GLOBAL"): CommerceJson[] {
  return methods.filter((item) => {
    if (item.enabled === false) return false;
    const scopes = Array.isArray(item.marketScopes) ? item.marketScopes.map(String) : [];
    if (scopes.length === 0) return true;
    return scopes.includes(market);
  });
}

export function methodIdOf(item: CommerceJson): string {
  return String(item.providerId ?? item.id ?? item.configId ?? "");
}

export function methodLabelOf(item: CommerceJson): string {
  return String(item.name ?? item.providerId ?? item.id ?? item.configId ?? "");
}

export function mapPaymentError(code: string | undefined): PaymentErrorCode {
  if (
    code === "PAYMENT_PROVIDER_UNAVAILABLE" ||
    code === "PAYMENT_PROVIDER_FORBIDDEN_MARKET" ||
    code === "PAYMENT_PRICE_MISMATCH" ||
    code === "PAYMENT_CHANNEL_TEST_REQUIRED"
  ) {
    return code;
  }
  return "UNKNOWN";
}

export function checkoutEntryVisible(input: {
  paymentsMode: string;
  methodCount: number;
}): boolean {
  if (input.paymentsMode === "disabled") return false;
  return input.methodCount > 0;
}

export function isFreeLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "free" ||
    normalized === "free plan" ||
    value.includes("免费版") ||
    value.includes("免费用户")
  );
}
