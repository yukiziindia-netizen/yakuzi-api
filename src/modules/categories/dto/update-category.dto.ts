import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Medicines' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;
}
