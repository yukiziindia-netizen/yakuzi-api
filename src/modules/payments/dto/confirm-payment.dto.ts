import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmPaymentDto {
  @ApiPropertyOptional({ example: 'Verified via bank statement', description: 'Optional admin remarks' })
  @IsString()
  @IsOptional()
  remarks?: string;
}
