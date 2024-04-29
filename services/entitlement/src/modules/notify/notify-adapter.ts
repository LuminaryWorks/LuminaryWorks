export type NotifyChannel = "in_app" | "email" | "push";

export interface NotifyMessage {
  eventType: string;
  logtoSub: string;
  productCode: string;
  title: string;
  body: string;
  emailAddress?: string | null;
  pushTokens?: string[];
  metadata?: Record<string, unknown>;
}

export interface NotifyAdapter {
  readonly channel: NotifyChannel;
  isConfigured(): boolean;
  send(message: NotifyMessage): Promise<void>;
}

export const NOTIFY_ADAPTERS = Symbol("NOTIFY_ADAPTERS");
