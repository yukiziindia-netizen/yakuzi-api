import { IsString, IsOptional, MaxLength, IsBoolean } from 'class-validator';
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

  @ApiPropertyOptional({
    example: 'Authentic anime figurines from verified sellers across India.',
    description:
      'Intro copy shown on the buyer category page (also used as its meta description). Send an empty string to clear; omit to leave untouched.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  /**
   * Renaming a category regenerates its slug, changing the public
   * /category/<slug> URL. When that happens, 301 the old URL to the new one.
   * Default true; false skips only the redirect creation.
   */
  @IsOptional()
  @IsBoolean()
  slugRedirect?: boolean;
}
