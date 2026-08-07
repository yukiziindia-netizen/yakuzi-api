import { BlogStatus } from '@prisma/client';
import { BlogService } from './blog.service';

describe('BlogService public status enforcement', () => {
  const prisma = {
    blogPost: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const service = new BlogService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  describe('findAllPosts', () => {
    it('forces PUBLISHED for anonymous readers even when DRAFT is requested', async () => {
      await service.findAllPosts({ status: BlogStatus.DRAFT }, false);
      const where = prisma.blogPost.findMany.mock.calls[0][0].where;
      expect(where.status).toBe(BlogStatus.PUBLISHED);
    });

    it('defaults anonymous readers to PUBLISHED when no status is given', async () => {
      await service.findAllPosts({}, false);
      const where = prisma.blogPost.findMany.mock.calls[0][0].where;
      expect(where.status).toBe(BlogStatus.PUBLISHED);
    });

    it('lets admins request any status, or all posts with none', async () => {
      await service.findAllPosts({ status: BlogStatus.DRAFT }, true);
      expect(prisma.blogPost.findMany.mock.calls[0][0].where.status).toBe(
        BlogStatus.DRAFT,
      );

      await service.findAllPosts({}, true);
      expect(
        prisma.blogPost.findMany.mock.calls[1][0].where.status,
      ).toBeUndefined();
    });

    it('keeps the category filter working alongside enforcement', async () => {
      await service.findAllPosts({ categoryId: 'cat-1' }, false);
      const where = prisma.blogPost.findMany.mock.calls[0][0].where;
      expect(where.categoryId).toBe('cat-1');
      expect(where.status).toBe(BlogStatus.PUBLISHED);
    });
  });

  describe('findOnePost', () => {
    it('only matches PUBLISHED posts for anonymous readers', async () => {
      await service.findOnePost('my-slug', false);
      const where = prisma.blogPost.findFirst.mock.calls[0][0].where;
      expect(where.status).toBe(BlogStatus.PUBLISHED);
    });

    it('lets admins fetch drafts', async () => {
      await service.findOnePost('my-slug', true);
      const where = prisma.blogPost.findFirst.mock.calls[0][0].where;
      expect(where.status).toBeUndefined();
    });
  });
});
