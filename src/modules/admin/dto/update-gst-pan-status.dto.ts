import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreditTier } from '@prisma/client';

export class UpdateGstPanStatusDto {
  @ApiProperty({ example: true, description: 'true = VERIFIED, false = REJECTED' })
  @IsBoolean()
  verified: boolean;

  @ApiPropertyOptional({
    enum: CreditTier,
    example: 'PREPAID',
    description: 'Credit tier to assign when approving. Required when verified=true.',
  })
  @IsOptional()
  @IsEnum(CreditTier, {
    message: `creditTier must be one of: ${Object.values(CreditTier).join(', ')}`,
  })
  creditTier?: CreditTier;
}
