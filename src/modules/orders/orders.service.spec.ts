import { OrdersService } from './orders.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus } from '@prisma/client';

const dto = (over: Partial<CreateOrderDto> = {}): CreateOrderDto =>
  ({
    name: 'Arko',
    phone: '9008336683',
    address: 'sss',
    city: 'ss',
    state: 'West Bengal',
    pincode: '711303',
    email: 'buyer@example.com',
    ...over,
  }) as CreateOrderDto;

const build = (
  user: { phone?: string | null; email?: string | null },
  emailTakenBy: string | null = null,
) => {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        phone: user.phone ?? null,
        email: user.email ?? null,
        buyerProfile: null,
      }),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: never) =>
          Promise.resolve(
            (where as { email?: string }).email && emailTakenBy
              ? { id: emailTakenBy }
              : null,
          ),
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    buyerProfile: { update: jest.fn().mockResolvedValue({}) },
  };
  const service = new OrdersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
};

describe('OrdersService.syncBuyerContactDetails — email', () => {
  const call = (service: OrdersService, d: CreateOrderDto) =>
    (
      service as unknown as {
        syncBuyerContactDetails(u: string, d: CreateOrderDto): Promise<void>;
      }
    ).syncBuyerContactDetails('user-1', d);

  it('claims a blank email from checkout', async () => {
    const { service, prisma } = build({ email: null });
    await call(service, dto());
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        // expect.objectContaining returns `any`, which no-unsafe-assignment
        // flags here — safe, this is a Jest matcher, not real data.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ email: 'buyer@example.com' }),
      }),
    );
  });

  it('never overwrites an email the account already has', async () => {
    const { service, prisma } = build({ email: 'existing@example.com' });
    await call(service, dto());
    const updates = prisma.user.update.mock.calls.filter(
      (c: never[]) => 'email' in (c[0] as { data: object }).data,
    );
    expect(updates).toHaveLength(0);
  });

  it('does not claim an email another account already holds', async () => {
    const { service, prisma } = build({ email: null }, 'someone-else');
    await call(service, dto());
    const updates = prisma.user.update.mock.calls.filter(
      (c: never[]) => 'email' in (c[0] as { data: object }).data,
    );
    expect(updates).toHaveLength(0);
  });

  it('lowercases and trims the address before storing it', async () => {
    const { service, prisma } = build({ email: null });
    await call(service, dto({ email: '  Buyer@Example.COM ' }));
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ email: 'buyer@example.com' }),
      }),
    );
  });

  it('does nothing when no email was supplied', async () => {
    const { service, prisma } = build({ email: null });
    await call(service, dto({ email: undefined }));
    const updates = prisma.user.update.mock.calls.filter(
      (c: never[]) => 'email' in (c[0] as { data: object }).data,
    );
    expect(updates).toHaveLength(0);
  });
});

