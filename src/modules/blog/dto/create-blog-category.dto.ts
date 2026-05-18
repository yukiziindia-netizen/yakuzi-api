import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBlogCategoryDto {
  @ApiProperty({ example: 'Health' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'health' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;
}
