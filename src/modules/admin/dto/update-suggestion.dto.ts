import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean, IsUUID, IsArray } from 'class-validator';

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


  @ApiPropertyOptional({ example: 'Detailed description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 100.5 })
  @IsNumber()
  @IsOptional()
  mrp?: number;

  @ApiPropertyOptional({ example: 90.0 })
  @IsNumber()
  @IsOptional()
  price?: number;

  @ApiPropertyOptional({ example: 'Box' })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ example: '10x10' })
  @IsString()
  @IsOptional()
  packSize?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsNumber()
  @IsOptional()
  minimumOrderQuantity?: number;

  @ApiPropertyOptional({ example: ['https://example.com/image1.jpg'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({ example: 12.0 })
  @IsNumber()
  @IsOptional()
  gstPercent?: number;

  @ApiPropertyOptional({ example: 'uuid-category-id' })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'uuid-subcategory-id' })
  @IsString()
  @IsOptional()
  subCategoryId?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: [{ name: 'Size', values: ['Medium', 'Large'] }] })
  @IsOptional()
  options?: any[];

  @ApiPropertyOptional({ example: [{ name: 'Medium / Red', price: 100, available: 50 }] })
  @IsOptional()
  variants?: any[];
}
