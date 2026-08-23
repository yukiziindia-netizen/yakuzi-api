import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { KeywordType, SeoEntityType } from '@prisma/client';

export class UpsertSeoMetaDto {
  @IsEnum(SeoEntityType)
  entityType!: SeoEntityType;

  /** Entity id, or the path for STATIC_PAGE / HOMEPAGE / LANDING_PAGE (e.g. "/about"). */
  @IsString()
  @IsNotEmpty()
  entityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @IsOptional()
  @IsString()
  canonicalUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(95)
  ogTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ogDescription?: string;

  @IsOptional()
  @IsString()
  ogImageUrl?: string;

  @IsOptional()
  @IsIn(['summary', 'summary_large_image'])
  twitterCard?: string;

  /** e.g. "noindex,follow" — rendered verbatim into the robots meta tag. */
  @IsOptional()
  @IsString()
  robots?: string;

  @IsOptional()
  @IsString()
  focusKeyword?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  secondaryKeywords?: string[];

  @IsOptional()
  @IsString()
  entityDescription?: string;

  @IsOptional()
  @IsString()
  aiSummary?: string;

  /** [{question, answer}] — rendered as visible FAQ + FAQPage JSON-LD. */
  @IsOptional()
  @IsArray()
  faq?: Array<{ question: string; answer: string }>;

  /** Merged over the generated JSON-LD by the frontend. */
  @IsOptional()
  structuredDataOverride?: Record<string, unknown>;

  @IsOptional()
  imageAltOverrides?: Record<string, string>;
}

export class ListSeoMetaQueryDto {
  @IsOptional()
  @IsEnum(SeoEntityType)
  type?: SeoEntityType;

  @IsOptional()
  @IsIn(['title', 'description', 'aiSummary'])
  missing?: 'title' | 'description' | 'aiSummary';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class CreateRedirectDto {
  @IsString()
  @IsNotEmpty()
  fromPath!: string;

  @IsString()
  @IsNotEmpty()
  toPath!: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([301, 302, 308, 410])
  statusCode?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateRedirectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fromPath?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  toPath?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([301, 302, 308, 410])
  statusCode?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateKeywordDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(KeywordType)
  type!: KeywordType;

  @IsOptional()
  @IsString()
  canonicalName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  synonyms?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  seasonStart?: string;

  @IsOptional()
  @IsString()
  seasonEnd?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateKeywordDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(KeywordType)
  type?: KeywordType;

  @IsOptional()
  @IsString()
  canonicalName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  synonyms?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  seasonStart?: string;

  @IsOptional()
  @IsString()
  seasonEnd?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class LinkKeywordDto {
  @IsEnum(SeoEntityType)
  entityType!: SeoEntityType;

  @IsString()
  @IsNotEmpty()
  entityId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  weight?: number;
}

export class UpdateProductSlugDto {
  @IsString()
  @IsNotEmpty()
  slug!: string;
}
