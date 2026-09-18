import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class QueryActivityDto {
  @ApiPropertyOptional({ description: 'Only entries by this admin' })
  @IsOptional()
  @IsUUID()
  adminUserId?: string;

  @ApiPropertyOptional({
    description: 'Sidebar section, e.g. orders, products, users',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  section?: string;

  @ApiPropertyOptional({ description: 'POST, PATCH, PUT or DELETE' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  method?: string;

  @ApiPropertyOptional({ description: 'Only succeeded (true) or failed (false)' })
  @IsOptional()
  // Query strings carry "true"/"false" as text; without this the filter is
  // always truthy and "show me failures" silently returns successes.
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  success?: boolean;

  @ApiPropertyOptional({ description: 'Inclusive start date (YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive end date (YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Matches description, admin name, path, target label or id',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
