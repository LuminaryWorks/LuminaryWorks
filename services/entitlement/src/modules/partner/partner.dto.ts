import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class RegisterPartnerDto {
  @ApiProperty({ example: "partner_acme" })
  @IsString()
  @MinLength(2)
  code!: string;

  @ApiProperty({ example: "Acme Joint Membership" })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  scopes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class PartnerBenefitDto {
  @ApiProperty()
  @IsString()
  productCode!: string;

  @ApiProperty({ example: "pro" })
  @IsString()
  planCode!: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  features?: Record<string, unknown>;
}

export class CreateRedemptionDto {
  @ApiProperty({ description: "Idempotent redemption key from partner" })
  @IsString()
  @MinLength(4)
  redemptionId!: string;

  @ApiPropertyOptional({ description: "Benefit template id; or provide productCode+planCode" })
  @IsOptional()
  @IsString()
  benefitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  planCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @ApiProperty({ description: "Luminary Account (Logto sub) to bind" })
  @IsString()
  logtoSub!: string;

  @ApiPropertyOptional()
  @IsOptional()
  features?: Record<string, { effect: "allow" | "deny"; limitValue?: number | null }>;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class RevokeRedemptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class OAuthTokenDto {
  @ApiProperty({ example: "client_credentials" })
  @IsString()
  grant_type!: string;

  @ApiProperty()
  @IsString()
  client_id!: string;

  @ApiProperty()
  @IsString()
  client_secret!: string;

  @ApiPropertyOptional({ description: "Space-delimited scopes subset" })
  @IsOptional()
  @IsString()
  scope?: string;
}

export class UpsertNotificationPreferenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  emailEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  inAppEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  pushEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emailAddress?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  pushTokens?: string[];
}

export class ActivateLicenseDto {
  @ApiProperty({ description: "Signed license document { payload, signature }" })
  @IsObject()
  license!: { payload: Record<string, unknown>; signature: string };
}

export class IssueLicenseDto {
  @ApiProperty()
  @IsString()
  licenseId!: string;

  @ApiProperty()
  @IsString()
  deploymentId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  products!: string[];

  @ApiProperty()
  features!: Record<string, Record<string, boolean | number>>;

  @ApiPropertyOptional()
  @IsOptional()
  seats?: Record<string, number>;

  @ApiProperty()
  @IsString()
  expiresAt!: string;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offlineGraceDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  kid?: string;
}
