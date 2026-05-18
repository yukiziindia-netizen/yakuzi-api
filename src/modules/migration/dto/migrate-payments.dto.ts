import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Legacy Payment ───────────────────────────────────

export class LegacyPaymentDto {
  @ApiProperty({ description: 'Legacy payment ID' })
  @IsNotEmpty()
  @IsString()
  legacyId: string;

  @ApiProperty({ description: 'Legacy order ID this payment belongs to' })
  @IsNotEmpty()
  @IsString()
  legacyOrderId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ enum: ['BANK_TRANSFER', 'UPI', 'COD', 'PARTIAL', 'CREDIT'] })
  @IsOptional()
  @IsEnum(['BANK_TRANSFER', 'UPI', 'COD', 'PARTIAL', 'CREDIT'] as const)
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proofUrl?: string;

  @ApiPropertyOptional({
    enum: ['PENDING', 'CONFIRMED', 'REJECTED'],
    description: 'Verification status from legacy system',
  })
  @IsOptional()
  @IsEnum(['PENDING', 'CONFIRMED', 'REJECTED'] as const)
  verificationStatus?: string;

  @ApiPropertyOptional({ description: 'ISO date string of original payment creation' })
  @IsOptional()
  @IsString()
  createdAt?: string;
}

// ─── Request DTO ──────────────────────────────────────

export class MigratePaymentsDto {
  @ApiProperty({ type: [LegacyPaymentDto], description: 'Array of legacy payments to import' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LegacyPaymentDto)
  payments: LegacyPaymentDto[];
}
