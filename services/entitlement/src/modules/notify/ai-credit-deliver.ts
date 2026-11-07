import type { OutboxEventEntity } from "../../database/entities/outbox-event.entity";

export type AiCreditFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text: () => Promise<string> }>;

/**
 * POST the outbox payload to AI Platform.
 * Unset AI_PLATFORM_BASE_URL marks the row sent (warn) so lab outbox does not dead-letter.
 * A configured base URL requires HTTP 2xx; anything else throws for the outbox retry.
 */
export async function deliverAiCredit(input: {
  event: Pick<OutboxEventEntity, "eventType" | "payload">;
  baseUrl: string | undefined;
  serviceKey: string | undefined;
  fetchImpl: AiCreditFetch;
  timeoutMs?: number;
  warn?: (message: string) => void;
}): Promise<"sent"> {
  const base = input.baseUrl?.trim() ?? "";
  if (!base) {
    (input.warn ?? (() => undefined))(
      `AI_PLATFORM_BASE_URL unset; marking ${input.event.eventType} sent without calling AI Platform`,
    );
    return "sent";
  }
  const path = creditPath(input.event.eventType);
  const timeoutMs = Math.max(1000, input.timeoutMs ?? 15_000);
  const body = JSON.stringify(input.event.payload ?? {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let httpStatus: number;
  let rawText: string;
  try {
    const res = await input.fetchImpl(`${base.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-service-key": input.serviceKey?.trim() ?? "",
      },
      body,
      signal: controller.signal,
    });
    httpStatus = res.status;
    rawText = await res.text();
  } finally {
    clearTimeout(timer);
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    const detail = rawText.trim().slice(0, 300);
    throw new Error(
      `AI Platform ${input.event.eventType} HTTP ${httpStatus}${detail ? `: ${detail}` : ""}`,
    );
  }
  return "sent";
}

function creditPath(eventType: string): string {
  if (eventType === "ai.credit.grant") return "/v1/internal/credits/grant";
  if (eventType === "ai.credit.revoke") return "/v1/internal/credits/revoke";
  throw new Error(`Unsupported AI credit event ${eventType}`);
}
