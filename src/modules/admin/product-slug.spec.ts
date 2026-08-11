import { BadRequestException, ConflictException } from '@nestjs/common';
import { applySlugChange, assertValidSlug, normalizeSlug, SlugPrisma } from './product-slug';

describe('normalizeSlug', () => {
  it.each([
    ['Testing', 'testing'],
    ['  Dragon Ball!! Goku  ', 'dragon-ball-goku'],
    ['UPPER_case--thing', 'upper-case-thing'],
    ['éàü-figurine', 'figurine'],
    ['---x---', 'x'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
  });
});

describe('assertValidSlug', () => {
  it('accepts a normal slug', () => {
    expect(() => assertValidSlug('dragon-ball-goku-2')).not.toThrow();
  });
  it.each([
    ['', 'empty'],
    ['products', 'reserved'],
    ['add', 'reserved'],
    ['Bad Slug', 'chars'],
    ['a'.repeat(201), 'length'],
    ['123e4567-e89b-12d3-a456-426614174000', 'uuid-shaped'],
  ])('rejects %s (%s)', (slug) => {
    expect(() => assertValidSlug(slug as string)).toThrow(BadRequestException);
  });
});

function makePrisma(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    catalogProduct: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    seoRedirect: {
      deleteMany: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    ...overrides,
  };
  return prisma as unknown as SlugPrisma & {
    catalogProduct: { findFirst: jest.Mock; update: jest.Mock };
    seoRedirect: { deleteMany: jest.Mock; updateMany: jest.Mock; upsert: jest.Mock };
  };
}

describe('applySlugChange', () => {
  const product = { id: 'prod-1', slug: 'dragon-ball-goku' };

  it('no-ops when the normalized slug is unchanged', async () => {
    const prisma = makePrisma();
    const result = await applySlugChange(prisma, product, '  Dragon Ball Goku ');
    expect(result).toBe('dragon-ball-goku');
    expect(prisma.catalogProduct.update).not.toHaveBeenCalled();
    expect(prisma.seoRedirect.upsert).not.toHaveBeenCalled();
  });

  it('rejects a slug owned by another product', async () => {
    const prisma = makePrisma();
    prisma.catalogProduct.findFirst.mockResolvedValue({ id: 'other' });
    await expect(applySlugChange(prisma, product, 'taken-slug')).rejects.toThrow(ConflictException);
  });

  it('full rename: clears shadowing rules, repoints chains, creates the 301, updates the slug', async () => {
    const prisma = makePrisma();
    const result = await applySlugChange(prisma, product, 'Testing');
    expect(result).toBe('testing');

    expect(prisma.seoRedirect.deleteMany).toHaveBeenCalledWith({
      where: { fromPath: '/products/testing' },
    });
    expect(prisma.seoRedirect.updateMany).toHaveBeenCalledWith({
      where: { toPath: '/products/dragon-ball-goku' },
      data: { toPath: '/products/testing' },
    });
    const upsert = prisma.seoRedirect.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ fromPath: '/products/dragon-ball-goku' });
    expect(upsert.create.toPath).toBe('/products/testing');
    expect(upsert.create.statusCode).toBe(301);
    expect(prisma.catalogProduct.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { slug: 'testing' },
    });
  });

  it('product without an existing slug gets one without creating a redirect', async () => {
    const prisma = makePrisma();
    const result = await applySlugChange(prisma, { id: 'prod-2', slug: null }, 'brand-new');
    expect(result).toBe('brand-new');
    expect(prisma.seoRedirect.upsert).not.toHaveBeenCalled();
    expect(prisma.seoRedirect.updateMany).not.toHaveBeenCalled();
    expect(prisma.catalogProduct.update).toHaveBeenCalledWith({
      where: { id: 'prod-2' },
      data: { slug: 'brand-new' },
    });
  });
});
