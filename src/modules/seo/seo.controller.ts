import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { SeoEntityType } from '@prisma/client';
import { SeoService } from './seo.service';
import { SeoRedirectsService } from './seo-redirects.service';
import { SeoKeywordsService } from './seo-keywords.service';

/** Validated manually (not ParseEnumPipe) to return a friendly 400 message. */
function parseEntityType(value: string): SeoEntityType {
  if (!Object.values(SeoEntityType).includes(value as SeoEntityType)) {
    throw new BadRequestException(
      `type must be one of: ${Object.values(SeoEntityType).join(', ')}`,
    );
  }
  return value as SeoEntityType;
}

@Controller('seo')
export class SeoController {
  constructor(
    private readonly seoService: SeoService,
    private readonly redirectsService: SeoRedirectsService,
    private readonly keywordsService: SeoKeywordsService,
  ) {}

  /** Buyer generateMetadata merges this over derived defaults; null = no override. */
  @Get('meta')
  @HttpCode(HttpStatus.OK)
  async getMeta(@Query('type') type: string, @Query('id') id: string) {
    if (!type || !id) throw new BadRequestException('type and id are required');
    const data = await this.seoService.getMeta(parseEntityType(type), id);
    return { message: 'SEO meta retrieved successfully', data };
  }

  /** Consumed by buyer middleware with next:{revalidate:300} — keep it cacheable. */
  @Get('redirects/map')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  async getRedirectMap() {
    const data = await this.redirectsService.getMap();
    return { message: 'Redirect map retrieved successfully', data };
  }

  @Get('keywords/for')
  @HttpCode(HttpStatus.OK)
  async keywordsForEntity(@Query('type') type: string, @Query('id') id: string) {
    if (!type || !id) throw new BadRequestException('type and id are required');
    const data = await this.keywordsService.forEntity(parseEntityType(type), id);
    return { message: 'Keywords retrieved successfully', data };
  }
}
