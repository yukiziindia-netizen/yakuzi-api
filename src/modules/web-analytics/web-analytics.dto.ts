import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Ingestion payload. Deliberately lenient: analytics must never 400 real
 * traffic over a missing nicety — the service sanitizes and defaults.
 */

export class CollectVisitorDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  @IsOptional() @IsInt() screenW?: number;
  @IsOptional() @IsInt() screenH?: number;
  @IsOptional() @IsString() @MaxLength(16) language?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
}

export class CollectSessionDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  /** True only on the batch where the client created this session id. */
  @IsOptional() @IsBoolean() isNew?: boolean;
  @IsOptional() @IsBoolean() isNewVisitor?: boolean;
  @IsOptional() @IsString() @MaxLength(500) landingPage?: string;
  @IsOptional() @IsString() @MaxLength(2000) referrer?: string;
  @IsOptional() @IsObject() utm?: Record<string, string>;
  @IsOptional() @IsObject() clickIds?: Record<string, string>;
}

export class CollectEventDto {
  @IsString()
  @MaxLength(40)
  name!: string;

  @IsOptional() @IsInt() ts?: number; // epoch ms, client clock (bounded server-side)
  @IsOptional() @IsString() @MaxLength(500) page?: string;
  @IsOptional() @IsString() @MaxLength(64) productId?: string;
  @IsOptional() @IsObject() props?: Record<string, unknown>;
}

export class CollectBatchDto {
  @ValidateNested()
  @Type(() => CollectVisitorDto)
  visitor!: CollectVisitorDto;

  @ValidateNested()
  @Type(() => CollectSessionDto)
  session!: CollectSessionDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CollectEventDto)
  events!: CollectEventDto[];

  /** Claimed by the client; server-side auth events are the trusted record. */
  @IsOptional() @IsString() @MaxLength(64) userId?: string;

  // Enrichment added by the buyer app's /api/track proxy (Vercel geo headers).
  @IsOptional() @IsString() @MaxLength(8) country?: string;
  @IsOptional() @IsString() @MaxLength(64) region?: string;
  @IsOptional() @IsString() @MaxLength(128) city?: string;
  @IsOptional() @IsString() @MaxLength(1000) ua?: string;
}
