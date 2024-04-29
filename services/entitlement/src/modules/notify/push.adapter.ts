import { Injectable, Logger } from "@nestjs/common";
import type { NotifyAdapter, NotifyMessage } from "./notify-adapter";

/**
 * App push interface — products inject a real FCM/APNs implementation later.
 * Default records intended deliveries; throws if tokens present but push not wired
 * in production (configurable no-op when no tokens).
 */
export interface AppPushSender {
  sendPush(input: {
    tokens: string[];
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }): Promise<void>;
}

export const APP_PUSH_SENDER = Symbol("APP_PUSH_SENDER");

@Injectable()
export class PushNotifyAdapter implements NotifyAdapter {
  readonly channel = "push" as const;
  private readonly logger = new Logger(PushNotifyAdapter.name);
  private sender: AppPushSender | null = null;

  setSender(sender: AppPushSender | null): void {
    this.sender = sender;
  }

  isConfigured(): boolean {
    return this.sender != null;
  }

  async send(message: NotifyMessage): Promise<void> {
    const tokens = message.pushTokens ?? [];
    if (!tokens.length) {
      this.logger.debug(`push skipped: no tokens for ${message.logtoSub}`);
      return;
    }
    if (!this.sender) {
      throw new Error("App push sender not configured");
    }
    await this.sender.sendPush({
      tokens,
      title: message.title,
      body: message.body,
      data: {
        eventType: message.eventType,
        productCode: message.productCode,
        ...(message.metadata ?? {}),
      },
    });
  }
}
