import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryProductDto {
  @ApiPropertyOptional({ example: 'paracetamol', description: 'Search by name, manufacturer, or composition' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: 'uuid-of-category' })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'uuid-of-subcategory' })
  @IsString()
  @IsOptional()
  subCategoryId?: string;

  @ApiPropertyOptional({ example: 'Cipla Ltd' })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ example: 'name', default: 'name' })
  @IsString()
  @IsOptional()
  sortBy?: string = 'name';

  @ApiPropertyOptional({ example: 'asc', default: 'asc', enum: ['asc', 'desc'] })
  @IsString()
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'asc';

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isNew?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isDiscounted?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isBestSelling?: boolean;

  @ApiPropertyOptional({ example: 'APPROVED' })
  @IsString()
  @IsOptional()
  status?: string;
}
