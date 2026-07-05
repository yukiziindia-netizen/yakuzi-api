import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsUUID,
  IsArray,
} from 'class-validator';

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
  salt?: string;

  @ApiPropertyOptional({ example: 'SKU12345' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiPropertyOptional({ example: 'SN-001' })
  @IsString()
  @IsOptional()
  serialNo?: string;

  @ApiPropertyOptional({ example: 'Material: Cotton' })
  @IsString()
  @IsOptional()
  specifications?: string;

  @ApiPropertyOptional({ example: 'Detailed description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 100.5 })
  @IsNumber()
  @IsOptional()
  mrp?: number | null;

  @ApiPropertyOptional({ example: 90.0 })
  @IsNumber()
  @IsOptional()
  price?: number | null;

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
  minimumOrderQuantity?: number | null;

  @ApiPropertyOptional({ example: ['https://example.com/image1.jpg'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({ example: 12.0 })
  @IsNumber()
  @IsOptional()
  gstPercent?: number | null;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isTaxIncluded?: boolean;

  @ApiPropertyOptional({ example: 50.0 })
  @IsNumber()
  @IsOptional()
  shippingCharges?: number | null;

  @ApiPropertyOptional({ example: 5.0 })
  @IsNumber()
  @IsOptional()
  commissionPercent?: number | null;

  @ApiPropertyOptional({ example: 20.0 })
  @IsNumber()
  @IsOptional()
  fixedFee?: number | null;

  @ApiPropertyOptional({ example: 18.0 })
  @IsNumber()
  @IsOptional()
  commissionGstPercent?: number | null;

  @ApiPropertyOptional({ example: 18.0 })
  @IsNumber()
  @IsOptional()
  fixedFeeGstPercent?: number | null;

  @ApiPropertyOptional({ example: 18.0 })
  @IsNumber()
  @IsOptional()
  shippingGstPercent?: number | null;

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

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isYukiziChoice?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isBestSeller?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isAd?: boolean;

  @ApiPropertyOptional({
    example: [{ name: 'Size', values: ['Medium', 'Large'] }],
  })
  @IsOptional()
  options?: any[];

  @ApiPropertyOptional({
    example: [{ name: 'Medium / Red', price: 100, available: 50 }],
  })
  @IsOptional()
  variants?: any[];
}