describe('OrdersService.pushOrderToShiprocketIfNeeded', () => {
  const baseOrder = (over: Record<string, unknown> = {}) => ({
    id: 'order-1',
    createdAt: new Date('2026-08-08T10:00:00Z'),
    totalAmount: 500,
    paymentStatus: 'SUCCESS',
    shiprocketOrderId: null,
    packageLength: null,
    packageBreadth: null,
    packageHeight: null,
    packageWeight: null,
    address: {
      name: 'Buyer Name',
      address: 'Street 1',
      city: 'Kolkata',
      pincode: '700001',
      state: 'West Bengal',
      phone: '9000000000',
    },
    buyer: { email: 'buyer@example.com', phone: '9000000000', buyerProfile: null },
    items: [
      {
        quantity: 2,
        unitPrice: 250,
        sellerOffer: { id: 'offer-12345678', name: 'Manga Vol 1' },
      },
    ],
    ...over,
  });

  const build = (createOrderImpl?: jest.Mock, getPickupImpl?: jest.Mock) => {
    const shiprocketService = {
      getPrimaryPickupLocation: getPickupImpl ?? jest.fn().mockResolvedValue('Home'),
      createOrder:
        createOrderImpl ??
        jest.fn().mockResolvedValue({
          order_id: 'sr-order-1',
          shipment_id: 'sr-shipment-1',
          awb_code: null,
          courier_name: null,
        }),
    };
    const service = new OrdersService(
      {} as never,
      shiprocketService as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, shiprocketService };
  };

  it('no-ops when the order was already pushed', async () => {
    const { service, shiprocketService } = build();
    const result = await service.pushOrderToShiprocketIfNeeded(
      baseOrder({ shiprocketOrderId: 'already-there' }) as never,
    );
    expect(result).toEqual({});
    expect(shiprocketService.createOrder).not.toHaveBeenCalled();
  });

  it('sends the seller-submitted package dimensions, not the 10x10x10/1kg placeholder', async () => {
    const { service, shiprocketService } = build();
    await service.pushOrderToShiprocketIfNeeded(
      baseOrder({
        packageLength: 25,
        packageBreadth: 15,
        packageHeight: 8,
        packageWeight: 1.4,
      }) as never,
    );
    const payload = shiprocketService.createOrder.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      length: 25,
      breadth: 15,
      height: 8,
      weight: 1.4,
    });
  });

  it('falls back to placeholder dimensions when the seller never submitted any', async () => {
    const { service, shiprocketService } = build();
    await service.pushOrderToShiprocketIfNeeded(baseOrder() as never);
    const payload = shiprocketService.createOrder.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      length: 10,
      breadth: 10,
      height: 10,
      weight: 1,
    });
  });

  it('sends a numeric placeholder HSN, not null (Shiprocket 422s on null)', async () => {
    const { service, shiprocketService } = build();
    await service.pushOrderToShiprocketIfNeeded(baseOrder() as never);
    const payload = shiprocketService.createOrder.mock.calls[0][0] as {
      order_items: Array<Record<string, unknown>>;
    };
    expect(payload.order_items[0].hsn).toBe('9999');
  });

  it('returns the Shiprocket-assigned fields to merge into the order update', async () => {
    const { service } = build(
      jest.fn().mockResolvedValue({
        order_id: 'sr-order-9',
        shipment_id: 'sr-shipment-9',
        awb_code: 'AWB9',
        courier_name: 'Delhivery',
      }),
    );
    const result = await service.pushOrderToShiprocketIfNeeded(
      baseOrder() as never,
    );
    expect(result).toEqual({
      shiprocketOrderId: 'sr-order-9',
      shipmentId: 'sr-shipment-9',
      awbCode: 'AWB9',
      courierName: 'Delhivery',
    });
  });

  it('swallows a Shiprocket API failure and returns {} instead of throwing', async () => {
    const { service } = build(
      jest.fn().mockRejectedValue(new Error('Shiprocket down')),
    );
    const result = await service.pushOrderToShiprocketIfNeeded(
      baseOrder() as never,
    );
    expect(result).toEqual({});
  });

  it('uses the pickup location resolved from Shiprocket, not a hardcoded "Primary"', async () => {
    const { service, shiprocketService } = build(
      undefined,
      jest.fn().mockResolvedValue('Warehouse'),
    );
    await service.pushOrderToShiprocketIfNeeded(baseOrder() as never);
    const payload = shiprocketService.createOrder.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.pickup_location).toBe('Warehouse');
  });

  it('swallows a pickup-location lookup failure and returns {} instead of throwing', async () => {
    const { service, shiprocketService } = build(
      undefined,
      jest.fn().mockRejectedValue(new Error('No pickup address configured')),
    );
    const result = await service.pushOrderToShiprocketIfNeeded(
      baseOrder() as never,
    );
    expect(result).toEqual({});
    expect(shiprocketService.createOrder).not.toHaveBeenCalled();
  });
});

