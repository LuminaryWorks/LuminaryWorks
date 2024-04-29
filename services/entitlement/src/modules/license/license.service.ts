import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { EntitlementException } from "../../common/errors";
import type { EntitlementConfig } from "../../config/entitlement.config";
import { GrantEntity } from "../../database/entities/grant.entity";
import { LicenseEntity } from "../../database/entities/license.entity";
import { OrganizationSeatEntity } from "../../database/entities/organization-seat.entity";
import {
  type LicensePayload,
  signLicensePayload,
  type SignedLicense,
  verifySignedLicense,
} from "../../license/ed25519";
import { AuditService } from "../audit/audit.service";

/**
 * Private-deployment License issuer / activator.
 * License injects DEPLOYMENT grants only — never disables Casbin resource ACL.
 */
@Injectable()
export class LicenseService {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  private getConf(): EntitlementConfig {
    return this.config.getOrThrow<EntitlementConfig>("entitlement");
  }

  issue(input: {
    licenseId: string;
    deploymentId: string;
    products: string[];
    features: Record<string, Record<string, boolean | number>>;
    seats?: Record<string, number>;
    expiresAt: string;
    offlineGraceDays?: number;
    customerName?: string;
    kid?: string;
    actor: string;
    requestId?: string;
  }): SignedLicense {
    const conf = this.getConf();
    if (!conf.licensePrivateKey) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "ENTITLEMENT_LICENSE_PRIVATE_KEY not configured (issuer only; never commit the key)",
      );
    }
    const kid = input.kid ?? conf.licenseDefaultKid;
    if (!kid) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        "kid required (or set ENTITLEMENT_LICENSE_DEFAULT_KID)",
      );
    }
    if (!conf.licensePublicKeys[kid]) {
      throw new EntitlementException(
        "VALIDATION_ERROR",
        `kid ${kid} missing from ENTITLEMENT_LICENSE_PUBLIC_KEYS ring`,
      );
    }

    const payload: LicensePayload = {
      licenseId: input.licenseId,
      kid,
      deploymentId: input.deploymentId,
      products: input.products,
      features: input.features,
      seats: input.seats,
      issuedAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      offlineGraceDays: input.offlineGraceDays ?? 14,
      customerName: input.customerName,
    };

    const signed = signLicensePayload(payload, conf.licensePrivateKey);
    void this.audit.record({
      actor: input.actor,
      action: "license.issue",
      resourceType: "license",
      resourceId: payload.licenseId,
      requestId: input.requestId,
      payload: { deploymentId: payload.deploymentId, kid, products: payload.products },
    });
    return signed;
  }

  async activate(input: { license: SignedLicense; actor: string; requestId?: string }) {
    const conf = this.getConf();
    const verified = verifySignedLicense(input.license, conf.licensePublicKeys);
    if (!verified.ok) {
      throw new EntitlementException(verified.code, verified.message);
    }
    const { payload } = verified;

    return this.dataSource.transaction(async (manager) => {
      let row = await manager.findOne(LicenseEntity, {
        where: { licenseId: payload.licenseId },
        lock: { mode: "pessimistic_write" },
      });

      if (!row) {
        row = manager.create(LicenseEntity, {
          licenseId: payload.licenseId,
          deploymentId: payload.deploymentId,
          kid: payload.kid,
          payload: payload as unknown as Record<string, unknown>,
          signature: input.license.signature,
          expiresAt: new Date(payload.expiresAt),
          offlineGraceDays: payload.offlineGraceDays,
          active: true,
          activatedAt: new Date(),
        });
      } else {
        row.deploymentId = payload.deploymentId;
        row.kid = payload.kid;
        row.payload = payload as unknown as Record<string, unknown>;
        row.signature = input.license.signature;
        row.expiresAt = new Date(payload.expiresAt);
        row.offlineGraceDays = payload.offlineGraceDays;
        row.active = true;
        row.activatedAt = new Date();
      }
      row = await manager.save(row);

      // Project grants per product — DEPLOYMENT subject only
      for (const productCode of payload.products) {
        const featMap = payload.features[productCode] ?? {};
        const features: GrantEntity["features"] = {};
        for (const [code, val] of Object.entries(featMap)) {
          if (typeof val === "boolean") {
            features[code] = { effect: val ? "allow" : "deny" };
          } else if (typeof val === "number") {
            features[code] = { effect: "allow", limitValue: val };
          }
        }

        const existingGrant = await manager.findOne(GrantEntity, {
          where: {
            subjectKind: "DEPLOYMENT",
            subjectId: payload.deploymentId,
            productCode,
            source: "license",
            sourceRef: payload.licenseId,
          },
        });
        if (existingGrant) {
          existingGrant.features = features;
          existingGrant.startsAt = new Date(payload.issuedAt);
          existingGrant.endsAt = new Date(payload.expiresAt);
          existingGrant.revoked = false;
          existingGrant.revokedAt = null;
          await manager.save(existingGrant);
        } else {
          await manager.save(
            manager.create(GrantEntity, {
              subjectKind: "DEPLOYMENT",
              subjectId: payload.deploymentId,
              productCode,
              planCode: "enterprise",
              features,
              startsAt: new Date(payload.issuedAt),
              endsAt: new Date(payload.expiresAt),
              source: "license",
              sourceRef: payload.licenseId,
              revoked: false,
            }),
          );
        }

        const seatLimit = payload.seats?.[productCode];
        if (seatLimit != null) {
          let seat = await manager.findOne(OrganizationSeatEntity, {
            where: {
              organizationId: `deployment:${payload.deploymentId}`,
              productCode,
            },
          });
          if (!seat) {
            seat = manager.create(OrganizationSeatEntity, {
              organizationId: `deployment:${payload.deploymentId}`,
              productCode,
              seatLimit,
              seatUsed: 0,
            });
          } else {
            seat.seatLimit = seatLimit;
          }
          await manager.save(seat);
        }
      }

      await this.audit.record({
        actor: input.actor,
        action: "license.activate",
        resourceType: "license",
        resourceId: row.id,
        requestId: input.requestId,
        payload: {
          licenseId: payload.licenseId,
          deploymentId: payload.deploymentId,
          withinGrace: verified.withinGrace,
          note: "License grants commercial features only; Casbin resource ACL remains enforced",
        },
      });

      return {
        license: row,
        withinGrace: verified.withinGrace,
        casbinBypass: false,
      };
    });
  }

  verifyLocal(license: SignedLicense, opts?: { productCode?: string; featureCode?: string }) {
    const conf = this.getConf();
    return verifySignedLicense(license, conf.licensePublicKeys, {
      requireProduct: opts?.productCode,
      requireFeature: opts?.featureCode,
    });
  }
}
