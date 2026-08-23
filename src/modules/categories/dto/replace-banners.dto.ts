import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BannerSlideDto {
  @ApiProperty({ example: 'https://cdn.example.com/banners/spring-sale.jpg' })
  @IsString()
  @IsNotEmpty()
  image: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/banners/spring-sale-mobile.jpg',
    description: 'Optional portrait image for phones. Omit to reuse the desktop image.',
  })
  @IsOptional()
  @IsString()
  mobileImage?: string;
}

export class ReplaceBannersDto {
  @ApiProperty({
    type: [BannerSlideDto],
    description:
      'Full ordered slideshow — replaces all existing banners for this category/sub-category. Empty array clears the slideshow.',
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BannerSlideDto)
  banners: BannerSlideDto[];
}
