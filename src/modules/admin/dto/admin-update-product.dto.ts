import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min, IsBoolean } from 'class-validator';

/**
 * Admin edit of a catalog product. Every field optional — only sent fields
 * change. `slug` changes are handled specially: uniqueness-checked and a 301
 * redirect from the old URL is created automatically (see product-slug.ts).
 */
export class AdminUpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  /** Lowercased/normalized server-side; must be url-safe after normalization. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  /**
   * When the slug changes, also 301 the old URL to the new one. Defaults to
   * true; sending false skips only the redirect creation (shadow cleanup and
   * chain repointing still run).
   */
  @IsOptional()
  @IsBoolean()
  slugRedirect?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  manufacturer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  specifications?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  mrp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  gstPercent?: number;
}
