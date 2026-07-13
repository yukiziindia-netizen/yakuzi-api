import { IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateShippingDetailsDto {
  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  packageLength?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  packageBreadth?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  packageHeight?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  packageWeight?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  lengthImage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  breadthImage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  heightImage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  weightImage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  invoiceUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  manifestUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  packedPictureUrl?: string;
}
