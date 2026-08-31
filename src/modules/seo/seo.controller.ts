import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { SeoEntityType } from '@prisma/client';
import { SeoService } from './seo.service';
import { SeoRedirectsService } from './seo-redirects.service';
import { SeoKeywordsService } from './seo-keywords.service';
import { SeoNotFoundService } from './seo-not-found.service';
import { RecordNotFoundDto, RecordRedirectHitDto } from './seo.dto';

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
    private readonly notFoundService: SeoNotFoundService,
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
    const { exact, wildcards } = await this.redirectsService.getMap();
    // `data` stays the flat exact-match map it has always been, and wildcards
    // ride alongside it. A storefront deployed before this change reads `data`
    // and simply does not see the wildcard rules, so the two can ship in
    // either order without a window where redirects break.
    return { message: 'Redirect map retrieved successfully', data: exact, wildcards };
  }

  /**
   * The storefront reporting that a redirect fired.
   *
   * Public and unauthenticated because it is called from edge middleware,
   * which has no session. It can only ever increment a counter on a rule that
   * already exists — an unknown path is a no-op — so the worst a bad actor
   * achieves is inflating a number in an admin report. Always 204, even on
   * bad input: the visitor has already been redirected and nothing here
   * should ever produce a visible error.
   */
  @Post('redirects/hit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordRedirectHit(@Body() dto: RecordRedirectHitDto): Promise<void> {
    await this.redirectsService.recordHit(dto.path);
  }

  /**
   * The storefront reporting a 404, from its not-found boundary.
   *
   * Same reasoning as above: unauthenticated, always 204, and it can only add
   * a row to a list an admin reviews by hand. Rows are keyed by path with a
   * counter, so repeated bot probes collapse into one entry.
   */
  @Post('not-found')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordNotFound(@Body() dto: RecordNotFoundDto): Promise<void> {
    await this.notFoundService.record({
      path: dto.path,
      referrer: dto.referrer,
      userAgent: dto.userAgent,
    });
  }

  @Get('keywords/for')
  @HttpCode(HttpStatus.OK)
  async keywordsForEntity(@Query('type') type: string, @Query('id') id: string) {
    if (!type || !id) throw new BadRequestException('type and id are required');
    const data = await this.keywordsService.forEntity(parseEntityType(type), id);
    return { message: 'Keywords retrieved successfully', data };
  }
}
