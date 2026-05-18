import { IsOptional, IsString, IsInt, Min, Max, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AdminQueryProductsDto {
  @ApiPropertyOptional({ example: 'uuid-of-seller', description: 'Filter by seller profile ID' })
  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @ApiPropertyOptional({ example: 'uuid-of-category', description: 'Filter by category ID' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'uuid-of-subcategory', description: 'Filter by sub-category ID' })
  @IsOptional()
  @IsUUID()
  subCategoryId?: string;

  @ApiPropertyOptional({ example: 'paracetamol', description: 'Search by product name or manufacturer' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'true', description: 'Filter by active status (true/false/all)' })
  @IsOptional()
  @IsString()
  isActive?: string;

  @ApiPropertyOptional({ example: 'PENDING', description: 'Filter by approval status (PENDING/APPROVED/REJECTED)' })
  @IsOptional()
  @IsString()
  approvalStatus?: string;

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
