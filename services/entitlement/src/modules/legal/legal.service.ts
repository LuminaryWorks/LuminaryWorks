import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { In, type Repository } from "typeorm";
import type { EntitlementConfig } from "../../config/entitlement.config";
import { EntitlementException } from "../../common/errors";
import {
  LEGAL_DOCUMENT_KEYS,
  type LegalDocumentKey,
  isLegalDocumentKey,
  legalDocumentsForVersion,
} from "../../common/legal-policy";
import { PolicyAcceptanceEntity } from "../../database/entities/policy-acceptance.entity";
import { AuditService } from "../audit/audit.service";

export interface AcceptPolicyInput {
  logtoSub: string;
  policyVersion: string;
  documentKeys?: string[];
  ip?: string | null;
  userAgent?: string | null;
  actor: string;
  requestId?: string | null;
  /** Ignored if present — never trust a browser-supplied subject. */
  subjectId?: string;
}

@Injectable()
export class LegalService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PolicyAcceptanceEntity)
    private readonly acceptances: Repository<PolicyAcceptanceEntity>,
    private readonly audit: AuditService,
  ) {}

  private conf(): EntitlementConfig {
    return this.config.getOrThrow<EntitlementConfig>("entitlement");
  }

  currentPolicyVersion(): string {
    return this.conf().legalPolicyVersion;
  }

  async getCurrentManifest(logtoSub: string) {
    const conf = this.conf();
    const documents = legalDocumentsForVersion(conf.legalPolicyVersion, conf.legalPublicBaseUrl);
    const rows = await this.acceptances.find({
      where: { logtoSub, policyVersion: conf.legalPolicyVersion },
    });
    const byKind = new Map(rows.map((row) => [row.policyKind, row]));
    const acceptedDocuments = LEGAL_DOCUMENT_KEYS.filter((key) => byKind.has(key)).map((key) => {
      const row = byKind.get(key)!;
      return {
        key,
        version: row.documentVersion,
        acceptedAt: row.acceptedAt.toISOString(),
      };
    });
    const accepted = acceptedDocuments.length === LEGAL_DOCUMENT_KEYS.length;
    const acceptedAt = accepted
      ? (rows
          .map((row) => row.acceptedAt)
          .sort((a, b) => a.getTime() - b.getTime())[0]
          ?.toISOString() ?? null)
      : null;
    return {
      policyVersion: conf.legalPolicyVersion,
      requiredDocumentKeys: [...LEGAL_DOCUMENT_KEYS],
      documents,
      accepted,
      acceptedAt,
      acceptedDocuments,
    };
  }

  async assertCurrentPolicyAccepted(logtoSub: string): Promise<void> {
    const version = this.currentPolicyVersion();
    const rows = await this.acceptances.find({
      where: { logtoSub, policyVersion: version, policyKind: In([...LEGAL_DOCUMENT_KEYS]) },
    });
    const have = new Set(rows.map((row) => row.policyKind));
    const missing = LEGAL_DOCUMENT_KEYS.filter((key) => !have.has(key));
    if (missing.length > 0) {
      throw new EntitlementException(
        "TRIAL_POLICY_NOT_ACCEPTED",
        "Current terms, privacy, and trial-deletion documents must be accepted before creating a Trial",
        {
          details: {
            policyVersion: version,
            missingDocumentKeys: missing,
          },
        },
      );
    }
  }

  async accept(input: AcceptPolicyInput) {
    void input.subjectId;
    const conf = this.conf();
    if (input.policyVersion !== conf.legalPolicyVersion) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "policyVersion must match the current required policy",
        {
          details: {
            currentPolicyVersion: conf.legalPolicyVersion,
            requestedPolicyVersion: input.policyVersion,
          },
        },
      );
    }

    const keys = this.resolveDocumentKeys(input.documentKeys);
    const existing = await this.acceptances.find({
      where: {
        logtoSub: input.logtoSub,
        policyVersion: conf.legalPolicyVersion,
        policyKind: In(keys),
      },
    });
    const have = new Set(existing.map((row) => row.policyKind));
    const missing = keys.filter((key) => !have.has(key));
    const acceptedAt = new Date();

    if (missing.length === 0) {
      return this.toAcceptResult(input.logtoSub, conf.legalPolicyVersion, existing, true);
    }

    const created: PolicyAcceptanceEntity[] = [];
    try {
      for (const key of missing) {
        created.push(
          await this.acceptances.save(
            this.acceptances.create({
              logtoSub: input.logtoSub,
              policyKind: key,
              policyVersion: conf.legalPolicyVersion,
              documentKey: key,
              documentVersion: conf.legalPolicyVersion,
              acceptedAt,
              ip: input.ip ?? null,
              userAgent: input.userAgent ?? null,
            }),
          ),
        );
      }
    } catch (err) {
      const again = await this.acceptances.find({
        where: {
          logtoSub: input.logtoSub,
          policyVersion: conf.legalPolicyVersion,
          policyKind: In(keys),
        },
      });
      if (again.length === keys.length) {
        return this.toAcceptResult(input.logtoSub, conf.legalPolicyVersion, again, true);
      }
      throw err;
    }

    await this.audit.record({
      actor: input.actor,
      action: "policy.accept",
      resourceType: "policy_acceptance",
      resourceId: input.logtoSub,
      requestId: input.requestId,
      payload: {
        policyVersion: conf.legalPolicyVersion,
        documentKeys: keys,
        ip: input.ip ?? null,
      },
    });

    return this.toAcceptResult(
      input.logtoSub,
      conf.legalPolicyVersion,
      [...existing, ...created],
      false,
    );
  }

  async listAcceptances(filter: { logtoSub?: string; policyVersion?: string; limit?: number }) {
    const qb = this.acceptances.createQueryBuilder("p").orderBy("p.accepted_at", "DESC");
    if (filter.logtoSub) {
      qb.andWhere("p.logto_sub = :sub", { sub: filter.logtoSub });
    }
    if (filter.policyVersion) {
      qb.andWhere("p.policy_version = :version", { version: filter.policyVersion });
    }
    qb.take(Math.min(Math.max(filter.limit ?? 100, 1), 500));
    return qb.getMany();
  }

  private resolveDocumentKeys(requested?: string[]): LegalDocumentKey[] {
    if (!requested || requested.length === 0) {
      return [...LEGAL_DOCUMENT_KEYS];
    }
    const unknown = requested.filter((key) => !isLegalDocumentKey(key));
    if (unknown.length > 0) {
      throw new EntitlementException("VALIDATION_ERROR", "Unknown document keys", {
        details: { unknownDocumentKeys: unknown },
      });
    }
    const unique = [...new Set(requested)] as LegalDocumentKey[];
    const missing = LEGAL_DOCUMENT_KEYS.filter((key) => !unique.includes(key));
    if (missing.length > 0) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "Accepting the current policy requires terms, privacy, and trial-deletion",
        { details: { missingDocumentKeys: missing } },
      );
    }
    return [...LEGAL_DOCUMENT_KEYS];
  }

  private toAcceptResult(
    logtoSub: string,
    policyVersion: string,
    rows: PolicyAcceptanceEntity[],
    idempotent: boolean,
  ) {
    const acceptedAt = rows
      .map((row) => row.acceptedAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return {
      logtoSub,
      policyVersion,
      idempotent,
      accepted: true,
      acceptedAt: acceptedAt?.toISOString() ?? null,
      documents: rows.map((row) => ({
        key: row.documentKey,
        version: row.documentVersion,
        policyKind: row.policyKind,
        acceptedAt: row.acceptedAt.toISOString(),
        ip: row.ip,
        userAgent: row.userAgent,
      })),
    };
  }
}
