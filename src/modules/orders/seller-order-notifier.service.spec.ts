import { SellerOrderNotifierService } from './seller-order-notifier.service';

describe('SellerOrderNotifierService.notifySellersOfNewOrder', () => {
  const build = (
    sellers: {
      id: string;
      userId: string;
      email: string | null;
      companyName: string;
      user?: { email: string | null };
    }[],
  ) => {
    const prisma = {
      sellerProfile: {
        findMany: jest.fn().mockResolvedValue(sellers),
      },
    };
    const notificationsService = {
      notifySellerNewOrder: jest.fn().mockResolvedValue(undefined),
    };
    const mailService = {
      sendMail: jest.fn().mockResolvedValue({ sent: true, retryable: false }),
    };
    const service = new SellerOrderNotifierService(
      prisma as never,
      mailService as never,
      notificationsService as never,
    );
    return { service, prisma, notificationsService, mailService };
  };

  it('creates an in-app notification and emails each seller with an address', async () => {
    const { service, notificationsService, mailService } = build([
      { id: 'seller-1', userId: 'user-1', email: 's1@example.com', companyName: 'Acme' },
      { id: 'seller-2', userId: 'user-2', email: 's2@example.com', companyName: 'Beta' },
    ]);

    await service.notifySellersOfNewOrder([
      { orderId: 'order-1', sellerId: 'seller-1' },
      { orderId: 'order-2', sellerId: 'seller-2' },
    ]);

    expect(notificationsService.notifySellerNewOrder).toHaveBeenCalledWith('user-1', 'order-1');
    expect(notificationsService.notifySellerNewOrder).toHaveBeenCalledWith('user-2', 'order-2');
    expect(mailService.sendMail).toHaveBeenCalledTimes(2);
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 's1@example.com' }),
    );
  });

  it('falls back to the login email when SellerProfile.email is blank', async () => {
    const { service, mailService } = build([
      {
        id: 'seller-1',
        userId: 'user-1',
        email: null,
        companyName: 'Acme',
        user: { email: 'login@example.com' },
      },
    ]);

    await service.notifySellersOfNewOrder([{ orderId: 'order-1', sellerId: 'seller-1' }]);

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'login@example.com' }),
    );
  });

  it('skips the email but still creates the in-app notification when neither the business nor login email is on file', async () => {
    const { service, notificationsService, mailService } = build([
      { id: 'seller-1', userId: 'user-1', email: null, companyName: 'Acme', user: { email: null } },
    ]);

    await service.notifySellersOfNewOrder([{ orderId: 'order-1', sellerId: 'seller-1' }]);

    expect(notificationsService.notifySellerNewOrder).toHaveBeenCalledWith('user-1', 'order-1');
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('does not throw when the in-app notification write fails', async () => {
    const { service, notificationsService } = build([
      { id: 'seller-1', userId: 'user-1', email: 's1@example.com', companyName: 'Acme' },
    ]);
    notificationsService.notifySellerNewOrder.mockRejectedValue(new Error('db down'));

    await expect(
      service.notifySellersOfNewOrder([{ orderId: 'order-1', sellerId: 'seller-1' }]),
    ).resolves.toBeUndefined();
  });

  it('does not throw when the mailer reports failure', async () => {
    const { service, mailService } = build([
      { id: 'seller-1', userId: 'user-1', email: 's1@example.com', companyName: 'Acme' },
    ]);
    mailService.sendMail.mockResolvedValue({ sent: false, retryable: true });

    await expect(
      service.notifySellersOfNewOrder([{ orderId: 'order-1', sellerId: 'seller-1' }]),
    ).resolves.toBeUndefined();
  });

  it('does nothing for an empty list, without querying sellers', async () => {
    const { service, prisma } = build([]);

    await service.notifySellersOfNewOrder([]);

    expect(prisma.sellerProfile.findMany).not.toHaveBeenCalled();
  });
});

describe('SellerOrderNotifierService.notifySellersDocsReady', () => {
  const build = (
    sellers: {
      id: string;
      userId: string;
      email: string | null;
      companyName: string;
      user?: { email: string | null };
    }[],
  ) => {
    const prisma = {
      sellerProfile: {
        findMany: jest.fn().mockResolvedValue(sellers),
      },
    };
    const notificationsService = {
      notifySellerNewOrder: jest.fn().mockResolvedValue(undefined),
    };
    const mailService = {
      sendMail: jest.fn().mockResolvedValue({ sent: true, retryable: false }),
    };
    const service = new SellerOrderNotifierService(
      prisma as never,
      mailService as never,
      notificationsService as never,
    );
    return { service, prisma, notificationsService, mailService };
  };

  it('emails each seller with an address, without touching in-app notifications', async () => {
    const { service, notificationsService, mailService } = build([
      { id: 'seller-1', userId: 'user-1', email: 's1@example.com', companyName: 'Acme' },
      { id: 'seller-2', userId: 'user-2', email: 's2@example.com', companyName: 'Beta' },
    ]);

    await service.notifySellersDocsReady([
      { orderId: 'order-1', sellerId: 'seller-1' },
      { orderId: 'order-2', sellerId: 'seller-2' },
    ]);

    expect(mailService.sendMail).toHaveBeenCalledTimes(2);
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 's1@example.com', subject: expect.stringContaining('ORDER-1') }),
    );
    expect(notificationsService.notifySellerNewOrder).not.toHaveBeenCalled();
  });

  it('falls back to the login email when SellerProfile.email is blank', async () => {
    const { service, mailService } = build([
      {
        id: 'seller-1',
        userId: 'user-1',
        email: null,
        companyName: 'Acme',
        user: { email: 'login@example.com' },
      },
    ]);

    await service.notifySellersDocsReady([{ orderId: 'order-1', sellerId: 'seller-1' }]);

    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'login@example.com' }),
    );
  });

  it('skips the email when neither the business nor login email is on file', async () => {
    const { service, mailService } = build([
      { id: 'seller-1', userId: 'user-1', email: null, companyName: 'Acme', user: { email: null } },
    ]);

    await service.notifySellersDocsReady([{ orderId: 'order-1', sellerId: 'seller-1' }]);

    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('does not throw when the mailer reports failure', async () => {
    const { service, mailService } = build([
      { id: 'seller-1', userId: 'user-1', email: 's1@example.com', companyName: 'Acme' },
    ]);
    mailService.sendMail.mockResolvedValue({ sent: false, retryable: true });

    await expect(
      service.notifySellersDocsReady([{ orderId: 'order-1', sellerId: 'seller-1' }]),
    ).resolves.toBeUndefined();
  });

  it('does nothing for an empty list, without querying sellers', async () => {
    const { service, prisma } = build([]);

    await service.notifySellersDocsReady([]);

    expect(prisma.sellerProfile.findMany).not.toHaveBeenCalled();
  });
});
