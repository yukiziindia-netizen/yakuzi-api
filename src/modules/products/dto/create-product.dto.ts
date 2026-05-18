import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsInt,
  IsDateString,
  IsEnum,
  IsBoolean,
  IsArray,
  IsUrl,
  IsObject,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';

export class CreateProductDto {
  @ApiProperty({ example: 'Paracetamol 500mg', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'uuid-of-category' })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ example: 'uuid-of-subcategory' })
  @IsString()
  @IsNotEmpty()
  subCategoryId: string;

  @ApiProperty({ example: 'Cipla Ltd', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  manufacturer: string;

  @ApiProperty({ example: 'Paracetamol IP 500mg' })
  @IsString()
  @IsNotEmpty()
  chemicalComposition: string;

  @ApiPropertyOptional({ example: 'Analgesic and antipyretic tablet' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 25.50, description: 'MRP in INR' })
  @IsNumber()
  @Min(0)
  mrp: number;

  @ApiProperty({ example: 12, description: 'GST percentage' })
  @IsNumber()
  @Min(0)
  gstPercent: number;

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

  @ApiProperty({ example: 500, description: 'Initial stock count' })
  @IsInt()
  @Min(0)
  stock: number;

  @ApiProperty({ example: '2026-12-31', description: 'ISO date string' })
  @IsDateString()
  expiryDate: string;

  // ── Image Support ──────────────────────────────
  @ApiPropertyOptional({
    example: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
    description: 'Array of product image URLs',
  })
  @IsArray()
  @IsString({ each: true })
  @ValidateIf((o) => !o.isMigration)
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
    description: 'JSON metadata for the discount (structure depends on discountType)',
  })
  @IsObject()
  @IsOptional()
  discountMeta?: Record<string, any>;

  // ── Migration / Idempotency ────────────────────
  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'External ID from legacy system (MongoDB ObjectId) for idempotent migration',
  })
  @IsString()
  @IsOptional()
  externalId?: string;

  @ApiPropertyOptional({
    example: 'paracetamol-500mg-cipla',
    description: 'URL-friendly slug (auto-generated if not provided)',
  })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Set to true during data migration to relax non-critical validations',
  })
  @IsBoolean()
  @IsOptional()
  isMigration?: boolean;

  @ApiPropertyOptional({
    example: 'uuid-of-master-product',
    description: 'ID of the master product from catalog (if used, bypasses approval)',
  })
  @IsString()
  @IsOptional()
  masterProductId?: string;
}
