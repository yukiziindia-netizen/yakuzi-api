import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Medicines' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}
