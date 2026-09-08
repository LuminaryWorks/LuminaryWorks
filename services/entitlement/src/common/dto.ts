import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class EntitlementsQueryDto {
  @ApiProperty({ example: "vistaremote" })
  @IsString()
  productCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deploymentId?: string;
}

export class CheckFeatureDto {
  @ApiProperty()
  @IsString()
  featureCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  need?: number;
}

export class CheckEntitlementsDto {
  @ApiProperty({ example: "vistaremote" })
  @IsString()
  productCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deploymentId?: string;

  @ApiProperty({ type: [CheckFeatureDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckFeatureDto)
  features!: CheckFeatureDto[];
}

export class ConsumeEntitlementDto {
  @ApiProperty({ example: "vistaremote" })
  @IsString()
  productCode!: string;

  @ApiProperty()
  @IsString()
  featureCode!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deploymentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class AllocateResourceDto {
  @ApiProperty({ example: "dataluminary" })
  @IsString()
  productCode!: string;

  @ApiProperty({ example: "dashboard.count" })
  @IsString()
  featureCode!: string;

  @ApiProperty({
    example: "dash_123",
    description: "Stable product resource id (dashboard, object, dataset, device).",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  resourceId!: string;

  @ApiProperty({
    example: 1,
    description:
      "Absolute nonnegative amount for this resource (count or bytes). Repeating the same amount is idempotent.",
  })
  @IsInt()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deploymentId?: string;

  @ApiPropertyOptional({ description: "Resource owner kind (USER / ORGANIZATION / DEPLOYMENT)." })
  @IsOptional()
  @IsString()
  ownerKind?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class ReleaseResourceDto {
  @ApiProperty({ example: "dataluminary" })
  @IsString()
  productCode!: string;

  @ApiProperty({ example: "dashboard.count" })
  @IsString()
  featureCode!: string;

  @ApiProperty({ example: "dash_123" })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  resourceId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deploymentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class ReconcileGaugeUsageDto {
  @ApiPropertyOptional({ enum: ["USER", "ORGANIZATION", "DEPLOYMENT"] })
  @IsOptional()
  @IsString()
  subjectKind?: "USER" | "ORGANIZATION" | "DEPLOYMENT";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  featureCode?: string;
}

export class EnsureTrialDto {
  @ApiProperty({ example: "vistaremote" })
  @IsString()
  productCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deploymentId?: string;
}

export class AcceptPolicyDto {
  @ApiProperty({ example: "lw-legal-v2026-09-07" })
  @IsString()
  @MinLength(1)
  policyVersion!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ["terms", "privacy", "trial-deletion"],
    description:
      "Must include terms, privacy, and trial-deletion. Subject is never taken from the body.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentKeys?: string[];
}

export class EnsurePromotionDto {
  @ApiProperty({ example: "blockyedu" })
  @IsString()
  productCode!: string;

  @ApiProperty({ example: "ai.voice.signup.300s" })
  @IsString()
  promotionCode!: string;
}

export class CreateOrderDto {
  @ApiPropertyOptional({
    description: "Published offering id. Provide offeringId or sku (not client prices).",
  })
  @IsOptional()
  @IsString()
  offeringId?: string;

  @ApiPropertyOptional({
    example: "dataluminary.pro.month.CNY",
    description: "Published offering sku. Alternative to offeringId.",
  })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({
    description: "Optional product hint; must match the published offering when set.",
  })
  @IsOptional()
  @IsString()
  productCode?: string;

  @ApiPropertyOptional({
    example: "month",
    description: "Optional interval hint; must match the published offering when set.",
  })
  @IsOptional()
  @IsString()
  interval?: string;

  @ApiPropertyOptional({
    example: "alipay_f2f",
    description: "Preferred provider when operationally enabled. Not a price field.",
  })
  @IsOptional()
  @IsString()
  providerHint?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  returnUrl?: string;

  @ApiPropertyOptional({
    description: "Server-priced quota pack SKU (not a client amount).",
  })
  @IsOptional()
  @IsString()
  packSku?: string;

  @ApiPropertyOptional({
    description: "Bundle SKU; still requires a published offering unless used with packSku.",
  })
  @IsOptional()
  @IsString()
  bundleSku?: string;
}

export class OfferingDraftDto {
  @ApiProperty({ example: "dataluminary.pro.month.CNY" })
  @IsString()
  sku!: string;

  @ApiProperty({ example: "dataluminary" })
  @IsString()
  productCode!: string;

  @ApiProperty({ example: "pro" })
  @IsString()
  planCode!: string;

  @ApiProperty({ example: "month" })
  @IsString()
  interval!: string;

  @ApiProperty({ example: "CNY" })
  @IsString()
  currency!: string;

  @ApiProperty({ example: 9900, description: "Integer minor units; must be > 0." })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ example: "CN" })
  @IsString()
  market!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CatalogRevisionDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: "Copy offerings from the published revision (default true).",
  })
  @IsOptional()
  @IsBoolean()
  copyFromPublished?: boolean;

  @ApiPropertyOptional({ type: [OfferingDraftDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfferingDraftDto)
  offerings?: OfferingDraftDto[];
}

export class ReplaceCatalogOfferingsDto {
  @ApiProperty({ type: [OfferingDraftDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfferingDraftDto)
  offerings!: OfferingDraftDto[];
}

export class AdminGrantDto {
  @ApiProperty({ enum: ["USER", "ORGANIZATION", "DEPLOYMENT"] })
  @IsString()
  subjectKind!: "USER" | "ORGANIZATION" | "DEPLOYMENT";

  @ApiProperty()
  @IsString()
  subjectId!: string;

  @ApiProperty()
  @IsString()
  productCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  planCode?: "trial" | "pro" | "ultra" | "enterprise";

  @ApiPropertyOptional()
  @IsOptional()
  features?: Record<string, { effect: "allow" | "deny"; limitValue?: number | null }>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endsAt?: string;

  @ApiPropertyOptional({ example: "contract" })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  seatLimit?: number;
}
