import { BadRequestException } from "@nestjs/common";
import { assertPrivateMatchDomains } from "@luminaryworks/notification";
import type { MailProfileScope, MailProviderKind, MailUsage } from "../database/entities/mail-profile.entity";

export type StoredCredentials =
  | { provider: "brevo"; apiKey: string }
  | { provider: "resend"; apiKey: string }
  | {
      provider: "smtp";
      host: string;
      port?: number;
      user?: string;
      pass?: string;
      secure?: boolean;
      requireTLS?: boolean;
    }
  | { provider: "mailgun"; apiKey: string; domain: string };

export interface ProfileWrite {
  scope: MailProfileScope;
  organizationId: string | null;
  fromAddress: string;
  fromName: string | null;
  provider: MailProviderKind;
  credentials?: StoredCredentials;
  matchDomains: string[];
  verified: boolean;
  enabled: boolean;
  usage: MailUsage;
  priority: number;
  dailyQuota: number;
  monthlyQuota: number;
}

const SCOPES = new Set(["platform", "organization", "deployment"]);
const PROVIDERS = new Set(["brevo", "resend", "smtp", "mailgun"]);
const USAGES = new Set(["auth", "product"]);

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function parseCredentials(provider: MailProviderKind, value: unknown): StoredCredentials {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record) throw new BadRequestException("credentials object required");
  if (provider === "smtp") {
    const host = str(record.host);
    if (!host) throw new BadRequestException("smtp host is required");
    return {
      provider: "smtp",
      host,
      port: typeof record.port === "number" ? record.port : undefined,
      user: str(record.user),
      pass: typeof record.pass === "string" ? record.pass : undefined,
      secure: typeof record.secure === "boolean" ? record.secure : undefined,
      requireTLS: typeof record.requireTLS === "boolean" ? record.requireTLS : undefined,
    };
  }
  const apiKey = str(record.apiKey);
  if (!apiKey) throw new BadRequestException(`${provider} apiKey is required`);
  if (provider === "mailgun") {
    const domain = str(record.domain);
    if (!domain) throw new BadRequestException("mailgun domain is required");
    return { provider: "mailgun", apiKey, domain };
  }
  return { provider, apiKey };
}

export function parseProfileWrite(body: unknown, partial: boolean): Partial<ProfileWrite> & {
  credentials?: StoredCredentials;
} {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!record) throw new BadRequestException("JSON object required");

  const scope = str(record.scope);
  const provider = str(record.provider);
  if (!partial || scope !== undefined) {
    if (!scope || !SCOPES.has(scope)) throw new BadRequestException("scope is invalid");
  }
  if (!partial || provider !== undefined) {
    if (!provider || !PROVIDERS.has(provider)) throw new BadRequestException("provider is invalid");
  }
  if (!partial && record.credentials === undefined) {
    throw new BadRequestException("credentials are required");
  }

  const fromAddress = str(record.from ?? record.fromAddress);
  if ((!partial || fromAddress !== undefined) && (!fromAddress || !fromAddress.includes("@"))) {
    throw new BadRequestException("from address is required");
  }

  const usage = str(record.usage);
  if (usage !== undefined && !USAGES.has(usage)) throw new BadRequestException("usage is invalid");

  let matchDomains: string[] | undefined;
  if (record.matchDomains !== undefined) {
    if (!Array.isArray(record.matchDomains)) {
      throw new BadRequestException("matchDomains must be a string array");
    }
    try {
      matchDomains = assertPrivateMatchDomains(
        record.matchDomains.filter((item): item is string => typeof item === "string"),
      );
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : "matchDomains invalid");
    }
  }

  const organizationId = str(record.organizationId) ?? null;
  const resolvedScope = (scope ?? undefined) as MailProfileScope | undefined;
  if (resolvedScope === "organization" && !organizationId) {
    throw new BadRequestException("organization scope requires organizationId");
  }

  const resolvedProvider = provider as MailProviderKind | undefined;
  const credentials =
    record.credentials !== undefined && resolvedProvider
      ? parseCredentials(resolvedProvider, record.credentials)
      : record.credentials !== undefined
        ? undefined
        : undefined;

  if (record.credentials !== undefined && !resolvedProvider && partial) {
    throw new BadRequestException("provider is required when rotating credentials");
  }

  return {
    ...(resolvedScope ? { scope: resolvedScope } : {}),
    ...(record.organizationId !== undefined || resolvedScope === "organization"
      ? { organizationId: resolvedScope === "organization" ? organizationId : organizationId }
      : {}),
    ...(fromAddress ? { fromAddress } : {}),
    ...(record.fromName !== undefined ? { fromName: str(record.fromName) ?? null } : {}),
    ...(resolvedProvider ? { provider: resolvedProvider } : {}),
    ...(credentials ? { credentials } : {}),
    ...(matchDomains ? { matchDomains } : {}),
    ...(record.verified !== undefined ? { verified: bool(record.verified, false) } : {}),
    ...(record.enabled !== undefined ? { enabled: bool(record.enabled, true) } : {}),
    ...(usage ? { usage: usage as MailUsage } : {}),
    ...(record.priority !== undefined ? { priority: int(record.priority, 100) } : {}),
    ...(record.dailyQuota !== undefined ? { dailyQuota: int(record.dailyQuota, 0) } : {}),
    ...(record.monthlyQuota !== undefined ? { monthlyQuota: int(record.monthlyQuota, 0) } : {}),
  };
}

export function completeProfileWrite(body: unknown): ProfileWrite {
  const parsed = parseProfileWrite(body, false);
  if (
    !parsed.scope ||
    !parsed.provider ||
    !parsed.fromAddress ||
    !parsed.credentials
  ) {
    throw new BadRequestException("profile is incomplete");
  }
  return {
    scope: parsed.scope,
    organizationId: parsed.scope === "organization" ? (parsed.organizationId ?? null) : null,
    fromAddress: parsed.fromAddress,
    fromName: parsed.fromName ?? null,
    provider: parsed.provider,
    credentials: parsed.credentials,
    matchDomains: parsed.matchDomains ?? [],
    verified: parsed.verified ?? false,
    enabled: parsed.enabled ?? true,
    usage: parsed.usage ?? "auth",
    priority: parsed.priority ?? 100,
    dailyQuota: parsed.dailyQuota ?? 0,
    monthlyQuota: parsed.monthlyQuota ?? 0,
  };
}
