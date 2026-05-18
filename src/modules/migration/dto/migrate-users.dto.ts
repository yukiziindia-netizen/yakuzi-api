import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Legacy User Shape ────────────────────────────────

export class LegacyKycDataDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  panNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  drugLicenseNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  drugLicenseUrl?: string;
}

export class LegacyAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pincode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  longitude?: number;
}

export class LegacyUserDto {
  @ApiProperty({ description: 'Legacy system user ID (MongoDB ObjectId or similar)' })
  @IsNotEmpty()
  @IsString()
  legacyId: string;

  @ApiProperty({ description: '10-digit Indian phone number' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Phone must be a 10-digit number' })
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ enum: ['BUYER', 'SELLER'] })
  @IsEnum(['BUYER', 'SELLER'] as const)
  role: 'BUYER' | 'SELLER';

  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'BLOCKED'] })
  @IsOptional()
  @IsEnum(['PENDING', 'APPROVED', 'REJECTED', 'BLOCKED'] as const)
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'BLOCKED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ type: LegacyKycDataDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LegacyKycDataDto)
  kyc?: LegacyKycDataDto;

  @ApiPropertyOptional({ type: LegacyAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LegacyAddressDto)
  address?: LegacyAddressDto;
}

// ─── Request DTO ──────────────────────────────────────

export class MigrateUsersDto {
  @ApiProperty({ type: [LegacyUserDto], description: 'Array of legacy users to import' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LegacyUserDto)
  users: LegacyUserDto[];
}
