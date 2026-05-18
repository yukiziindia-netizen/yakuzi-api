import {
  IsString,
  IsNumber,
  IsOptional,
  IsInt,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsArray,
  IsUrl,
  IsObject,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';

export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'Paracetamol 500mg', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: 'uuid-of-category' })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'uuid-of-subcategory' })
  @IsString()
  @IsOptional()
  subCategoryId?: string;

  @ApiPropertyOptional({ example: 'Cipla Ltd', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'Paracetamol IP 500mg' })
  @IsString()
  @IsOptional()
  chemicalComposition?: string;

  @ApiPropertyOptional({ example: 'Analgesic and antipyretic tablet' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 25.50, description: 'MRP in INR' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  mrp?: number;

  @ApiPropertyOptional({ example: 12, description: 'GST percentage' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  gstPercent?: number;

  @ApiPropertyOptional({ example: 10, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  minimumOrderQuantity?: number;

  @ApiPropertyOptional({ example: 1000, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  maximumOrderQuantity?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 500, description: 'Updated stock count' })
  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'ISO date string' })
  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  // ── Image Support ──────────────────────────────
  @ApiPropertyOptional({
    example: ['https://example.com/img1.jpg'],
    description: 'Array of product image URLs (replaces existing images)',
  })
  @IsArray()
  @IsString({ each: true })
  @IsUrl({}, { each: true, message: 'Each image must be a valid URL' })
  @IsOptional()
  images?: string[];

  // ── Discount Engine ────────────────────────────
  @ApiPropertyOptional({
    enum: DiscountType,
    example: 'SAME_PRODUCT_BONUS',
    description: 'Type of discount applied to this product',
  })
  @IsEnum(DiscountType)
  @IsOptional()
  discountType?: DiscountType;

  @ApiPropertyOptional({
    example: { buy: 10, get: 2 },
    description: 'JSON metadata for the discount',
  })
  @IsObject()
  @IsOptional()
  discountMeta?: Record<string, any>;
}
