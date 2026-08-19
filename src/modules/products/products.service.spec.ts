import { ProductsService } from './products.service';
import type { CreateProductDto } from './dto/create-product.dto';

const dto = (): CreateProductDto =>
  ({
    name: 'Test Figurine',
    categoryId: 'cat-1',
    subCategoryId: 'subcat-1',
    manufacturer: 'Test Co',
    mrp: 100,
    gstPercent: 12,
    stock: 10,
    expiryDate: '2099-12-31',
  }) as CreateProductDto;

const build = () => {
  const offer = {
    id: 'offer-1',
    mrp: 100,
    gstPercent: 12,
    finalShippingPrice: null,
    shippingCharges: 0,
    discountType: null,
    discountMeta: null,
    isTaxIncluded: false,
  };
  const prisma = {
    sellerProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: 'seller-profile-1' }),
    },
    category: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cat-1', name: 'Figurines' }),
    },
    subCategory: {
      findUnique: jest.fn().mockResolvedValue({ id: 'subcat-1', name: 'Funko Pop' }),
    },
    sellerOffer: {
      findUnique: jest.fn().mockResolvedValue(offer),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(offer),
      update: jest.fn().mockResolvedValue(offer),
    },
    catalogProduct: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    productBatch: {
      findFirst: jest.fn().mockResolvedValue({ stock: 10, expiryDate: '2099-12-31' }),
    },
  };
  const inventoryService = {
    createDefaultBatch: jest.fn().mockResolvedValue(undefined),
    updateDefaultBatch: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ProductsService(
    prisma as never,
    inventoryService as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, inventoryService };
};

describe('ProductsService.create — createdByAdminId', () => {
  it('stores createdByAdmin (relation-connect) on the new SellerOffer when provided', async () => {
    const { service, prisma } = build();

    await service.create('seller-user-1', dto(), 'admin-user-1');

    const data = prisma.sellerOffer.create.mock.calls[0][0].data;
    expect(data.createdByAdmin).toEqual({ connect: { id: 'admin-user-1' } });
  });

  it('leaves createdByAdmin unset when the seller creates their own listing (no third argument)', async () => {
    const { service, prisma } = build();

    await service.create('seller-user-1', dto());

    const data = prisma.sellerOffer.create.mock.calls[0][0].data;
    expect(data.createdByAdmin).toBeUndefined();
  });

  it('resolves the seller from the given userId, not any ambient identity', async () => {
    const { service, prisma } = build();

    await service.create('seller-user-1', dto(), 'admin-user-1');

    expect(prisma.sellerProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'seller-user-1' },
    });
  });
});

describe('ProductsService — createdByAdminId is never exposed on read', () => {
  it('flattenProduct strips createdByAdminId from the response shape', () => {
    const service = new ProductsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const raw = {
      id: 'offer-1',
      name: 'Test',
      createdByAdminId: 'admin-user-1',
      batches: [],
      images: [],
      category: { name: 'Figurines' },
      subCategory: { name: 'Funko Pop' },
    };
    const flattened = (service as unknown as {
      flattenProduct(p: Record<string, any>): Record<string, any>;
    }).flattenProduct(raw);
    expect(flattened).not.toHaveProperty('createdByAdminId');
    expect(flattened).not.toHaveProperty('createdByAdmin');
  });
});

describe('ProductsService.validateIds', () => {
  const buildForValidateIds = (offers: any[]) => {
    const prisma = {
      sellerOffer: { findMany: jest.fn().mockResolvedValue(offers) },
    };
    const service = new ProductsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  };

  it('returns price/mrp/stock for a live, in-stock offer', async () => {
    const { service } = buildForValidateIds([
      {
        id: 'offer-1',
        mrp: 100,
        finalCustomerPayable: 90,
        batches: [{ stock: 3 }, { stock: 2 }],
      },
    ]);

    const result = await service.validateIds(['offer-1']);

    expect(result).toEqual([{ id: 'offer-1', price: 90, mrp: 100, stock: 5 }]);
  });

  it('falls back to mrp when finalCustomerPayable is null', async () => {
    const { service } = buildForValidateIds([
      { id: 'offer-1', mrp: 100, finalCustomerPayable: null, batches: [{ stock: 1 }] },
    ]);

    const result = await service.validateIds(['offer-1']);

    expect(result[0].price).toBe(100);
  });

  it('excludes an offer with zero total stock', async () => {
    const { service } = buildForValidateIds([
      { id: 'offer-1', mrp: 100, finalCustomerPayable: 90, batches: [] },
    ]);

    const result = await service.validateIds(['offer-1']);

    expect(result).toEqual([]);
  });

  it('queries only isActive, non-deleted offers among the given ids', async () => {
    const { service, prisma } = buildForValidateIds([]);

    await service.validateIds(['offer-1', 'offer-2']);

    expect(prisma.sellerOffer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['offer-1', 'offer-2'] }, isActive: true, deletedAt: null },
      }),
    );
  });

  it('returns an empty array for an empty id list without querying', async () => {
    const { service, prisma } = buildForValidateIds([]);

    const result = await service.validateIds([]);

    expect(result).toEqual([]);
    expect(prisma.sellerOffer.findMany).not.toHaveBeenCalled();
  });
});
