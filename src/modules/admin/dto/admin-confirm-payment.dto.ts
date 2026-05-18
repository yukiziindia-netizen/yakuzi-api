import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AdminConfirmPaymentDto {
  @ApiPropertyOptional({ example: 'Payment verified against bank statement', description: 'Optional remarks' })
  @IsOptional()
  @IsString()
  remarks?: string;
}
