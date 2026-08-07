import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Medicines' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/image.jpg' })
  @IsString()
  @IsOptional()
  image?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/image-mobile.jpg',
    description:
      'Banner shown on phones. Send an empty string to clear it and fall back to `image`; omit it to leave it untouched.',
  })
  @IsString()
  @IsOptional()
  mobileImage?: string;
}
