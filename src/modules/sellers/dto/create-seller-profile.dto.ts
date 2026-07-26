import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsEmail,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSellerProfileDto {
  @ApiProperty({ example: 'PharmaDist India Pvt Ltd' })
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @ApiPropertyOptional({ example: 'business@example.com' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined))
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '12345678901234' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined))
  @IsString()
  fssaiNumber?: string;

  @ApiPropertyOptional({
    example: {
      accountHolder: 'John Doe',
      accountNumber: '1234567890',
      bankName: 'HDFC',
      ifsc: 'HDFC0001234',
    },
  })
  @IsOptional()
  bankAccount?: any;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/cancel-check.jpg' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined))
  @IsString()
  cancelCheck?: string;

  @ApiPropertyOptional({ example: '27AABCU9603R1ZM', description: '15-char GSTIN' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : undefined))
  @IsString()
  @Matches(/^(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1})?$/, {
    message: 'gstNumber must be a valid 15-character GSTIN',
  })
  gstNumber?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F', description: '10-char PAN' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : undefined))
  @IsString()
  @Matches(/^([A-Z]{5}\d{4}[A-Z]{1})?$/, {
    message: 'panNumber must be a valid 10-character PAN',
  })
  panNumber?: string;

  @ApiPropertyOptional({
    example: '123456789012',
    description: '12-digit Aadhaar Card number',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.replace(/\D/g, '') ? value.replace(/\D/g, '') : undefined))
  @IsString()
  @Matches(/^(\d{12})?$/, {
    message: 'aadhaarNumber must be a valid 12-digit number',
  })
  aadhaarNumber?: string;

  @ApiPropertyOptional({ example: 'DL-MH-654321' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined))
  @IsString()
  drugLicenseNumber?: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/drug-license.pdf' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined))
  @IsString()
  drugLicenseUrl?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined))
  @IsString()
  drugLicenseExpiry?: string;

  @ApiPropertyOptional({ example: 'DL-MH-654321' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined))
  @IsString()
  drugLicenseNumber2?: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/drug-license2.pdf' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined))
  @IsString()
  drugLicenseUrl2?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined))
  @IsString()
  drugLicenseExpiry2?: string;

  @ApiProperty({ example: '456, Industrial Area, Bhiwandi' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'Mumbai' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'Maharashtra' })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiProperty({ example: '421302', description: '6-digit pincode' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'pincode must be a valid 6-digit code' })
  pincode: string;
}
