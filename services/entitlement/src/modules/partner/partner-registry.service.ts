import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { SignJWT } from "jose";
import type { Repository } from "typeorm";
import { hashSecret, randomClientId, randomToken, verifySecretHash } from "../../common/crypto";
import { DEFAULT_PARTNER_SCOPES, PARTNER_SCOPES } from "../../common/partner-scopes";
import { EntitlementException } from "../../common/errors";
import type { EntitlementConfig } from "../../config/entitlement.config";
import { PartnerEntity } from "../../database/entities/partner.entity";
import { PartnerBenefitEntity } from "../../database/entities/partner-benefit.entity";
import { AuditService } from "../audit/audit.service";
import type { PartnerBenefitDto, RegisterPartnerDto } from "./partner.dto";

@Injectable()
export class PartnerRegistryService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PartnerEntity)
    private readonly partners: Repository<PartnerEntity>,
    @InjectRepository(PartnerBenefitEntity)
    private readonly benefits: Repository<PartnerBenefitEntity>,
    private readonly audit: AuditService,
  ) {}

  private getConf(): EntitlementConfig {
    return this.config.getOrThrow<EntitlementConfig>("entitlement");
  }

  async register(input: RegisterPartnerDto & { actor: string; requestId?: string }) {
    const existing = await this.partners.findOne({ where: { code: input.code } });
    if (existing) {
      throw new EntitlementException("CONFLICT", `Partner code ${input.code} already exists`);
    }
    const scopes = (input.scopes?.length ? input.scopes : DEFAULT_PARTNER_SCOPES).filter((s) =>
      (PARTNER_SCOPES as readonly string[]).includes(s),
    );
    const clientId = randomClientId("prt");
    const clientSecret = randomToken(32);
    const webhookSecret = randomToken(32);
    const conf = this.getConf();

    const partner = await this.partners.save(
      this.partners.create({
        code: input.code,
        name: input.name,
        active: true,
        clientId,
        clientSecretHash: hashSecret(clientSecret, conf.partnerSecretPepper),
        webhookSecret,
        webhookUrl: input.webhookUrl ?? null,
        scopes,
        metadata: input.metadata ?? {},
      }),
    );

    await this.audit.record({
      actor: input.actor,
      action: "partner.register",
      resourceType: "partner",
      resourceId: partner.id,
      requestId: input.requestId,
      payload: { code: partner.code, scopes },
    });

    // Return secrets once — never again from API
    return {
      partner: this.publicPartner(partner),
      credentials: {
        clientId,
        clientSecret,
        webhookSecret,
      },
    };
  }

  async rotateCredentials(partnerId: string, opts: { actor: string; requestId?: string }) {
    const partner = await this.partners.findOne({ where: { id: partnerId } });
    if (!partner) throw new EntitlementException("NOT_FOUND", "Partner not found");
    const conf = this.getConf();
    const clientSecret = randomToken(32);
    const webhookSecret = randomToken(32);
    partner.clientSecretHash = hashSecret(clientSecret, conf.partnerSecretPepper);
    partner.webhookSecret = webhookSecret;
    await this.partners.save(partner);
    await this.audit.record({
      actor: opts.actor,
      action: "partner.rotate_credentials",
      resourceType: "partner",
      resourceId: partner.id,
      requestId: opts.requestId,
    });
    return {
      partner: this.publicPartner(partner),
      credentials: {
        clientId: partner.clientId,
        clientSecret,
        webhookSecret,
      },
    };
  }

  async addBenefit(
    partnerId: string,
    dto: PartnerBenefitDto,
    opts: { actor: string; requestId?: string },
  ) {
    const partner = await this.partners.findOne({ where: { id: partnerId } });
    if (!partner) throw new EntitlementException("NOT_FOUND", "Partner not found");
    const benefit = await this.benefits.save(
      this.benefits.create({
        partnerId,
        productCode: dto.productCode,
        planCode: dto.planCode as PartnerBenefitEntity["planCode"],
        durationDays: dto.durationDays ?? null,
        features: dto.features ?? {},
      }),
    );
    await this.audit.record({
      actor: opts.actor,
      action: "partner.benefit.create",
      resourceType: "partner_benefit",
      resourceId: benefit.id,
      requestId: opts.requestId,
      payload: { productCode: dto.productCode, planCode: dto.planCode },
    });
    return benefit;
  }

  async listPartners() {
    const rows = await this.partners.find({ order: { createdAt: "DESC" } });
    return rows.map((p) => this.publicPartner(p));
  }

  async authenticateClientCredentials(input: {
    clientId: string;
    clientSecret: string;
    scope?: string;
  }): Promise<{ accessToken: string; tokenType: string; expiresIn: number; scope: string }> {
    if (!input.clientId || !input.clientSecret) {
      throw new EntitlementException("UNAUTHORIZED", "client_id and client_secret required");
    }
    const partner = await this.partners.findOne({
      where: { clientId: input.clientId, active: true },
    });
    if (!partner?.clientSecretHash) {
      throw new EntitlementException("UNAUTHORIZED", "Invalid client credentials");
    }
    const conf = this.getConf();
    if (!verifySecretHash(input.clientSecret, conf.partnerSecretPepper, partner.clientSecretHash)) {
      throw new EntitlementException("UNAUTHORIZED", "Invalid client credentials");
    }

    const requested = (input.scope ?? partner.scopes.join(" ")).split(/\s+/).filter(Boolean);
    const granted = requested.filter((s) => partner.scopes.includes(s));
    if (!granted.length) {
      throw new EntitlementException("FORBIDDEN", "No overlapping scopes");
    }

    const secret = new TextEncoder().encode(conf.partnerTokenSecret);
    const expiresIn = conf.partnerTokenTtlSeconds;
    const accessToken = await new SignJWT({
      partner_id: partner.id,
      partner_code: partner.code,
      scope: granted.join(" "),
    })
      .setProtectedHeader({ alg: "HS256", typ: "partner+jwt" })
      .setSubject(partner.clientId!)
      .setAudience("entitlement:partner")
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(secret);

    await this.audit.record({
      actor: partner.clientId!,
      action: "partner.token.issue",
      resourceType: "partner",
      resourceId: partner.id,
      payload: { scopes: granted },
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn,
      scope: granted.join(" "),
    };
  }

  publicPartner(partner: PartnerEntity) {
    return {
      id: partner.id,
      code: partner.code,
      name: partner.name,
      active: partner.active,
      clientId: partner.clientId,
      webhookUrl: partner.webhookUrl,
      scopes: partner.scopes,
      metadata: partner.metadata,
      createdAt: partner.createdAt,
      updatedAt: partner.updatedAt,
    };
  }
}
