import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { EntitlementException } from "../../common/errors";
import { ONCE_GRANTS } from "../../common/voice-packs";
import { GrantEntity } from "../../database/entities/grant.entity";
import { PromotionRedemptionEntity } from "../../database/entities/promotion-redemption.entity";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class PromotionsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async ensureOnceGrant(input: {
    subjectId: string;
    productCode: string;
    promotionCode: string;
    actor: string;
    requestId?: string | null;
  }): Promise<{ created: boolean; grantId: string; promotionCode: string }> {
    const spec = ONCE_GRANTS[input.promotionCode];
    if (!spec || spec.productCode !== input.productCode) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        `Unknown promotion ${input.promotionCode}`,
      );
    }

    const existing = await this.dataSource.getRepository(PromotionRedemptionEntity).findOne({
      where: {
        subjectId: input.subjectId,
        productCode: input.productCode,
        promotionCode: input.promotionCode,
      },
    });
    if (existing) {
      return { created: false, grantId: existing.grantId, promotionCode: input.promotionCode };
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `promo:${input.subjectId}:${input.productCode}:${input.promotionCode}`,
      ]);
      const raced = await manager.findOne(PromotionRedemptionEntity, {
        where: {
          subjectId: input.subjectId,
          productCode: input.productCode,
          promotionCode: input.promotionCode,
        },
      });
      if (raced) {
        return {
          created: false as const,
          grantId: raced.grantId,
          promotionCode: input.promotionCode,
        };
      }

      const grant = await manager.save(
        manager.create(GrantEntity, {
          subjectKind: "USER",
          subjectId: input.subjectId,
          productCode: input.productCode,
          planCode: null,
          features: spec.features,
          startsAt: new Date(),
          endsAt: null,
          source: "promotion",
          sourceRef: input.promotionCode,
          revoked: false,
        }),
      );
      await manager.save(
        manager.create(PromotionRedemptionEntity, {
          subjectId: input.subjectId,
          productCode: input.productCode,
          promotionCode: input.promotionCode,
          grantId: grant.id,
        }),
      );
      await this.audit.record({
        actor: input.actor,
        action: "promotion.ensure",
        resourceType: "grant",
        resourceId: grant.id,
        requestId: input.requestId ?? undefined,
        payload: { promotionCode: input.promotionCode, created: true },
      });
      return { created: true as const, grantId: grant.id, promotionCode: input.promotionCode };
    });
  }
}