describe('OrdersService.syncTrackingFields', () => {
  const build = () => {
    const prisma = { order: { update: jest.fn().mockResolvedValue({}) } };
    const service = new OrdersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
    return { service, prisma };
  };

  it('writes back awb and courier when Shiprocket has them', async () => {
    const { service, prisma } = build();
    await service.syncTrackingFields('order-1', {
      awb_code: 'AWB123',
      courier: 'Delhivery',
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { awbCode: 'AWB123', courierName: 'Delhivery' },
    });
  });

  it('does not write anything when Shiprocket has not assigned them yet', async () => {
    const { service, prisma } = build();
    await service.syncTrackingFields('order-1', {
      awb_code: null,
      courier: null,
    });
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('never throws if the write fails', async () => {
    const prisma = {
      order: { update: jest.fn().mockRejectedValue(new Error('db down')) },
    };
    const service = new OrdersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
    await expect(
      service.syncTrackingFields('order-1', { awb_code: 'AWB1' }),
    ).resolves.toBeUndefined();
  });
});

describe('OrdersService.notifyBuyerOfStatusChange', () => {
  const buildNotifyDeps = () => {
    const mailService = { sendMail: jest.fn().mockResolvedValue({ sent: true, retryable: false }) };
    const notificationsService = {
      notifyOrderDispatched: jest.fn().mockResolvedValue(undefined),
      notifyOrderShipped: jest.fn().mockResolvedValue(undefined),
      notifyOrderOutForDelivery: jest.fn().mockResolvedValue(undefined),
      notifyOrderDelivered: jest.fn().mockResolvedValue(undefined),
    };
    const otpSmsService = {
      sendTransactional: jest.fn().mockResolvedValue({ success: true }),
    };
    const service = new OrdersService(
      {} as never,
      {} as never,
      mailService as never,
      notificationsService as never,
      otpSmsService as never,
    );
    return { service, mailService, notificationsService, otpSmsService };
  };

  const order = {
    id: 'order-abc12345',
    buyerId: 'buyer-1',
    buyer: { email: 'buyer@example.com', phone: '9000000000' },
  };

  it('fires in-app, email, and SMS for a status the buyer cares about', async () => {
    const { service, mailService, notificationsService, otpSmsService } =
      buildNotifyDeps();

    await service.notifyBuyerOfStatusChange(order, OrderStatus.SHIPPED);

    expect(notificationsService.notifyOrderShipped).toHaveBeenCalledWith(
      'buyer-1',
      'order-abc12345',
    );
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'buyer@example.com' }),
    );
    expect(otpSmsService.sendTransactional).toHaveBeenCalledWith(
      '9000000000',
      expect.stringContaining('Shipped'),
    );
  });

  it('does nothing for a status the buyer does not need notifying about', async () => {
    const { service, mailService, notificationsService, otpSmsService } =
      buildNotifyDeps();

    await service.notifyBuyerOfStatusChange(order, OrderStatus.ACCEPTED);

    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(otpSmsService.sendTransactional).not.toHaveBeenCalled();
    expect(notificationsService.notifyOrderShipped).not.toHaveBeenCalled();
  });

  it('skips email when the buyer has none, but still sends SMS', async () => {
    const { service, mailService, otpSmsService } = buildNotifyDeps();

    await service.notifyBuyerOfStatusChange(
      { ...order, buyer: { email: null, phone: '9000000000' } },
      OrderStatus.OUT_FOR_DELIVERY,
    );

    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(otpSmsService.sendTransactional).toHaveBeenCalled();
  });

  it('never throws if a channel fails - one bad channel must not block the others', async () => {
    const { service, mailService, notificationsService, otpSmsService } =
      buildNotifyDeps();
    notificationsService.notifyOrderDelivered.mockRejectedValue(
      new Error('db down'),
    );
    mailService.sendMail.mockResolvedValue({ sent: false, retryable: true });
    otpSmsService.sendTransactional.mockResolvedValue({
      success: false,
      reason: 'not-configured',
    });

    await expect(
      service.notifyBuyerOfStatusChange(order, OrderStatus.DELIVERED),
    ).resolves.toBeUndefined();
  });
});

