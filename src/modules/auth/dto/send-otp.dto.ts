import { IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiPropertyOptional({ example: 'user@example.com or 9831864222', description: 'Alias for phone number' })
  @ValidateIf(o => !o.phone)
  @IsString()
  @IsNotEmpty()
  contact?: string;

  @ApiPropertyOptional({ example: '9831864222', description: '10-digit Indian mobile number' })
  @ValidateIf(o => !o.contact)
  @IsString()
  @IsNotEmpty()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Phone must be a valid 10-digit Indian mobile number',
  })
  phone?: string;
}
