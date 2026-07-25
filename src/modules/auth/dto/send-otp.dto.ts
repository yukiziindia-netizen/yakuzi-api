import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiPropertyOptional({
    example: '9831864222',
    description: '10-digit phone number or email address',
  })
  @IsOptional()
  @IsString()
  contact?: string;

  @ApiPropertyOptional({
    example: '9831864222',
    description: '10-digit Indian mobile number',
  })
  @IsOptional()
  @IsString()
  phone?: string;
}

