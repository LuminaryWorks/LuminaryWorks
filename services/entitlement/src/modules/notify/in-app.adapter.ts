import { Injectable, Logger } from "@nestjs/common";
import type { NotifyAdapter, NotifyMessage } from "./notify-adapter";

/** In-app notification sink — products poll or subscribe via outbox projection. */
@Injectable()
export class InAppNotifyAdapter implements NotifyAdapter {
  readonly channel = "in_app" as const;
  private readonly logger = new Logger(InAppNotifyAdapter.name);
  readonly messages: NotifyMessage[] = [];

  isConfigured(): boolean {
    return true;
  }

  async send(message: NotifyMessage): Promise<void> {
    this.messages.push(message);
    if (this.messages.length > 1000) this.messages.splice(0, this.messages.length - 1000);
    this.logger.log(
      `in_app event=${message.eventType} user=${message.logtoSub} product=${message.productCode}`,
    );
  }
}
