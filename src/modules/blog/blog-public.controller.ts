import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Res,
  Header,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { BlogService } from './blog.service';
import { QueryBlogDto } from './dto';

@ApiTags('Blog (Public)')
@Controller('blogs')
export class BlogPublicController {
  constructor(private readonly blogService: BlogService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get published blogs with pagination & filters' })
  @ApiResponse({ status: 200, description: 'Published blogs returned' })
  async getPublishedPosts(@Query() query: QueryBlogDto) {
    const data = await this.blogService.getPublishedPosts(query);
    return { message: 'Blogs retrieved successfully', data };
  }

  @Get('trending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get trending blogs (by views)' })
  async getTrendingPosts(@Query('limit') limit?: number) {
    const data = await this.blogService.getTrendingPosts(limit || 10);
    return { message: 'Trending blogs retrieved successfully', data };
  }

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all blog categories' })
  async getCategories() {
    const data = await this.blogService.getAllCategories();
    return { message: 'Blog categories retrieved successfully', data };
  }

  @Get('tag/:tag')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get blogs by tag' })
  async getPostsByTag(
    @Param('tag') tag: string,
    @Query() query: QueryBlogDto,
  ) {
    const data = await this.blogService.getPostsByTag(tag, query);
    return { message: 'Blogs retrieved successfully', data };
  }

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single blog post by slug (SEO URL)' })
  @ApiResponse({ status: 200, description: 'Blog post with JSON-LD structured data' })
  async getPostBySlug(@Param('slug') slug: string) {
    const data = await this.blogService.getPostBySlug(slug);
    return { message: 'Blog post retrieved successfully', data };
  }

  @Post(':slug/view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Increment blog post view count' })
  async incrementViews(@Param('slug') slug: string) {
    const data = await this.blogService.incrementViews(slug);
    return { message: 'View recorded', data };
  }
}

@ApiTags('Sitemap')
@Controller()
export class SitemapController {
  constructor(private readonly blogService: BlogService) {}

  @Get('sitemap.xml')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'application/xml')
  @ApiOperation({ summary: 'Auto-generated XML sitemap for published blog posts' })
  async getSitemap(@Res() res: Response) {
    const posts = await this.blogService.getSitemapData();
    const baseUrl = 'https://pharmabag.com';

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Homepage
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}</loc>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';

    // Blog listing page
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/blog</loc>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>0.9</priority>\n';
    xml += '  </url>\n';

    // Individual blog posts
    for (const post of posts) {
      const lastmod = (post.updatedAt || post.publishedAt)?.toISOString().split('T')[0];
      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/blog/${post.slug}</loc>\n`;
      if (lastmod) {
        xml += `    <lastmod>${lastmod}</lastmod>\n`;
      }
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      xml += '  </url>\n';
    }

    xml += '</urlset>';

    res.send(xml);
  }
}
