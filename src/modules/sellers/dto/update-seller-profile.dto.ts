import {
  IsString,
  IsOptional,
  Matches,
  IsEmail,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSellerProfileDto {
  @ApiPropertyOptional({ example: 'PharmaCorp Distributors' })
  @IsOptional()
  @IsString()
  companyName?: string;

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

  @ApiPropertyOptional({ example: '27AABCU9603R1ZM' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/, {
    message: 'gstNumber must be a valid 15-character GSTIN',
  })
  gstNumber?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}\d{4}[A-Z]{1}$/, {
    message: 'panNumber must be a valid 10-character PAN',
  })
  panNumber?: string;

  @ApiPropertyOptional({ example: 'DL-MH-2024-005678' })
  @IsOptional()
  @IsString()
  drugLicenseNumber?: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/pharmabag-images/drug-license.pdf' })
  @IsOptional()
  @IsString()
  drugLicenseUrl?: string;

  @ApiPropertyOptional({ example: 'DL-MH-2024-005678' })
  @IsOptional()
  @IsString()
  drugLicenseNumber2?: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/pharmabag-images/drug-license2.pdf' })
  @IsOptional()
  @IsString()
  drugLicenseUrl2?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  drugLicenseExpiry?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  drugLicenseExpiry2?: string;

  @ApiPropertyOptional({ example: '456 Industrial Area' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Delhi' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Delhi' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '600001' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pincode must be a valid 6-digit code' })
  pincode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  gstPanResponse?: any;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  isVacation?: boolean;
}
