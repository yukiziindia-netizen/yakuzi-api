import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HomepageSectionsService } from './homepage-sections.service';

const buildSection = (over: Partial<any> = {}) => ({
  id: 'section-1',
  categoryId: 'cat-1',
  subCategoryId: null,
  title: null,
  productLimit: 16,
  order: 0,
  isActive: true,
  category: { id: 'cat-1', name: 'Manga', slug: 'manga' },
  subCategory: null,
  ...over,
});

const SECTION_INCLUDE = { category: true, subCategory: { include: { category: true } } };

const build = () => {
  const prisma = {
    homepageSection: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
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
        data: { categoryId: 'cat-1', subCategoryId: null, title: undefined, productLimit: 16, order: 0 },
        include: SECTION_INCLUDE,
      });
    });

    it('passes through an explicit title, productLimit, and order', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.create.mockResolvedValue(buildSection());

      await service.create({ categoryId: 'cat-1', title: 'Trending in Manga', productLimit: 8, order: 2 });

      expect(prisma.homepageSection.create).toHaveBeenCalledWith({
        data: { categoryId: 'cat-1', subCategoryId: null, title: 'Trending in Manga', productLimit: 8, order: 2 },
        include: SECTION_INCLUDE,
      });
    });

    it('creates a section from a subCategoryId instead of a categoryId', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.create.mockResolvedValue(
        buildSection({ categoryId: null, subCategoryId: 'sub-1', category: null, subCategory: { id: 'sub-1', name: 'Chibi', slug: 'chibi', category: { id: 'cat-1', name: 'Manga', slug: 'manga' } } }),
      );

      await service.create({ subCategoryId: 'sub-1' });

      expect(prisma.homepageSection.create).toHaveBeenCalledWith({
        data: { categoryId: null, subCategoryId: 'sub-1', title: undefined, productLimit: 16, order: 0 },
        include: SECTION_INCLUDE,
      });
    });

    it('rejects when neither categoryId nor subCategoryId is provided', async () => {
      const { service, prisma } = build();

      await expect(service.create({})).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.homepageSection.create).not.toHaveBeenCalled();
    });

    it('rejects when both categoryId and subCategoryId are provided', async () => {
      const { service, prisma } = build();

      await expect(service.create({ categoryId: 'cat-1', subCategoryId: 'sub-1' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.homepageSection.create).not.toHaveBeenCalled();
    });
  });

  describe('findAllAdmin', () => {
    it('returns every section (including inactive) ordered by order ascending', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.findMany.mockResolvedValue([buildSection()]);

      await service.findAllAdmin();

      expect(prisma.homepageSection.findMany).toHaveBeenCalledWith({
        orderBy: { order: 'asc' },
        include: SECTION_INCLUDE,
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
        include: SECTION_INCLUDE,
      });
    });

    it('rejects when both categoryId and subCategoryId are provided in the same update', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.findUnique.mockResolvedValue(buildSection());

      await expect(service.update('section-1', { categoryId: 'cat-2', subCategoryId: 'sub-1' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.homepageSection.update).not.toHaveBeenCalled();
    });

    it('switching to a subCategoryId clears the existing categoryId in the same write', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.findUnique.mockResolvedValue(buildSection());
      prisma.homepageSection.update.mockResolvedValue(buildSection({ categoryId: null, subCategoryId: 'sub-1' }));

      await service.update('section-1', { subCategoryId: 'sub-1' });

      expect(prisma.homepageSection.update).toHaveBeenCalledWith({
        where: { id: 'section-1' },
        data: { subCategoryId: 'sub-1', categoryId: null },
        include: SECTION_INCLUDE,
      });
    });

    it('switching to a categoryId clears the existing subCategoryId in the same write', async () => {
      const { service, prisma } = build();
      prisma.homepageSection.findUnique.mockResolvedValue(buildSection({ categoryId: null, subCategoryId: 'sub-1' }));
      prisma.homepageSection.update.mockResolvedValue(buildSection());

      await service.update('section-1', { categoryId: 'cat-1' });

      expect(prisma.homepageSection.update).toHaveBeenCalledWith({
        where: { id: 'section-1' },
        data: { categoryId: 'cat-1', subCategoryId: null },
        include: SECTION_INCLUDE,
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

describe('HomepageSectionsService.reorder', () => {
  it('rejects when the given ids are not exactly the current set of section ids', async () => {
    const { service, prisma } = build();
    prisma.homepageSection.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    await expect(service.reorder(['a', 'b'])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicate id even if the array length matches', async () => {
    const { service, prisma } = build();
    prisma.homepageSection.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    await expect(service.reorder(['a', 'a', 'c'])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sets each section order to its index in the given array, in one transaction', async () => {
    const { service, prisma } = build();
    prisma.homepageSection.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    prisma.homepageSection.findMany.mockResolvedValueOnce([]);

    await service.reorder(['b', 'c', 'a']);

    expect(prisma.homepageSection.update).toHaveBeenNthCalledWith(1, { where: { id: 'b' }, data: { order: 0 } });
    expect(prisma.homepageSection.update).toHaveBeenNthCalledWith(2, { where: { id: 'c' }, data: { order: 1 } });
    expect(prisma.homepageSection.update).toHaveBeenNthCalledWith(3, { where: { id: 'a' }, data: { order: 2 } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns the freshly reordered list of sections', async () => {
    const { service, prisma } = build();
    prisma.homepageSection.findMany.mockResolvedValueOnce([{ id: 'a' }]);
    prisma.homepageSection.findMany.mockResolvedValueOnce([buildSection({ id: 'a', order: 0 })]);

    const result = await service.reorder(['a']);

    expect(result).toEqual([buildSection({ id: 'a', order: 0 })]);
  });
});

describe('HomepageSectionsService.findAllPublic', () => {
  it('only queries active sections, ordered ascending', async () => {
    const { service, prisma, productsService } = build();
    prisma.homepageSection.findMany.mockResolvedValue([]);
    productsService.findAll.mockResolvedValue({ products: [], meta: {} });

    await service.findAllPublic();

    expect(prisma.homepageSection.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      include: SECTION_INCLUDE,
    });
  });

  it('falls back the row title to the category name when no override is set', async () => {
    const { service, prisma, productsService } = build();
    prisma.homepageSection.findMany.mockResolvedValue([buildSection({ title: null })]);
    productsService.findAll.mockResolvedValue({ products: [{ id: 'p1' }], meta: {} });

    const result = await service.findAllPublic();

    expect(result[0].title).toBe('Manga');
  });

  it('uses the admin title override when one is set', async () => {
    const { service, prisma, productsService } = build();
    prisma.homepageSection.findMany.mockResolvedValue([buildSection({ title: 'Trending in Manga' })]);
    productsService.findAll.mockResolvedValue({ products: [{ id: 'p1' }], meta: {} });

    const result = await service.findAllPublic();

    expect(result[0].title).toBe('Trending in Manga');
  });

  it('queries products newest-first, capped at the section productLimit', async () => {
    const { service, prisma, productsService } = build();
    prisma.homepageSection.findMany.mockResolvedValue([buildSection({ productLimit: 8 })]);
    productsService.findAll.mockResolvedValue({ products: [{ id: 'p1' }], meta: {} });

    await service.findAllPublic();

    expect(productsService.findAll).toHaveBeenCalledWith({
      categoryId: 'cat-1',
      limit: 8,
      sortBy: 'newest',
      sortOrder: 'desc',
    });
  });

  it('omits a section whose category currently has zero matching products', async () => {
    const { service, prisma, productsService } = build();
    prisma.homepageSection.findMany.mockResolvedValue([buildSection()]);
    productsService.findAll.mockResolvedValue({ products: [], meta: {} });

    const result = await service.findAllPublic();

    expect(result).toEqual([]);
  });

  it('includes the section id, order, and category slug in the response shape', async () => {
    const { service, prisma, productsService } = build();
    prisma.homepageSection.findMany.mockResolvedValue([buildSection({ id: 'section-9', order: 4 })]);
    productsService.findAll.mockResolvedValue({ products: [{ id: 'p1' }], meta: {} });

    const result = await service.findAllPublic();

    expect(result[0]).toMatchObject({
      id: 'section-9',
      order: 4,
      category: { id: 'cat-1', name: 'Manga', slug: 'manga' },
      subCategory: null,
      products: [{ id: 'p1' }],
    });
  });

  it('queries by subCategoryId and falls back the title to the sub-collection name when sub-collection-sourced', async () => {
    const { service, prisma, productsService } = build();
    prisma.homepageSection.findMany.mockResolvedValue([
      buildSection({
        categoryId: null,
        subCategoryId: 'sub-1',
        title: null,
        category: null,
        subCategory: { id: 'sub-1', name: 'Chibi Figures', slug: 'chibi-figures', category: { id: 'cat-1', name: 'Figurines', slug: 'figurines' } },
      }),
    ]);
    productsService.findAll.mockResolvedValue({ products: [{ id: 'p1' }], meta: {} });

    const result = await service.findAllPublic();

    expect(productsService.findAll).toHaveBeenCalledWith({
      subCategoryId: 'sub-1',
      limit: 16,
      sortBy: 'newest',
      sortOrder: 'desc',
    });
    expect(result[0]).toMatchObject({
      title: 'Chibi Figures',
      category: null,
      subCategory: { id: 'sub-1', name: 'Chibi Figures', slug: 'chibi-figures', categorySlug: 'figurines' },
    });
  });

  it('uses the admin title override over the sub-collection name when both are set', async () => {
    const { service, prisma, productsService } = build();
    prisma.homepageSection.findMany.mockResolvedValue([
      buildSection({
        categoryId: null,
        subCategoryId: 'sub-1',
        title: 'Fan Favorites',
        category: null,
        subCategory: { id: 'sub-1', name: 'Chibi Figures', slug: 'chibi-figures', category: { id: 'cat-1', name: 'Figurines', slug: 'figurines' } },
      }),
    ]);
    productsService.findAll.mockResolvedValue({ products: [{ id: 'p1' }], meta: {} });

    const result = await service.findAllPublic();

    expect(result[0].title).toBe('Fan Favorites');
  });
});
