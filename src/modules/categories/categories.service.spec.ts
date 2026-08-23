import { NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import type { ReplaceBannersDto } from './dto/replace-banners.dto';

const slides = (dto: Partial<ReplaceBannersDto> = {}): ReplaceBannersDto =>
  ({
    banners: [
      { image: 'https://cdn/a-desktop.jpg', mobileImage: 'https://cdn/a-mobile.jpg' },
      { image: 'https://cdn/b-desktop.jpg' },
    ],
    ...dto,
  }) as ReplaceBannersDto;

const build = ({
  category = { id: 'cat-1', name: 'Books' } as unknown,
  subCategory = { id: 'sub-1', name: 'Manga' } as unknown,
  rows = [] as unknown[],
} = {}) => {
  const prisma = {
    category: {
      findUnique: jest.fn().mockResolvedValue(category),
      update: jest.fn().mockResolvedValue({}),
    },
    subCategory: {
      findUnique: jest.fn().mockResolvedValue(subCategory),
    },
    categoryBannerImage: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue(rows),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const service = new CategoriesService(prisma as never);
  return { service, prisma };
};

describe('CategoriesService.replaceCategoryBanners', () => {
  it('throws 404 when the category does not exist', async () => {
    const { service } = build({ category: null });
    await expect(
      service.replaceCategoryBanners('missing', slides()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes existing rows and recreates them with order = array index', async () => {
    const { service, prisma } = build();
    await service.replaceCategoryBanners('cat-1', slides());

    expect(prisma.categoryBannerImage.deleteMany).toHaveBeenCalledWith({
      where: { categoryId: 'cat-1' },
    });
    const updateArg = prisma.category.update.mock.calls[0][0];
    expect(updateArg.data.bannerImages.create).toEqual([
      { image: 'https://cdn/a-desktop.jpg', mobileImage: 'https://cdn/a-mobile.jpg', order: 0 },
      { image: 'https://cdn/b-desktop.jpg', mobileImage: null, order: 1 },
    ]);
  });

  it('keeps the legacy single-image columns in sync with slide 1', async () => {
    const { service, prisma } = build();
    await service.replaceCategoryBanners('cat-1', slides());

    const updateArg = prisma.category.update.mock.calls[0][0];
    expect(updateArg.data.image).toBe('https://cdn/a-desktop.jpg');
    expect(updateArg.data.mobileImage).toBe('https://cdn/a-mobile.jpg');
  });

  it('an empty array clears the slideshow AND the legacy columns', async () => {
    const { service, prisma } = build();
    await service.replaceCategoryBanners('cat-1', slides({ banners: [] }));

    const updateArg = prisma.category.update.mock.calls[0][0];
    expect(updateArg.data.image).toBeNull();
    expect(updateArg.data.mobileImage).toBeNull();
    expect(updateArg.data.bannerImages.create).toEqual([]);
  });

  it('returns the freshly ordered rows', async () => {
    const expected = [{ id: 'r1', image: 'x', mobileImage: null, order: 0 }];
    const { service, prisma } = build({ rows: expected });
    const result = await service.replaceCategoryBanners('cat-1', slides());

    expect(result).toBe(expected);
    expect(prisma.categoryBannerImage.findMany).toHaveBeenCalledWith({
      where: { categoryId: 'cat-1' },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
  });
});

describe('CategoriesService.replaceSubCategoryBanners', () => {
  it('throws 404 when the sub-category does not exist', async () => {
    const { service } = build({ subCategory: null });
    await expect(
      service.replaceSubCategoryBanners('missing', slides()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('replaces rows scoped to the sub-category with order = array index', async () => {
    const { service, prisma } = build();
    await service.replaceSubCategoryBanners('sub-1', slides());

    expect(prisma.categoryBannerImage.deleteMany).toHaveBeenCalledWith({
      where: { subCategoryId: 'sub-1' },
    });
    expect(prisma.categoryBannerImage.createMany).toHaveBeenCalledWith({
      data: [
        { subCategoryId: 'sub-1', image: 'https://cdn/a-desktop.jpg', mobileImage: 'https://cdn/a-mobile.jpg', order: 0 },
        { subCategoryId: 'sub-1', image: 'https://cdn/b-desktop.jpg', mobileImage: null, order: 1 },
      ],
    });
    // never touches the parent category's legacy columns
    expect(prisma.category.update).not.toHaveBeenCalled();
  });
});
