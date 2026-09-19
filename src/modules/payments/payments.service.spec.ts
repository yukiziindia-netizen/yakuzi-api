import { PaymentsService } from './payments.service';
import { PaymentStatus } from '@prisma/client';

/**
 * confirmPayment now rings the buyer's bell as well. Not what these tests are
 * about — the once-only claim around it has its own spec.
 */
const notificationsStub = { notifyPaymentConfirmed: jest.fn() };

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
      // in-app notifications
      notificationsStub as never,
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

/**
 * confirmPayment legitimately runs up to three times for one payment — the
 * browser's /verify call, Razorpay's webhook, and an admin confirming by hand.
 * The buyer must still see one line in their bell, not three.
 */
describe('PaymentsService — the payment-confirmed bell entry', () => {
  const UNIQUE_VIOLATION = Object.assign(new Error('unique'), { code: 'P2002' });

  const build = () => {
    const prisma = { emailDispatch: { create: jest.fn().mockResolvedValue({}) } };
    const notifications = { notifyPaymentConfirmed: jest.fn().mockResolvedValue({}) };
    const service = new PaymentsService(
      prisma as never,
      { get: jest.fn().mockReturnValue('0.05') } as never,
      {} as never,
      {} as never,
      {} as never,
      notifications as never,
    );
    return { service, prisma, notifications };
  };

  const call = (service: PaymentsService) =>
    (
      service as unknown as {
        notifyBuyerPaymentConfirmed(
          paymentId: string,
          buyerId: string,
          orderId: string,
          amount: number,
        ): Promise<void>;
      }
    ).notifyBuyerPaymentConfirmed('pay-1', 'buyer-1', 'order-1', 2499);

  it('tells the buyer, with the amount and the order', async () => {
    const { service, notifications } = build();

    await call(service);

    expect(notifications.notifyPaymentConfirmed).toHaveBeenCalledWith(
      'buyer-1',
      'order-1',
      2499,
    );
  });

  it('claims the payment before writing anything', async () => {
    const { service, prisma } = build();

    await call(service);

    expect(prisma.emailDispatch.create).toHaveBeenCalledWith({
      data: {
        kind: 'inapp_payment_confirmed',
        dedupeKey: 'pay-1',
        userId: 'buyer-1',
      },
    });
  });

  it('stays silent when somebody already announced this payment', async () => {
    const { service, prisma, notifications } = build();
    prisma.emailDispatch.create.mockRejectedValue(UNIQUE_VIOLATION);

    await call(service);

    expect(notifications.notifyPaymentConfirmed).not.toHaveBeenCalled();
  });

  it('never throws — the payment is already confirmed by the time it runs', async () => {
    const { service, notifications } = build();
    notifications.notifyPaymentConfirmed.mockRejectedValue(new Error('db down'));

    await expect(call(service)).resolves.toBeUndefined();
  });
});
