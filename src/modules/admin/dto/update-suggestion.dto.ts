import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean, IsUUID } from 'class-validator';

export class UpdateSuggestionDto {
  @ApiPropertyOptional({ example: 'Baconil 2mg' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Manufacturer Name' })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'Nicotine 2mg' })
  @IsString()
  @IsOptional()
  chemicalComposition?: string;

  @ApiPropertyOptional({ example: 'Detailed description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 100.5 })
  @IsNumber()
  @IsOptional()
  mrp?: number;

  @ApiPropertyOptional({ example: 12.0 })
  @IsNumber()
  @IsOptional()
  gstPercent?: number;

  @ApiPropertyOptional({ example: 'uuid-category-id' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'uuid-subcategory-id' })
  @IsUUID()
  @IsOptional()
  subCategoryId?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
