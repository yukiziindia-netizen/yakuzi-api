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

// ─── Legacy Order Item ────────────────────────────────

export class LegacyOrderItemDto {
  @ApiPropertyOptional({ description: 'Legacy order item ID' })
  @IsOptional()
  @IsString()
  legacyId?: string;

  @ApiProperty({ description: 'Legacy product ID (maps to Product.externalId)' })
  @IsNotEmpty()
  @IsString()
  legacyProductId: string;

  @ApiProperty({ description: 'Legacy seller ID' })
  @IsNotEmpty()
  @IsString()
  legacySellerId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  totalPrice: number;
}

// ─── Legacy Order Address ─────────────────────────────

export class LegacyOrderAddressDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  address: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  city: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  state: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  pincode: string;
}

// ─── Legacy Order ─────────────────────────────────────

export class LegacyOrderDto {
  @ApiProperty({ description: 'Legacy system order ID' })
  @IsNotEmpty()
  @IsString()
  legacyId: string;

  @ApiProperty({ description: 'Legacy buyer user ID' })
  @IsNotEmpty()
  @IsString()
  legacyBuyerId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  totalAmount: number;

  @ApiPropertyOptional({ enum: ['PLACED', 'ACCEPTED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] })
  @IsOptional()
  @IsEnum(['PLACED', 'ACCEPTED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const)
  orderStatus?: string;

  @ApiPropertyOptional({ enum: ['PENDING', 'PARTIAL', 'SUCCESS', 'FAILED'] })
  @IsOptional()
  @IsEnum(['PENDING', 'PARTIAL', 'SUCCESS', 'FAILED'] as const)
  paymentStatus?: string;

  @ApiPropertyOptional({ description: 'ISO date string of original order creation' })
  @IsOptional()
  @IsString()
  createdAt?: string;

  @ApiPropertyOptional({ type: LegacyOrderAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LegacyOrderAddressDto)
  deliveryAddress?: LegacyOrderAddressDto;

  @ApiProperty({ type: [LegacyOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LegacyOrderItemDto)
  items: LegacyOrderItemDto[];
}

// ─── Request DTO ──────────────────────────────────────

export class MigrateOrdersDto {
  @ApiProperty({ type: [LegacyOrderDto], description: 'Array of legacy orders to import' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LegacyOrderDto)
  orders: LegacyOrderDto[];
}
