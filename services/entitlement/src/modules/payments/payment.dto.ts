import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { PAYMENT_ENVIRONMENTS, PAYMENT_PROVIDER_IDS } from "../../common/payment-providers";

export class CreatePaymentProviderConfigDto {
  @ApiProperty({ example: "mock" })
  @IsString()
  @IsIn([...PAYMENT_PROVIDER_IDS])
  providerId!: string;

  @ApiPropertyOptional({ enum: PAYMENT_ENVIRONMENTS })
  @IsOptional()
  @IsString()
  @IsIn([...PAYMENT_ENVIRONMENTS])
  environment?: "sandbox" | "live";

  @ApiPropertyOptional({ type: [String], example: ["CN", "GLOBAL"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  marketScopes?: string[];

  @ApiPropertyOptional({ type: [String], example: ["CNY", "USD"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  currencies?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  capabilities?: Record<string, boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  merchantId?: string;

  @ApiPropertyOptional({
    description: "String-valued credential map. Never returned by GET.",
  })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdatePaymentProviderConfigDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  marketScopes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  currencies?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  capabilities?: Record<string, boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  merchantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: PAYMENT_ENVIRONMENTS })
  @IsOptional()
  @IsString()
  @IsIn([...PAYMENT_ENVIRONMENTS])
  environment?: "sandbox" | "live";
}

export class RotatePaymentProviderConfigDto {
  @ApiProperty({ description: "Replacement string-valued credentials. Never echoed." })
  @IsObject()
  credentials!: Record<string, string>;
}

export class BillingCountryDto {
  @ApiProperty({ example: "US" })
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country!: string;
}

export class AdminBillingCountryDto extends BillingCountryDto {
  @ApiProperty()
  @IsString()
  subjectId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectKind?: "USER" | "ORGANIZATION" | "DEPLOYMENT";

  @ApiProperty()
  @IsString()
  reason!: string;
}

export class ManualConfirmDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  reason!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  ticket!: string;
}

export class RefundOrderDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  amountCents!: number;

  @ApiProperty()
  @IsString()
  refundIdempotencyKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ticket?: string;
}
