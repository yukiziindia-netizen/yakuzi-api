import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateCategoryDto } from './create-category.dto';
import { CreateSubCategoryDto } from './create-subcategory.dto';

export class BulkCreateCategoryDto {
  @ApiProperty({ type: [CreateCategoryDto], description: 'Array of categories to create' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCategoryDto)
  categories: CreateCategoryDto[];
}

export class BulkCreateSubCategoryDto {
  @ApiProperty({ type: [CreateSubCategoryDto], description: 'Array of subcategories to create' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSubCategoryDto)
  subcategories: CreateSubCategoryDto[];
}
