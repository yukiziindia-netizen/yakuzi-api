import { IsOptional, IsEnum, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentVerificationStatus } from '@prisma/client';

export class AdminQueryPaymentsDto {
  @ApiPropertyOptional({ enum: PaymentVerificationStatus, example: 'PENDING', description: 'Filter by verification status' })
  @IsOptional()
  @IsEnum(PaymentVerificationStatus)
  verificationStatus?: PaymentVerificationStatus;

  @ApiPropertyOptional({ example: 'uuid-of-order', description: 'Filter by order ID' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ example: 1, default: 1, description: 'Page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, description: 'Items per page (max 500)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 20;
}
