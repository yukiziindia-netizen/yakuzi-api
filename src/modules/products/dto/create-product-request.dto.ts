import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductRequestDto {
  @ApiProperty({ example: 'Paracetamol 500mg' })
  @IsString()
  @IsNotEmpty()
  productName: string;

  @ApiProperty({ example: 'Cipla', required: false })
  @IsString()
  @IsOptional()
  manufacturer?: string;

  @ApiProperty({ example: 'Used for fever and pain', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}
