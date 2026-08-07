import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Medicines' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    example: 'https://cdn.example.com/image.jpg',
    required: false,
  })
  @IsString()
  @IsOptional()
  image?: string;

  @ApiProperty({
    example: 'https://cdn.example.com/image-mobile.jpg',
    required: false,
    description:
      'Banner shown on phones. Omit to reuse `image` on every screen size.',
  })
  @IsString()
  @IsOptional()
  mobileImage?: string;
}
