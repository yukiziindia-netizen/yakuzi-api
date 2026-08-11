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
