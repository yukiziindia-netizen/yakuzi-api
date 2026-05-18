import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QuerySubCategoryDto {
  @ApiPropertyOptional({ example: 'uuid-of-category', description: 'Filter by category ID' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;
}
