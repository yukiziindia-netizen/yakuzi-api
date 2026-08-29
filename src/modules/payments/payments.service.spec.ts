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
      { sendMail: jest.fn().mockResolvedValue({ sent: true }) } as never,
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

describe('PaymentsService — admin email on buyer payment submission', () => {
  const originalAdmin = process.env.ADMIN_NOTIFICATION_EMAIL;
  const originalSmtp = process.env.SMTP_USER;
  afterEach(() => {
    if (originalAdmin === undefined) delete process.env.ADMIN_NOTIFICATION_EMAIL;
    else process.env.ADMIN_NOTIFICATION_EMAIL = originalAdmin;
    if (originalSmtp === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = originalSmtp;
  });

  const buildForProof = () => {
    const payment = {
      id: 'pay-1',
      orderId: 'aaaabbbb-2222',
      amount: { toNumber: () => 750 },
      method: 'BANK_TRANSFER',
      verificationStatus: 'PENDING',
      order: { buyerId: 'buyer-1' },
    };
    const prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(payment),
        update: jest.fn().mockResolvedValue(payment),
      },
    };
    const config = { get: jest.fn().mockReturnValue('0.05') };
    const mailService = { sendMail: jest.fn().mockResolvedValue({ sent: true, retryable: false }) };
    const service = new PaymentsService(
      prisma as never,
      config as never,
      {} as never,
      {} as never,
      {} as never,
      mailService as never,
    );
    return { service, mailService };
  };

  it('emails the admin when a buyer uploads payment proof', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@yukizi.com';
    const { service, mailService } = buildForProof();

    await service.uploadProof('buyer-1', 'pay-1', { proofUrl: 'https://x/proof.png' } as never);

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@yukizi.com',
        subject: expect.stringContaining('AAAABBBB'),
      }),
    );
  });

  it('proof upload still succeeds when no admin recipient is configured', async () => {
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    delete process.env.SMTP_USER;
    const { service, mailService } = buildForProof();

    await expect(
      service.uploadProof('buyer-1', 'pay-1', { proofUrl: 'https://x/proof.png' } as never),
    ).resolves.toBeDefined();
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });
});
