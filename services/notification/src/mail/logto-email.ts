import { BadRequestException } from "@nestjs/common";

export interface LogtoEmailRequest {
  to: string;
  type: string;
  code?: string;
  link?: string;
  locale?: string;
  organizationId?: string;
  applicationName?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseLogtoEmail(body: unknown): LogtoEmailRequest {
  const record = asRecord(body);
  if (!record) throw new BadRequestException("JSON object required");
  const to = typeof record.to === "string" ? record.to.trim() : "";
  const type = typeof record.type === "string" ? record.type.trim() : "";
  if (!to.includes("@") || !type) {
    throw new BadRequestException("to and type are required");
  }
  const payload = asRecord(record.payload) ?? {};
  const organization = asRecord(payload.organization);
  const application = asRecord(payload.application);
  return {
    to,
    type,
    code: typeof payload.code === "string" ? payload.code : undefined,
    link: typeof payload.link === "string" ? payload.link : undefined,
    locale: typeof payload.locale === "string" ? payload.locale : undefined,
    organizationId: typeof organization?.id === "string" ? organization.id : undefined,
    applicationName: typeof application?.name === "string" ? application.name : undefined,
  };
}