describe('OrdersService.notifySellersOfNewOrder', () => {
  const call = (
    service: OrdersService,
    pairs: { orderId: string; sellerId: string }[],
  ) =>
    (
      service as unknown as {
        notifySellersOfNewOrder(
          pairs: { orderId: string; sellerId: string }[],
        ): Promise<void>;
      }
    ).notifySellersOfNewOrder(pairs);

  const buildForNotify = (
    sellers: { id: string; userId: string; email: string | null; companyName: string }[],
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
    const service = new OrdersService(
      prisma as never,
      {} as never,
      mailService as never,
      notificationsService as never,
      {} as never,
    );
    return { service, prisma, notificationsService, mailService };
  };

  it('creates an in-app notification and emails each seller with an address', async () => {
    const { service, notificationsService, mailService } = buildForNotify([
      { id: 'seller-1', userId: 'user-1', email: 's1@example.com', companyName: 'Acme' },
      { id: 'seller-2', userId: 'user-2', email: 's2@example.com', companyName: 'Beta' },
    ]);

    await call(service, [
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

  it('skips the email but still creates the in-app notification when the seller has no address on file', async () => {
    const { service, notificationsService, mailService } = buildForNotify([
      { id: 'seller-1', userId: 'user-1', email: null, companyName: 'Acme' },
    ]);

    await call(service, [{ orderId: 'order-1', sellerId: 'seller-1' }]);

    expect(notificationsService.notifySellerNewOrder).toHaveBeenCalledWith('user-1', 'order-1');
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('does not throw when the in-app notification write fails', async () => {
    const { service, notificationsService } = buildForNotify([
      { id: 'seller-1', userId: 'user-1', email: 's1@example.com', companyName: 'Acme' },
    ]);
    notificationsService.notifySellerNewOrder.mockRejectedValue(new Error('db down'));

    await expect(
      call(service, [{ orderId: 'order-1', sellerId: 'seller-1' }]),
    ).resolves.toBeUndefined();
  });

  it('does not throw when the mailer reports failure', async () => {
    const { service, mailService } = buildForNotify([
      { id: 'seller-1', userId: 'user-1', email: 's1@example.com', companyName: 'Acme' },
    ]);
    mailService.sendMail.mockResolvedValue({ sent: false, retryable: true });

    await expect(
      call(service, [{ orderId: 'order-1', sellerId: 'seller-1' }]),
    ).resolves.toBeUndefined();
  });

  it('does nothing for an empty list, without querying sellers', async () => {
    const { service, prisma } = buildForNotify([]);

    await call(service, []);

    expect(prisma.sellerProfile.findMany).not.toHaveBeenCalled();
  });
});

describe('OrdersService.createSettlementsForDeliveredOrder', () => {
  const buildForSettlements = () => {
    const prisma = {
      sellerSettlement: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  };

  const item = (over: Record<string, unknown> = {}) => ({
    id: 'item-1',
    sellerId: 'seller-1',
    unitPrice: { toNumber: () => 100 } as never,
    quantity: 2,
    sellerOffer: {
      finalShippingPrice: null,
      shippingCharges: null,
      variant: { catalogProduct: { commissionPercent: 10, commissionGstPercent: 18 } },
    },
    ...over,
  });

  it('does nothing if the order is not DELIVERED', async () => {
    const { service, prisma } = buildForSettlements();
    await service.createSettlementsForDeliveredOrder({
      orderStatus: OrderStatus.SHIPPED,
      paymentStatus: 'SUCCESS' as never,
      items: [item()],
    });
    expect(prisma.sellerSettlement.create).not.toHaveBeenCalled();
  });

  it('does nothing if payment is not SUCCESS', async () => {
    const { service, prisma } = buildForSettlements();
    await service.createSettlementsForDeliveredOrder({
      orderStatus: OrderStatus.DELIVERED,
      paymentStatus: 'PENDING' as never,
      items: [item()],
    });
    expect(prisma.sellerSettlement.create).not.toHaveBeenCalled();
  });

  it('creates a settlement per item when DELIVERED and paid', async () => {
    const { service, prisma } = buildForSettlements();
    await service.createSettlementsForDeliveredOrder({
      orderStatus: OrderStatus.DELIVERED,
      paymentStatus: 'SUCCESS' as never,
      items: [item()],
    });
    expect(prisma.sellerSettlement.create).toHaveBeenCalledTimes(1);
    expect(prisma.sellerSettlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerId: 'seller-1', orderItemId: 'item-1' }),
      }),
    );
  });

  it('skips an item that already has a settlement (idempotent)', async () => {
    const { service, prisma } = buildForSettlements();
    prisma.sellerSettlement.findUnique.mockResolvedValue({ id: 'existing' });
    await service.createSettlementsForDeliveredOrder({
      orderStatus: OrderStatus.DELIVERED,
      paymentStatus: 'SUCCESS' as never,
      items: [item()],
    });
    expect(prisma.sellerSettlement.create).not.toHaveBeenCalled();
  });
});
