import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from "class-validator";

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

export class CreateOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productCode?: string;

  @ApiPropertyOptional({ example: "pro" })
  @IsOptional()
  @IsString()
  planCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bundleSku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @ApiPropertyOptional({ example: "USD" })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: "mock" })
  @IsOptional()
  @IsString()
  paymentProvider?: string;
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
