import { ProductsService } from './products.service';

const build = () => {
  const prisma = {
    catalogProduct: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new ProductsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
};

describe('ProductsService.findAll — buyer filter params', () => {
  it('filters on the curated isYukiziChoice flag when isYukiziChoice=true', async () => {
    const { service, prisma } = build();
    await service.findAll({ isYukiziChoice: true } as never);
    const where = prisma.catalogProduct.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([{ isYukiziChoice: true }]),
    );
  });

  it('does not add an isYukiziChoice condition when the filter is unset', async () => {
    const { service, prisma } = build();
    await service.findAll({} as never);
    const where = prisma.catalogProduct.findMany.mock.calls[0][0].where;
    expect(where.AND ?? []).not.toEqual(
      expect.arrayContaining([{ isYukiziChoice: true }]),
    );
  });

  it('filters Best Selling on the curated isBestSeller flag, not order history', async () => {
    const { service, prisma } = build();
    await service.findAll({ isBestSelling: true } as never);
    const where = prisma.catalogProduct.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([{ isBestSeller: true }]),
    );
    // The old "has ever had an order" condition lived under a nested seller-offer
    // AND — assert it's gone, not just that the new condition is present.
    const nestedSellerOfferFilter = (where.AND as any[]).find(
      (c) => c?.productVariants?.some?.sellerOffers?.some?.AND,
    );
    const sellerOfferConditions =
      nestedSellerOfferFilter?.productVariants.some.sellerOffers.some.AND ?? [];
    expect(sellerOfferConditions).not.toEqual(
      expect.arrayContaining([{ analytics: { orders: { gt: 0 } } }]),
    );
  });
});
