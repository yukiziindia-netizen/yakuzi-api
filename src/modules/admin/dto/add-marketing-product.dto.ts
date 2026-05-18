import { IsUUID, IsEnum, IsInt, IsOptional } from 'class-validator';
import { MarketingSlot } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class AddMarketingProductDto {
  @ApiProperty({ example: 'uuid-of-product' })
  @IsUUID()
  productId: string;

  @ApiProperty({ enum: ['HOMEPAGE_CAROUSEL', 'LOGIN_CAROUSEL'], example: 'HOMEPAGE_CAROUSEL' })
  @IsEnum(['HOMEPAGE_CAROUSEL', 'LOGIN_CAROUSEL'])
  slot: MarketingSlot;

  @ApiProperty({ example: 0, default: 0, required: false })
  @IsOptional()
  @IsInt()
  priority?: number = 0;
}
