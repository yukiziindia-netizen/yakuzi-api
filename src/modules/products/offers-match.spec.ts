import { offersMatch } from './products.service';

/**
 * Storefront filters look at seller offers, and an offer reaches a product two
 * ways: catalogProductId directly, or variantId through a ProductVariant.
 * Matching only the variant path made the price slider, ships-from, discount
 * and new-arrivals filters return a fraction of the catalogue — on the live
 * data, 8 of 67 products.
 */
describe('offersMatch', () => {
  it('matches through the direct catalogProductId path as well as the variant path', () => {
    const where = { isActive: true };

    const result = offersMatch(where);

    expect(result).toEqual({
      OR: [
        { sellerOffers: { some: where } },
        { productVariants: { some: { sellerOffers: { some: where } } } },
      ],
    });
  });

  it('passes the condition through untouched to both branches', () => {
    const where = { mrp: { gte: 5000 }, isActive: true, deletedAt: null };

    const result = offersMatch(where) as any;

    expect(result.OR[0].sellerOffers.some).toBe(where);
    expect(result.OR[1].productVariants.some.sellerOffers.some).toBe(where);
  });

  it('keeps an AND bundle intact — price, location and discount combine', () => {
    const conditions = [
      { isActive: true, deletedAt: null },
      { mrp: { gte: 1000, lte: 5000 } },
      { seller: { city: 'Mumbai' } },
    ];

    const result = offersMatch({ AND: conditions }) as any;

    expect(result.OR[0].sellerOffers.some.AND).toEqual(conditions);
    expect(result.OR[1].productVariants.some.sellerOffers.some.AND).toEqual(conditions);
  });
});
