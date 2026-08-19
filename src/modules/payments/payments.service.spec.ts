import { PaymentsService } from './payments.service';
import { PaymentStatus } from '@prisma/client';

describe('PaymentsService.notifyDeferredSellers', () => {
  const build = () => {
    const prisma = {
      order: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const config = { get: jest.fn().mockReturnValue('0.05') };
    const sellerOrderNotifier = {
      notifySellersOfNewOrder: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PaymentsService(
      prisma as never,
      config as never,
      {} as never,
      {} as never,
      sellerOrderNotifier as never,
    );
    return { service, prisma, sellerOrderNotifier };
  };

  const call = (service: PaymentsService, orderIds: string[]) =>
    (
      service as unknown as {
        notifyDeferredSellers(orderIds: string[]): Promise<void>;
      }
    ).notifyDeferredSellers(orderIds);

  it('does nothing for an empty order list, without querying orders', async () => {
    const { service, prisma } = build();

    await call(service, []);

    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('notifies sellers for a paid, not-yet-notified order and stamps it', async () => {
    const { service, prisma, sellerOrderNotifier } = build();
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        items: [{ sellerId: 'seller-1' }],
      },
    ]);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await call(service, ['order-1']);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['order-1'] },
          sellersNotifiedAt: null,
          paymentStatus: PaymentStatus.SUCCESS,
        }),
      }),
    );
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', sellersNotifiedAt: null },
      data: { sellersNotifiedAt: expect.any(Date) },
    });
    expect(sellerOrderNotifier.notifySellersOfNewOrder).toHaveBeenCalledWith([
      { orderId: 'order-1', sellerId: 'seller-1' },
    ]);
  });

  it('does not notify when another caller already claimed the order (race between webhook and browser verify)', async () => {
    const { service, prisma, sellerOrderNotifier } = build();
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', items: [{ sellerId: 'seller-1' }] },
    ]);
    // Another concurrent confirmPayment() call already flipped this row.
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await call(service, ['order-1']);

    expect(sellerOrderNotifier.notifySellersOfNewOrder).not.toHaveBeenCalled();
  });

  it('never re-notifies a non-deferred order (already stamped at checkout)', async () => {
    const { service, prisma, sellerOrderNotifier } = build();
    // The findMany filter (sellersNotifiedAt: null) is what actually
    // enforces this — an already-stamped order just never comes back here.
    prisma.order.findMany.mockResolvedValue([]);

    await call(service, ['order-1']);

    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(sellerOrderNotifier.notifySellersOfNewOrder).not.toHaveBeenCalled();
  });

  it('builds one pair per distinct seller and notifies each order independently', async () => {
    const { service, prisma, sellerOrderNotifier } = build();
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1', items: [{ sellerId: 'seller-1' }] },
      { id: 'order-2', items: [{ sellerId: 'seller-2' }] },
    ]);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await call(service, ['order-1', 'order-2']);

    expect(sellerOrderNotifier.notifySellersOfNewOrder).toHaveBeenCalledTimes(2);
    expect(sellerOrderNotifier.notifySellersOfNewOrder).toHaveBeenCalledWith([
      { orderId: 'order-1', sellerId: 'seller-1' },
    ]);
    expect(sellerOrderNotifier.notifySellersOfNewOrder).toHaveBeenCalledWith([
      { orderId: 'order-2', sellerId: 'seller-2' },
    ]);
  });
});
