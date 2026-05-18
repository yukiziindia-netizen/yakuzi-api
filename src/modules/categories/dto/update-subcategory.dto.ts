import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSubCategoryDto {
  @ApiPropertyOptional({ example: 'Tablets' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;
}
