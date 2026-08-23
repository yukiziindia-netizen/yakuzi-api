import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { KeywordType, Role, SeoEntityType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SeoService } from './seo.service';
import { SeoRedirectsService } from './seo-redirects.service';
import { SeoKeywordsService } from './seo-keywords.service';
import {
  CreateKeywordDto,
  CreateRedirectDto,
  LinkKeywordDto,
  ListSeoMetaQueryDto,
  UpdateKeywordDto,
  UpdateProductSlugDto,
  UpdateRedirectDto,
  UpsertSeoMetaDto,
} from './seo.dto';

function parseEntityType(value: string): SeoEntityType {
  if (!Object.values(SeoEntityType).includes(value as SeoEntityType)) {
    throw new BadRequestException(
      `type must be one of: ${Object.values(SeoEntityType).join(', ')}`,
    );
  }
  return value as SeoEntityType;
}

@Controller('admin/seo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminSeoController {
  constructor(
    private readonly seoService: SeoService,
    private readonly redirectsService: SeoRedirectsService,
    private readonly keywordsService: SeoKeywordsService,
  ) {}

  // ── product URL slug ──────────────────────────────────────
  // Catalog-id keyed (the SEO tab's PRODUCT keyspace). Changes the REAL
  // public URL, with the same 301-redirect handling as the product form.

  @Get('product-slug/:id')
  @HttpCode(HttpStatus.OK)
  async getProductSlug(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.seoService.getProductSlug(id);
    return { message: 'Product slug retrieved successfully', data };
  }

  @Patch('product-slug/:id')
  @HttpCode(HttpStatus.OK)
  async updateProductSlug(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductSlugDto,
  ) {
    const data = await this.seoService.updateProductSlug(id, dto.slug);
    return { message: 'Product slug updated successfully', data };
  }

  // ── metadata ──────────────────────────────────────────────

  @Get('meta')
  @HttpCode(HttpStatus.OK)
  async listMeta(@Query() query: ListSeoMetaQueryDto) {
    const data = await this.seoService.listMeta(query);
    return { message: 'SEO meta list retrieved successfully', data };
  }

  @Get('meta/one')
  @HttpCode(HttpStatus.OK)
  async getMeta(@Query('type') type: string, @Query('id') id: string) {
    if (!type || !id) throw new BadRequestException('type and id are required');
    const data = await this.seoService.getMeta(parseEntityType(type), id);
    return { message: 'SEO meta retrieved successfully', data };
  }

  @Put('meta')
  @HttpCode(HttpStatus.OK)
  async upsertMeta(
    @Body() dto: UpsertSeoMetaDto,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.seoService.upsertMeta(dto, userId);
    return { message: 'SEO meta saved successfully', data };
  }

  @Get('meta/:id/revisions')
  @HttpCode(HttpStatus.OK)
  async revisions(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.seoService.getRevisions(id);
    return { message: 'Revisions retrieved successfully', data };
  }

  @Post('meta/:id/revisions/:revisionId/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.seoService.restoreRevision(id, revisionId, userId);
    return { message: 'Revision restored successfully', data };
  }

  // ── redirects ─────────────────────────────────────────────

  @Get('redirects')
  @HttpCode(HttpStatus.OK)
  async listRedirects(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.redirectsService.list({
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { message: 'Redirects retrieved successfully', data };
  }

  @Post('redirects')
  @HttpCode(HttpStatus.CREATED)
  async createRedirect(@Body() dto: CreateRedirectDto) {
    const data = await this.redirectsService.create(dto);
    return { message: 'Redirect created successfully', data };
  }

  @Patch('redirects/:id')
  @HttpCode(HttpStatus.OK)
  async updateRedirect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRedirectDto,
  ) {
    const data = await this.redirectsService.update(id, dto);
    return { message: 'Redirect updated successfully', data };
  }

  @Delete('redirects/:id')
  @HttpCode(HttpStatus.OK)
  async deleteRedirect(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.redirectsService.remove(id);
    return { message: 'Redirect deleted successfully', data };
  }

  // ── keywords ──────────────────────────────────────────────

  @Get('keywords')
  @HttpCode(HttpStatus.OK)
  async listKeywords(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const data = await this.keywordsService.list({
      type:
        type && Object.values(KeywordType).includes(type as KeywordType)
          ? (type as KeywordType)
          : undefined,
      search,
      includeInactive: includeInactive === 'true',
    });
    return { message: 'Keywords retrieved successfully', data };
  }

  @Post('keywords')
  @HttpCode(HttpStatus.CREATED)
  async createKeyword(@Body() dto: CreateKeywordDto) {
    const data = await this.keywordsService.create(dto);
    return { message: 'Keyword created successfully', data };
  }

  @Patch('keywords/:id')
  @HttpCode(HttpStatus.OK)
  async updateKeyword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKeywordDto,
  ) {
    const data = await this.keywordsService.update(id, dto);
    return { message: 'Keyword updated successfully', data };
  }

  @Delete('keywords/:id')
  @HttpCode(HttpStatus.OK)
  async deleteKeyword(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.keywordsService.remove(id);
    return { message: 'Keyword deleted successfully', data };
  }

  @Get('keywords/:id/links')
  @HttpCode(HttpStatus.OK)
  async keywordLinks(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.keywordsService.links(id);
    return { message: 'Keyword links retrieved successfully', data };
  }

  @Post('keywords/:id/links')
  @HttpCode(HttpStatus.CREATED)
  async linkKeyword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkKeywordDto,
  ) {
    const data = await this.keywordsService.link(id, dto);
    return { message: 'Keyword linked successfully', data };
  }

  @Delete('keywords/:id/links')
  @HttpCode(HttpStatus.OK)
  async unlinkKeyword(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('type') type: string,
    @Query('entityId') entityId: string,
  ) {
    if (!type || !entityId) {
      throw new BadRequestException('type and entityId are required');
    }
    const data = await this.keywordsService.unlink(
      id,
      parseEntityType(type),
      entityId,
    );
    return { message: 'Keyword unlinked successfully', data };
  }
}
