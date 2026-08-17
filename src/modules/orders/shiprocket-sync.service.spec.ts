import { OrderStatus } from '@prisma/client';
import { ShiprocketSyncService } from './shiprocket-sync.service';

const build = () => {
  const prisma = {
    order: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const shiprocketService = {
    trackOrder: jest.fn(),
  };
  const ordersService = {
    syncTrackingFields: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ShiprocketSyncService(
    prisma as never,
    shiprocketService as never,
    ordersService as never,
  );
  return { service, prisma, shiprocketService, ordersService };
};

describe('ShiprocketSyncService.syncInFlightOrders', () => {
  it('queries only orders with a shiprocketOrderId not yet in a terminal state', async () => {
    const { service, prisma } = build();
    prisma.order.findMany.mockResolvedValue([]);

    await service.syncInFlightOrders();

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        shiprocketOrderId: { not: null },
        status: {
          notIn: [OrderStatus.DELIVERED, OrderStatus.RETURNED, OrderStatus.CANCELLED],
        },
      },
      select: { id: true, shiprocketOrderId: true, status: true },
    });
  });

  it('continues processing remaining orders when one order fails', async () => {
    const { service, prisma, shiprocketService } = build();
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', shiprocketOrderId: 'sr-1', status: OrderStatus.SHIPPED },
      { id: 'order-2', shiprocketOrderId: 'sr-2', status: OrderStatus.SHIPPED },
    ]);
    shiprocketService.trackOrder
      .mockRejectedValueOnce(new Error('Shiprocket down'))
      .mockResolvedValueOnce({
        current_status: 'Delivered',
        awb_code: 'AWB2',
        courier: 'DTDC',
      });

    await service.syncInFlightOrders();

    expect(shiprocketService.trackOrder).toHaveBeenCalledTimes(2);
    expect(prisma.order.update).toHaveBeenCalledTimes(1);
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-2' },
      data: { status: OrderStatus.DELIVERED },
    });
  });
});

describe('ShiprocketSyncService.syncOneOrder', () => {
  it('advances status and syncs tracking fields on a forward status move', async () => {
    const { service, prisma, shiprocketService, ordersService } = build();
    shiprocketService.trackOrder.mockResolvedValue({
      current_status: 'Out For Delivery',
      awb_code: 'AWB123',
      courier: 'Delhivery',
    });

    await service.syncOneOrder({
      id: 'order-1',
      shiprocketOrderId: 'sr-1',
      status: OrderStatus.SHIPPED,
    });

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: OrderStatus.OUT_FOR_DELIVERY },
    });
    expect(ordersService.syncTrackingFields).toHaveBeenCalledWith('order-1', {
      awb_code: 'AWB123',
      courier: 'Delhivery',
    });
  });

  it('does not update status when the mapped status is not a forward move', async () => {
    const { service, prisma, shiprocketService, ordersService } = build();
    shiprocketService.trackOrder.mockResolvedValue({
      current_status: 'Shipped',
      awb_code: 'AWB123',
      courier: 'Delhivery',
    });

    await service.syncOneOrder({
      id: 'order-1',
      shiprocketOrderId: 'sr-1',
      status: OrderStatus.OUT_FOR_DELIVERY,
    });

    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(ordersService.syncTrackingFields).not.toHaveBeenCalled();
  });

  it('does not update status when Shiprocket returns an unrecognized status', async () => {
    const { service, prisma, shiprocketService } = build();
    shiprocketService.trackOrder.mockResolvedValue({
      current_status: 'Some Brand New Courier Status',
    });

    await service.syncOneOrder({
      id: 'order-1',
      shiprocketOrderId: 'sr-1',
      status: OrderStatus.SHIPPED,
    });

    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('skips an order with no shiprocketOrderId without calling Shiprocket', async () => {
    const { service, shiprocketService, prisma } = build();

    await service.syncOneOrder({
      id: 'order-1',
      shiprocketOrderId: null,
      status: OrderStatus.SHIPPED,
    });

    expect(shiprocketService.trackOrder).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});
