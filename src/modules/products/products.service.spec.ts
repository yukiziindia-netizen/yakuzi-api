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
