import { AdminService } from './admin.service';
import { OrderStatus, PaymentStatus } from '@prisma/client';

const baseOrder = {
  id: 'order-1',
  orderStatus: OrderStatus.PAYMENT_RECEIVED,
  paymentStatus: PaymentStatus.SUCCESS,
  shiprocketOrderId: null,
  address: {},
  buyer: { email: 'b@example.com', phone: '9000000000', buyerProfile: null },
  items: [],
};

const build = (pushResult: Record<string, unknown> = {}) => {
  const prisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue(baseOrder),
      update: jest.fn().mockResolvedValue(baseOrder),
    },
    sellerSettlement: { findUnique: jest.fn() },
  };
  const notificationsService = {};
  const ordersService = {
    pushOrderToShiprocketIfNeeded: jest.fn().mockResolvedValue(pushResult),
    notifyBuyerOfStatusChange: jest.fn().mockResolvedValue(undefined),
  };
  const sellersService = {};
  const service = new AdminService(
    prisma as never,
    notificationsService as never,
    ordersService as never,
    sellersService as never,
  );
  return { service, prisma, ordersService };
};

describe('AdminService.adminUpdateOrderStatus — Shiprocket wiring', () => {
  it('pushes to Shiprocket when the admin advances an order to READY_TO_SHIP', async () => {
    const { service, ordersService } = build({
      shiprocketOrderId: 'sr-1',
      shipmentId: 'sh-1',
    });
    await service.adminUpdateOrderStatus('order-1', {
      status: OrderStatus.READY_TO_SHIP,
    } as never);
    expect(ordersService.pushOrderToShiprocketIfNeeded).toHaveBeenCalledWith(
      baseOrder,
    );
  });

  it('merges the returned Shiprocket fields into the order update', async () => {
    const { service, prisma } = build({
      shiprocketOrderId: 'sr-1',
      shipmentId: 'sh-1',
      awbCode: 'AWB1',
      courierName: 'Delhivery',
    });
    await service.adminUpdateOrderStatus('order-1', {
      status: OrderStatus.READY_TO_SHIP,
    } as never);
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderStatus: OrderStatus.READY_TO_SHIP,
          shiprocketOrderId: 'sr-1',
          shipmentId: 'sh-1',
          awbCode: 'AWB1',
          courierName: 'Delhivery',
        }),
      }),
    );
  });

  it('does not touch Shiprocket for any other status transition', async () => {
    const { service, ordersService } = build();
    await service.adminUpdateOrderStatus('order-1', {
      status: OrderStatus.CANCELLED,
    } as never);
    expect(ordersService.pushOrderToShiprocketIfNeeded).not.toHaveBeenCalled();
  });

  it('notifies the buyer on every admin status change, not just READY_TO_SHIP', async () => {
    const { service, ordersService } = build();
    await service.adminUpdateOrderStatus('order-1', {
      status: OrderStatus.SHIPPED,
    } as never);
    expect(ordersService.notifyBuyerOfStatusChange).toHaveBeenCalledWith(
      { id: 'order-1', buyerId: undefined, buyer: baseOrder.buyer },
      OrderStatus.SHIPPED,
    );
  });
});

describe('AdminService.adminUpdateProduct — catalog product resolution', () => {
  const buildForProductUpdate = (offer: Record<string, unknown>) => {
    const prisma = {
      sellerOffer: { findUnique: jest.fn().mockResolvedValue(offer) },
      catalogProduct: { update: jest.fn().mockResolvedValue({ id: 'catalog-1' }) },
    };
    const notificationsService = {};
    const ordersService = {};
    const sellersService = {};
    const service = new AdminService(
      prisma as never,
      notificationsService as never,
      ordersService as never,
      sellersService as never,
    );
    return { service, prisma };
  };

  it('resolves a directly-linked catalog product (no variant)', async () => {
    const { service, prisma } = buildForProductUpdate({
      id: 'offer-1',
      catalogProduct: { id: 'catalog-1', slug: 'old-slug' },
      variant: null,
    });
    await service.adminUpdateProduct('offer-1', { name: 'New Name' } as never);
    expect(prisma.catalogProduct.update).toHaveBeenCalledWith({
      where: { id: 'catalog-1' },
      data: { name: 'New Name' },
    });
  });

  it('still resolves a variant-linked catalog product', async () => {
    const { service, prisma } = buildForProductUpdate({
      id: 'offer-2',
      catalogProduct: null,
      variant: { catalogProduct: { id: 'catalog-2', slug: 'old-slug-2' } },
    });
    await service.adminUpdateProduct('offer-2', { name: 'New Name 2' } as never);
    expect(prisma.catalogProduct.update).toHaveBeenCalledWith({
      where: { id: 'catalog-2' },
      data: { name: 'New Name 2' },
    });
  });

  it('throws when the listing has neither a direct nor a variant catalog product', async () => {
    const { service } = buildForProductUpdate({
      id: 'offer-3',
      catalogProduct: null,
      variant: null,
    });
    await expect(
      service.adminUpdateProduct('offer-3', { name: 'New Name 3' } as never),
    ).rejects.toThrow('This listing has no catalog product to edit');
  });
});
