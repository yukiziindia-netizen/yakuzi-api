import { OrderStatus, PaymentStatus, Role } from '@prisma/client';
import { CheckoutAbandonmentSweepService } from './checkout-abandonment-sweep.service';

const build = (configuredTimeoutMinutes?: string) => {
  const prisma = {
    order: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const ordersService = {
    cancelOrder: jest.fn().mockResolvedValue(undefined),
  };
  const configService = {
    get: jest.fn().mockReturnValue(configuredTimeoutMinutes),
  };
  const service = new CheckoutAbandonmentSweepService(
    prisma as never,
    ordersService as never,
    configService as never,
  );
  return { service, prisma, ordersService, configService };
};

describe('CheckoutAbandonmentSweepService.cancelAbandonedCheckouts', () => {
  it('queries only unpaid, un-notified, PLACED orders older than the timeout', async () => {
    const { service, prisma } = build();

    const before = Date.now();
    await service.cancelAbandonedCheckouts();
    const after = Date.now();

    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
    const call = prisma.order.findMany.mock.calls[0][0];
    expect(call.where.sellersNotifiedAt).toBeNull();
    expect(call.where.orderStatus).toBe(OrderStatus.PLACED);
    expect(call.where.paymentStatus).toEqual({
      notIn: [PaymentStatus.SUCCESS, PaymentStatus.PARTIAL],
    });
    // Default timeout is 30 minutes - cutoff should land in that window
    // relative to when the call ran, regardless of exact test execution time.
    const cutoffMs = call.where.createdAt.lt.getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 30 * 60 * 1000 - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - 30 * 60 * 1000 + 1000);
  });

  it('cancels each stale order as ADMIN (bypassing the buyer-ownership check) so stock is restored', async () => {
    const { service, prisma, ordersService } = build();
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', buyerId: 'buyer-1' },
      { id: 'order-2', buyerId: 'buyer-2' },
    ]);

    await service.cancelAbandonedCheckouts();

    expect(ordersService.cancelOrder).toHaveBeenCalledWith('buyer-1', 'order-1', Role.ADMIN);
    expect(ordersService.cancelOrder).toHaveBeenCalledWith('buyer-2', 'order-2', Role.ADMIN);
  });

  it('continues cancelling remaining orders when one cancellation fails', async () => {
    const { service, prisma, ordersService } = build();
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', buyerId: 'buyer-1' },
      { id: 'order-2', buyerId: 'buyer-2' },
    ]);
    ordersService.cancelOrder
      .mockRejectedValueOnce(new Error('already paid'))
      .mockResolvedValueOnce(undefined);

    await expect(service.cancelAbandonedCheckouts()).resolves.toBeUndefined();

    expect(ordersService.cancelOrder).toHaveBeenCalledTimes(2);
  });

  it('honors a configured CHECKOUT_ABANDONMENT_TIMEOUT_MINUTES override', async () => {
    const { service, prisma, configService } = build('5');

    const before = Date.now();
    await service.cancelAbandonedCheckouts();

    expect(configService.get).toHaveBeenCalledWith('CHECKOUT_ABANDONMENT_TIMEOUT_MINUTES');
    const cutoffMs = prisma.order.findMany.mock.calls[0][0].where.createdAt.lt.getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 5 * 60 * 1000 - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(before - 5 * 60 * 1000 + 1000);
  });

  it('falls back to the 30-minute default when the configured value is invalid', async () => {
    const { service, prisma } = build('not-a-number');

    const before = Date.now();
    await service.cancelAbandonedCheckouts();

    const cutoffMs = prisma.order.findMany.mock.calls[0][0].where.createdAt.lt.getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 30 * 60 * 1000 - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(before - 30 * 60 * 1000 + 1000);
  });

  it('does nothing when there are no stale orders', async () => {
    const { service, ordersService } = build();

    await service.cancelAbandonedCheckouts();

    expect(ordersService.cancelOrder).not.toHaveBeenCalled();
  });
});
