import { IsOptional, IsString, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AdminQuerySettlementsDto {
  @ApiPropertyOptional({ example: 'PENDING', description: 'Filter by payout status (PENDING, PROCESSED, PAID)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'uuid-of-seller', description: 'Filter by seller profile ID' })
  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @ApiPropertyOptional({ example: 'uuid-of-order-item', description: 'Filter by specific order item ID' })
  @IsOptional()
  @IsUUID()
  orderItemId?: string;

  @ApiPropertyOptional({ example: '2025-01-01', description: 'Filter settlements from this date (ISO)' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2025-12-31', description: 'Filter settlements until this date (ISO)' })
  @IsOptional()
  @IsString()
  dateTo?: string;

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
