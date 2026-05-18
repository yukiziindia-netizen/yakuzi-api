import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsEmail,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSellerProfileDto {
  @ApiProperty({ example: 'PharmaDist India Pvt Ltd' })
  @IsString()
  @IsNotEmpty()
  companyName: string;


  @ApiPropertyOptional({ example: 'business@example.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '12345678901234' })
  @IsString()
  @IsOptional()
  fssaiNumber?: string;

  @ApiPropertyOptional({ example: { accountHolder: 'John Doe', accountNumber: '1234567890', bankName: 'HDFC', ifsc: 'HDFC0001234' } })
  @IsOptional()
  bankAccount?: any;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/cancel-check.jpg' })
  @IsString()
  @IsOptional()
  cancelCheck?: string;

  @ApiProperty({ example: '27AABCU9603R1ZM', description: '15-char GSTIN' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/, {
    message: 'gstNumber must be a valid 15-character GSTIN',
  })
  gstNumber: string;

  @ApiProperty({ example: 'ABCDE1234F', description: '10-char PAN' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{5}\d{4}[A-Z]{1}$/, {
    message: 'panNumber must be a valid 10-character PAN',
  })
  panNumber: string;

  @ApiProperty({ example: 'DL-MH-654321' })
  @IsString()
  @IsNotEmpty()
  drugLicenseNumber: string;

  @ApiProperty({ example: 'https://s3.amazonaws.com/drug-license.pdf' })
  @IsString()
  @IsNotEmpty()
  drugLicenseUrl: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  drugLicenseExpiry?: string;

  @ApiProperty({ example: 'DL-MH-654321' })
  @IsString()
  @IsNotEmpty()
  drugLicenseNumber2: string;

  @ApiProperty({ example: 'https://s3.amazonaws.com/drug-license2.pdf' })
  @IsString()
  @IsNotEmpty()
  drugLicenseUrl2: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
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
