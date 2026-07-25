import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiPropertyOptional({
    example: '9831864222',
    description: '10-digit Indian mobile number',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: '9831864222',
    description: 'Alias for phone number or email',
  })
  @IsOptional()
  @IsString()
  contact?: string;


  @ApiProperty({ example: '123456', description: '6-digit OTP' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'OTP must contain only digits' })
  otp: string;

  @ApiProperty({
    example: 'SELLER',
    enum: ['BUYER', 'SELLER', 'ADMIN'],
    required: false,
  })
  @IsString()
  @IsOptional()
  role?: 'BUYER' | 'SELLER' | 'ADMIN';
}
