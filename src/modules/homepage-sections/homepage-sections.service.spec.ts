import { NotFoundException } from '@nestjs/common';
import { HomepageSectionsService } from './homepage-sections.service';

const buildSection = (over: Partial<any> = {}) => ({
  id: 'section-1',
  categoryId: 'cat-1',
  title: null,
  productLimit: 16,
  order: 0,
  isActive: true,
  category: { id: 'cat-1', name: 'Manga', slug: 'manga' },
  ...over,
});

const build = () => {
  const prisma = {
    homepageSection: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const productsService = { findAll: jest.fn() };
  const service = new HomepageSectionsService(prisma as never, productsService as never);
  return { service, prisma, productsService };
};

describe('HomepageSectionsService — admin CRUD', () => {
  describe('create', () => {
    it('defaults productLimit to 16 and order to 0 when omitted', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.create.mockResolvedValue(buildSection());

      await service.create({ categoryId: 'cat-1' });

      expect(prisma.homepageSection.create).toHaveBeenCalledWith({
        data: { categoryId: 'cat-1', title: undefined, productLimit: 16, order: 0 },
        include: { category: true },
      });
    });

    it('passes through an explicit title, productLimit, and order', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.create.mockResolvedValue(buildSection());

      await service.create({ categoryId: 'cat-1', title: 'Trending in Manga', productLimit: 8, order: 2 });

      expect(prisma.homepageSection.create).toHaveBeenCalledWith({
        data: { categoryId: 'cat-1', title: 'Trending in Manga', productLimit: 8, order: 2 },
        include: { category: true },
      });
    });
  });

  describe('findAllAdmin', () => {
    it('returns every section (including inactive) ordered by order ascending', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.findMany.mockResolvedValue([buildSection()]);

      await service.findAllAdmin();

      expect(prisma.homepageSection.findMany).toHaveBeenCalledWith({
        orderBy: { order: 'asc' },
        include: { category: true },
      });
    });
  });

  describe('update', () => {
    it('throws NotFoundException for a missing section', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.homepageSection.update).not.toHaveBeenCalled();
    });

    it('only writes the fields that were actually provided', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.findUnique.mockResolvedValue(buildSection());
      prisma.homepageSection.update.mockResolvedValue(buildSection({ order: 3 }));

      await service.update('section-1', { order: 3 });

      expect(prisma.homepageSection.update).toHaveBeenCalledWith({
        where: { id: 'section-1' },
        data: { order: 3 },
        include: { category: true },
      });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException for a missing section', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.homepageSection.delete).not.toHaveBeenCalled();
    });

    it('deletes an existing section', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.findUnique.mockResolvedValue(buildSection());
      prisma.homepageSection.delete.mockResolvedValue(buildSection());

      await service.remove('section-1');

      expect(prisma.homepageSection.delete).toHaveBeenCalledWith({ where: { id: 'section-1' } });
    });
  });
});
