import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BlogStatus, BlogCategory, BlogAuthor, BlogPost } from '@prisma/client';
import { 
  CreateBlogPostDto, 
  UpdateBlogPostDto, 
  UpdateBlogStatusDto, 
  QueryBlogDto,
  CreateBlogAuthorDto,
  UpdateBlogAuthorDto,
  CreateBlogCategoryDto,
  UpdateBlogCategoryDto
} from './dto';

@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────
  // BLOG POSTS (ADMIN)
  // ──────────────────────────────────────────────

  async createPost(dto: CreateBlogPostDto, authorUserId?: string) {
    const { 
      title, slug, excerpt, content, featuredImage, images, 
      authorId, categoryId, tags, status, 
      metaTitle, metaDescription, metaKeywords, canonicalUrl, ogImage 
    } = dto;

    let finalAuthorId = authorId;

    // If authorId is not provided (though required in DTO, might be any/legacy call), 
    // try to find/create author from user
    if (!finalAuthorId && authorUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: authorUserId },
        include: { adminProfile: true }
      });

      if (user) {
        let author = await this.prisma.blogAuthor.findFirst({
          where: { name: user.adminProfile?.displayName || 'Admin' }
        });

        if (!author) {
          author = await this.prisma.blogAuthor.create({
            data: {
              name: user.adminProfile?.displayName || 'Admin',
              bio: 'PharmaBag Admin',
              avatar: ''
            }
          });
        }
        finalAuthorId = author.id;
      }
    }

    if (!finalAuthorId) {
      throw new BadRequestException('Author ID is required');
    }

    const finalSlug = slug || title.toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Check if slug already exists
    const existingPost = await this.prisma.blogPost.findUnique({
      where: { slug: finalSlug }
    });

    if (existingPost) {
      throw new BadRequestException('A blog post with this slug already exists');
    }

    let finalContent = content;
    if (typeof content === 'string' && content.trim().startsWith('{')) {
      try {
        finalContent = JSON.parse(content);
      } catch (e) {
        // Fallback to original content
      }
    }

    const createData: any = {
      title,
      slug: finalSlug,
      excerpt: excerpt || '',
      content: finalContent || {},
      featuredImage,
      images: images || [],
      author: { connect: { id: finalAuthorId } },
      tags: tags || [],
      status: status || BlogStatus.DRAFT,
      metaTitle,
      metaDescription,
      metaKeywords: metaKeywords || [],
      canonicalUrl,
      ogImage,
      publishedAt: status === BlogStatus.PUBLISHED ? new Date() : null,
    };

    if (categoryId) {
      createData.category = { connect: { id: categoryId } };
    }

    return this.prisma.blogPost.create({
      data: createData,
      include: {
        author: true,
        category: true
      }
    });
  }

  async adminGetAllPosts(query: QueryBlogDto) {
    const { categoryId, status, search, limit = 10, page = 1 } = query;
    const skip = (page - 1) * limit;

    const where = {
      ...(categoryId && { categoryId }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' as any } },
          { excerpt: { contains: search, mode: 'insensitive' as any } },
        ]
      })
    };

    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        include: {
          author: true,
          category: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.blogPost.count({ where })
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async adminGetPostById(id: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { id },
      include: {
        author: true,
        category: true
      }
    });

    if (!post) {
      throw new NotFoundException(`Blog post with ID ${id} not found`);
    }

    return post;
  }

  async updatePost(id: string, dto: UpdateBlogPostDto) {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Blog post not found');

    const { status } = dto;
    
    let publishedAt = existing.publishedAt;
    if (status === BlogStatus.PUBLISHED && existing.status !== BlogStatus.PUBLISHED) {
      publishedAt = new Date();
    } else if (status === BlogStatus.DRAFT) {
      publishedAt = null;
    }

    return this.prisma.blogPost.update({
      where: { id },
      data: {
        ...dto,
        publishedAt
      },
      include: {
        author: true,
        category: true
      }
    });
  }

  async updatePostStatus(id: string, dto: UpdateBlogStatusDto) {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Blog post not found');

    const { status } = dto;
    
    let publishedAt = existing.publishedAt;
    if (status === BlogStatus.PUBLISHED && existing.status !== BlogStatus.PUBLISHED) {
      publishedAt = new Date();
    } else if (status === BlogStatus.DRAFT) {
      publishedAt = null;
    }

    return this.prisma.blogPost.update({
      where: { id },
      data: {
        status,
        publishedAt
      }
    });
  }

  async deletePost(id: string) {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Blog post not found');
    
    return this.prisma.blogPost.delete({ where: { id } });
  }

  // ──────────────────────────────────────────────
  // BLOG POSTS (PUBLIC)
  // ──────────────────────────────────────────────

  async getPublishedPosts(query: QueryBlogDto) {
    const { categoryId, search, limit = 10, page = 1 } = query;
    const skip = (page - 1) * limit;

    const where = {
      status: BlogStatus.PUBLISHED,
      ...(categoryId && { categoryId }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' as any } },
          { excerpt: { contains: search, mode: 'insensitive' as any } },
        ]
      })
    };

    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        include: {
          author: true,
          category: true
        },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      this.prisma.blogPost.count({ where })
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getTrendingPosts(limit: number = 10) {
    return this.prisma.blogPost.findMany({
      where: { status: BlogStatus.PUBLISHED },
      include: {
        author: true,
        category: true
      },
      orderBy: { views: 'desc' },
      take: Number(limit),
    });
  }

  async getPostsByTag(tag: string, query: QueryBlogDto) {
    const { limit = 10, page = 1 } = query;
    const skip = (page - 1) * limit;

    const where = {
      status: BlogStatus.PUBLISHED,
      tags: { has: tag }
    };

    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        include: {
          author: true,
          category: true
        },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      this.prisma.blogPost.count({ where })
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getPostBySlug(slug: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { slug },
      include: {
        author: true,
        category: true
      }
    });

    if (!post || post.status !== BlogStatus.PUBLISHED) {
      throw new NotFoundException(`Blog post with slug ${slug} not found`);
    }

    // Return post (view increment usually handled separately to avoid locking or in background)
    return post;
  }

  async incrementViews(slug: string) {
    return this.prisma.blogPost.update({
      where: { slug },
      data: { views: { increment: 1 } }
    });
  }

  async getSitemapData() {
    return this.prisma.blogPost.findMany({
      where: { status: BlogStatus.PUBLISHED },
      select: {
        slug: true,
        publishedAt: true,
        updatedAt: true
      },
      orderBy: { publishedAt: 'desc' }
    });
  }

  // ──────────────────────────────────────────────
  // AUTHORS
  // ──────────────────────────────────────────────

  async createAuthor(dto: CreateBlogAuthorDto) {
    return this.prisma.blogAuthor.create({
      data: dto
    });
  }

  async getAllAuthors() {
    return this.prisma.blogAuthor.findMany({
      include: {
        _count: {
          select: { posts: true }
        }
      },
      orderBy: { name: 'asc' }
    });
  }

  async getAuthorById(id: string) {
    const author = await this.prisma.blogAuthor.findUnique({
      where: { id },
      include: {
        _count: {
          select: { posts: true }
        }
      }
    });

    if (!author) throw new NotFoundException('Author not found');
    return author;
  }

  async updateAuthor(id: string, dto: UpdateBlogAuthorDto) {
    const existing = await this.prisma.blogAuthor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Author not found');

    return this.prisma.blogAuthor.update({
      where: { id },
      data: dto
    });
  }

  async deleteAuthor(id: string) {
    const existing = await this.prisma.blogAuthor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Author not found');

    // Check if author has posts
    const postCount = await this.prisma.blogPost.count({ where: { authorId: id } });
    if (postCount > 0) {
      throw new BadRequestException('Cannot delete author with existing blog posts');
    }

    return this.prisma.blogAuthor.delete({ where: { id } });
  }

  // ──────────────────────────────────────────────
  // CATEGORIES
  // ──────────────────────────────────────────────

  async createCategory(dto: CreateBlogCategoryDto) {
    const { name, slug } = dto;
    const finalSlug = slug || name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
    
    return this.prisma.blogCategory.create({
      data: {
        name,
        slug: finalSlug
      }
    });
  }

  async getAllCategories() {
    return this.prisma.blogCategory.findMany({
      include: {
        _count: {
          select: { posts: { where: { status: BlogStatus.PUBLISHED } } }
        }
      },
      orderBy: { name: 'asc' }
    });
  }

  async updateCategory(id: string, dto: UpdateBlogCategoryDto) {
    const existing = await this.prisma.blogCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');

    return this.prisma.blogCategory.update({
      where: { id },
      data: dto
    });
  }

  async deleteCategory(id: string) {
    const existing = await this.prisma.blogCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');

    // Check if category has posts
    const postCount = await this.prisma.blogPost.count({ where: { categoryId: id } });
    if (postCount > 0) {
      throw new BadRequestException('Cannot delete category with existing blog posts');
    }

    return this.prisma.blogCategory.delete({ where: { id } });
  }

  // Legacy/Compatibility methods (if needed by blog.controller.ts)
  async findAllPosts(query: { categoryId?: string; status?: BlogStatus }) {
    return this.prisma.blogPost.findMany({
      where: query,
      include: { author: true, category: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOnePost(idOrSlug: string) {
    return this.prisma.blogPost.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }]
      },
      include: { author: true, category: true }
    });
  }

  async findAllCategories() {
    return this.getAllCategories();
  }

  async findAllAuthors() {
    return this.getAllAuthors();
  }

  async removePost(id: string) {
    return this.deletePost(id);
  }
}
