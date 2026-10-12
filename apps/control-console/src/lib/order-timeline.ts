export type TimelineEvent = {
  id: string;
  kind: "order" | "attempt" | "refund";
  status: string;
  provider: string;
  at: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function buildOrderTimeline(
  detail: Record<string, unknown>,
): TimelineEvent[] {
  const order = (detail.order ?? {}) as Record<string, unknown>;
  const attempts = Array.isArray(detail.attempts)
    ? (detail.attempts as Record<string, unknown>[])
    : [];
  const refunds = Array.isArray(detail.refunds)
    ? (detail.refunds as Record<string, unknown>[])
    : [];
  const events: TimelineEvent[] = [];
  if (order.id) {
    events.push({
      id: String(order.id),
      kind: "order",
      status: text(order.status),
      provider: text(order.paymentProvider),
      at: text(order.createdAt ?? order.updatedAt),
    });
  }
  for (const attempt of attempts) {
    events.push({
      id: String(attempt.id ?? ""),
      kind: "attempt",
      status: text(attempt.status),
      provider: text(attempt.provider ?? attempt.paymentProvider),
      at: text(attempt.createdAt ?? attempt.updatedAt),
    });
  }
  for (const refund of refunds) {
    events.push({
      id: String(refund.id ?? ""),
      kind: "refund",
      status: text(refund.status),
      provider: text(
        refund.provider ?? refund.paymentProvider ?? order.paymentProvider,
      ),
      at: text(refund.createdAt ?? refund.updatedAt),
    });
  }
  return events;
}
