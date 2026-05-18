import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsArray,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBuyerProfileDto {
  @ApiPropertyOptional({ example: 'MedPlus Pharmacy Pvt Ltd' })
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional({ example: '27AABCU9603R1ZM' })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => !!o.gstNumber)
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/, {
    message: 'gstNumber must be a valid 15-character GSTIN',
  })
  gstNumber?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F' })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => !!o.panNumber)
  @Matches(/^[A-Z]{5}\d{4}[A-Z]{1}$/, {
    message: 'panNumber must be a valid 10-character PAN',
  })
  panNumber?: string;

  @ApiPropertyOptional({ example: 'DL-MH-2024-001234' })
  @IsOptional()
  @IsString()
  drugLicenseNumber?: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/drug-license.pdf' })
  @IsOptional()
  @IsString()
  drugLicenseUrl?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  drugLicenseExpiry?: string;

  @ApiPropertyOptional({ example: 'DL-MH-2024-001234' })
  @IsOptional()
  @IsString()
  drugLicenseNumber2?: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/drug-license2.pdf' })
  @IsOptional()
  @IsString()
  drugLicenseUrl2?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  drugLicenseExpiry2?: string;

  @ApiPropertyOptional({ description: 'Structured address object' })
  @IsOptional()
  @IsObject()
  address?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Drug licence details array' })
  @IsOptional()
  @IsArray()
  licence?: Record<string, any>[];

  @ApiPropertyOptional({ description: 'Bank account details' })
  @IsOptional()
  @IsObject()
  bankAccount?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cancelCheck?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  document?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inviteCode?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Maharashtra' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '400001' })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => !!o.pincode)
  @Matches(/^\d{6}$/, { message: 'pincode must be a valid 6-digit code' })
  pincode?: string;

  @ApiPropertyOptional({ example: 19.076 })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: 72.8777 })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ description: 'Pre-verified IDFY response' })
  @IsOptional()
  @IsObject()
  gstPanResponse?: Record<string, any>;
}
