import { CartService } from './cart.service';

const liveOffer = (overrides: Partial<any> = {}) => ({
  id: 'offer-live',
  name: 'Live Product',
  manufacturer: 'Acme',
  mrp: 100,
  finalCustomerPayable: 90,
  gstPercent: 12,
  minimumOrderQuantity: 1,
  maximumOrderQuantity: null,
  shippingCharges: 0,
  finalShippingPrice: null,
  isActive: true,
  deletedAt: null,
  batches: [{ stock: 5 }],
  variant: null,
  seller: { id: 'seller-1', companyName: 'Acme Co', city: 'Kolkata', state: 'WB', rating: 4.5 },
  ...overrides,
});

const buildCart = (items: any[]) => {
  const prisma = {
    cart: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cart-1', items }),
    },
    cartItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    catalogProduct: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const service = new CartService(prisma as never);
  return { service, prisma };
};

describe('CartService.getCart — stale-item pruning', () => {
  it('keeps a live, in-stock, active item', async () => {
    const { service } = buildCart([
      { id: 'item-1', quantity: 2, unitPrice: 90, createdAt: new Date(), updatedAt: new Date(), sellerOffer: liveOffer() },
    ]);

    const result = await service.getCart('buyer-1');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('item-1');
  });

  it('drops and deletes an item whose offer is deactivated', async () => {
    const { service, prisma } = buildCart([
      { id: 'item-1', quantity: 1, unitPrice: 90, createdAt: new Date(), updatedAt: new Date(), sellerOffer: liveOffer({ isActive: false }) },
    ]);

    const result = await service.getCart('buyer-1');

    expect(result.items).toHaveLength(0);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['item-1'] } } });
  });

  it('drops and deletes an item whose offer is soft-deleted', async () => {
    const { service, prisma } = buildCart([
      { id: 'item-1', quantity: 1, unitPrice: 90, createdAt: new Date(), updatedAt: new Date(), sellerOffer: liveOffer({ deletedAt: new Date() }) },
    ]);

    await service.getCart('buyer-1');

    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['item-1'] } } });
  });

  it('drops and deletes an item whose offer has zero total stock', async () => {
    const { service, prisma } = buildCart([
      { id: 'item-1', quantity: 1, unitPrice: 90, createdAt: new Date(), updatedAt: new Date(), sellerOffer: liveOffer({ batches: [] }) },
    ]);

    await service.getCart('buyer-1');

    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['item-1'] } } });
  });

  it('does not call deleteMany when every item is live', async () => {
    const { service, prisma } = buildCart([
      { id: 'item-1', quantity: 1, unitPrice: 90, createdAt: new Date(), updatedAt: new Date(), sellerOffer: liveOffer() },
    ]);

    await service.getCart('buyer-1');

    expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('prunes a mix, keeping only the live item, and batches all stale ids into one deleteMany call', async () => {
    const { service, prisma } = buildCart([
      { id: 'item-live', quantity: 1, unitPrice: 90, createdAt: new Date(), updatedAt: new Date(), sellerOffer: liveOffer() },
      { id: 'item-deleted', quantity: 1, unitPrice: 90, createdAt: new Date(), updatedAt: new Date(), sellerOffer: liveOffer({ id: 'offer-deleted', deletedAt: new Date() }) },
      { id: 'item-oos', quantity: 1, unitPrice: 90, createdAt: new Date(), updatedAt: new Date(), sellerOffer: liveOffer({ id: 'offer-oos', batches: [] }) },
    ]);

    const result = await service.getCart('buyer-1');

    expect(result.items.map((i: any) => i.id)).toEqual(['item-live']);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['item-deleted', 'item-oos'] } },
    });
  });

  it('returns an empty cart, no query for items, when every item was pruned', async () => {
    const { service } = buildCart([
      { id: 'item-1', quantity: 1, unitPrice: 90, createdAt: new Date(), updatedAt: new Date(), sellerOffer: liveOffer({ isActive: false }) },
    ]);

    const result = await service.getCart('buyer-1');

    expect(result).toEqual({ cartId: 'cart-1', items: [], totalAmount: 0 });
  });
});
