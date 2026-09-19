import { PlatformStatsService } from './platform-stats.service';

/**
 * These numbers get published, and an assistant may repeat them to a customer.
 * What matters is that they are COUNTED — that nothing here can be configured
 * into saying something flattering and untrue — and that "live listing" means
 * the same thing here as it does on the storefront.
 */
describe('PlatformStatsService', () => {
  const buildPrisma = (over: Record<string, unknown> = {}) => ({
    sellerOffer: {
      count: jest.fn().mockResolvedValue(83),
      groupBy: jest.fn().mockResolvedValue([{ sellerId: 's1' }, { sellerId: 's2' }]),
      findFirst: jest
        .fn()
        .mockResolvedValue({ createdAt: new Date('2026-03-01T00:00:00Z') }),
    },
    user: { count: jest.fn().mockResolvedValue(5) },
    category: { count: jest.fn().mockResolvedValue(8) },
    subCategory: { count: jest.fn().mockResolvedValue(41) },
    ...over,
  });

  it('reports the counts it was given', async () => {
    const prisma = buildPrisma();
    const stats = await new PlatformStatsService(prisma as never).get();

    expect(stats.listings).toBe(83);
    expect(stats.sellers).toBe(5);
    expect(stats.activeSellers).toBe(2);
    expect(stats.categories).toBe(8);
    expect(stats.subCategories).toBe(41);
    expect(stats.listingSince).toBe('2026-03-01T00:00:00.000Z');
    expect(stats.countedAt).toEqual(expect.any(String));
  });

  it('counts only listings a buyer could actually see', async () => {
    const prisma = buildPrisma();
    await new PlatformStatsService(prisma as never).get();

    // The same three conditions the storefront applies. Counting drafts,
    // rejected or deleted listings would inflate the published figure.
    const where = prisma.sellerOffer.count.mock.calls[0][0].where;
    expect(where).toMatchObject({
      isActive: true,
      approvalStatus: 'APPROVED',
      deletedAt: null,
    });
  });

  it('counts sellers as approved people, not as profiles or listings', async () => {
    const prisma = buildPrisma();
    await new PlatformStatsService(prisma as never).get();

    const where = prisma.user.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ role: 'SELLER', status: 'APPROVED' });
    expect(where.sellerProfile).toEqual({ isNot: null });
  });

  it('treats "active" as having something live today, not merely registered', async () => {
    const prisma = buildPrisma({
      user: { count: jest.fn().mockResolvedValue(40) },
      sellerOffer: {
        count: jest.fn().mockResolvedValue(83),
        // Forty registered, one actually selling. The published figure must
        // not round that up.
        groupBy: jest.fn().mockResolvedValue([{ sellerId: 's1' }]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });

    const stats = await new PlatformStatsService(prisma as never).get();

    expect(stats.sellers).toBe(40);
    expect(stats.activeSellers).toBe(1);
  });

  it('reports zero rather than hiding an empty catalogue', async () => {
    const prisma = buildPrisma({
      sellerOffer: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      user: { count: jest.fn().mockResolvedValue(0) },
    });

    const stats = await new PlatformStatsService(prisma as never).get();

    expect(stats.listings).toBe(0);
    expect(stats.activeSellers).toBe(0);
    expect(stats.listingSince).toBeNull();
  });

  it('caches, so a crawler reading 70 pages is not 70 count queries', async () => {
    const prisma = buildPrisma();
    const service = new PlatformStatsService(prisma as never);

    await service.get();
    await service.get();
    await service.get();

    // Three listing counts per uncached read (total, new-in-30d) would show up
    // here immediately if the cache were not holding.
    expect(prisma.category.count).toHaveBeenCalledTimes(1);
  });
});
