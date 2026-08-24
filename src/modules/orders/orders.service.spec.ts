import { OrdersService } from './orders.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus, PaymentStatus, Role } from '@prisma/client';

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
      {} as never,
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
      {} as never,
    );
    return { service, prisma };
  };

  const item = (over: Record<string, unknown> = {}) => ({
    id: 'item-1',
    sellerId: 'seller-1',
    unitPrice: 100,
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
    // unitPrice 100 * qty 2 = gross 200; commission 10% = 20; commissionGst 18% of 20 = 3.6;
    // netPayout = 200 - 20 - 3.6 - 0(shipping) = 176.4
    expect(prisma.sellerSettlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sellerId: 'seller-1',
          orderItemId: 'item-1',
          grossAmount: '200',
          commission: '20',
          commissionGst: '3.6',
          netPayout: '176.4',
        }),
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

describe('OrdersService.checkout — price integrity', () => {
  const cartItem = (overrides: Partial<any> = {}) => ({
    id: 'cartitem-1',
    sellerOfferId: 'offer-1', // flat scalar CartItem.sellerOfferId, separate from the nested sellerOffer relation below — orderItemsData reads this directly
    quantity: 2,
    unitPrice: 50, // stale snapshot from whenever the item was added to cart
    sellerOffer: {
      id: 'offer-1',
      name: 'Test Product',
      isActive: true,
      deletedAt: null,
      mrp: 100,
      finalCustomerPayable: 80, // the seller's CURRENT price — different from unitPrice above
      seller: { id: 'seller-1', verificationStatus: 'APPROVED', companyName: 'Acme' },
      batches: [{ id: 'batch-1', stock: 10, expiryDate: new Date('2099-01-01') }],
      ...overrides,
    },
  });

  const buildCheckout = (items: any[]) => {
    const txOrderItemCreateManyCalls: any[] = [];
    const tx = {
      order: { create: jest.fn().mockResolvedValue({ id: 'order-1' }) },
      orderItem: {
        createMany: jest.fn().mockImplementation((args: any) => {
          txOrderItemCreateManyCalls.push(args);
          return Promise.resolve({ count: args.data.length });
        }),
      },
      orderAddress: { create: jest.fn().mockResolvedValue({}) },
      productBatch: { update: jest.fn().mockResolvedValue({}) },
      cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: items.length }) },
    };
    const prisma = {
      cart: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cart-1', items }),
      },
      buyerProfile: {
        findUnique: jest.fn().mockResolvedValue({ referralCodeId: null }),
      },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
      // checkout()'s final "5. Fetch the created order with full details" step
      // (orders.service.ts:592) runs after the transaction, unwrapped in any
      // try/catch — items: [] keeps its follow-up per-item catalogProduct
      // lookup loop a no-op, so no further prisma.catalogProduct mock is needed.
      order: {
        findUnique: jest.fn().mockResolvedValue({ id: 'order-1', items: [] }),
      },
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, tx, txOrderItemCreateManyCalls };
  };

  // deferSellerNotification: true skips checkout()'s post-transaction
  // this.sellerOrderNotifier.notifySellersOfNewOrder(...) call entirely (see
  // orders.service.ts's "4f. Notify each seller" block) — needed here because
  // this test's OrdersService is built with sellerOrderNotifier as `{} as
  // never`; without this flag, checkout() would call a method that doesn't
  // exist on `{}` and throw synchronously (not something a `.catch()` further
  // down the chain could ever reach, since the call itself never returns).
  const checkoutDto = () => dto({ deferSellerNotification: true } as never);

  it('charges the live seller price, not the cart item\'s stale unitPrice snapshot', async () => {
    const { service, txOrderItemCreateManyCalls } = buildCheckout([cartItem()]);

    await service.checkout('buyer-1', checkoutDto());

    const created = txOrderItemCreateManyCalls[0].data[0];
    expect(created.unitPrice).toBe(80); // live finalCustomerPayable, not the stale 50
    expect(created.totalPrice).toBe(160); // 2 * 80, not 2 * 50
  });

  it('falls back to live mrp when finalCustomerPayable is null', async () => {
    const { service, txOrderItemCreateManyCalls } = buildCheckout([
      cartItem({ finalCustomerPayable: null }),
    ]);

    await service.checkout('buyer-1', checkoutDto());

    expect(txOrderItemCreateManyCalls[0].data[0].unitPrice).toBe(100);
  });

  it('still rejects a deactivated offer before any price recompute', async () => {
    const { service } = buildCheckout([cartItem({ isActive: false })]);

    await expect(service.checkout('buyer-1', checkoutDto())).rejects.toThrow(
      'Product "Test Product" is no longer available. Please remove it from your cart.',
    );
  });
});


describe('OrdersService.updateShippingDetails — auto-accept + Shiprocket push', () => {
  const build = ({ updatedCount = 1 } = {}) => {
    const prisma = {
      sellerProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 'seller-1', userId: 'user-1' }),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([{ id: 'item-1', isShippingLocked: false }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        update: jest.fn().mockResolvedValue({ id: 'order-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: updatedCount }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          buyerId: 'buyer-1',
          buyer: { email: 'b@x.com', phone: '9999999999' },
          address: null,
          items: [],
        }),
      },
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const notifySpy = jest
      .spyOn(service, 'notifyBuyerOfStatusChange')
      .mockResolvedValue(undefined);
    const pushSpy = jest
      .spyOn(service, 'pushOrderToShiprocketIfNeeded')
      .mockResolvedValue({ shiprocketOrderId: 'sr-1', shipmentId: 'ship-1' });
    return { service, prisma, notifySpy, pushSpy };
  };

  const dto = { packageWeight: 2 } as never;

  it('advances a PLACED order to ACCEPTED with a status-guarded write and notifies the buyer', async () => {
    const { service, prisma, notifySpy } = build();
    await service.updateShippingDetails('user-1', 'order-1', dto);

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', orderStatus: OrderStatus.PLACED },
      data: { orderStatus: OrderStatus.ACCEPTED },
    });
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1' }),
      OrderStatus.ACCEPTED,
    );
  });

  it('pushes the order to Shiprocket and persists the returned identifiers', async () => {
    const { service, prisma, pushSpy } = build();
    await service.updateShippingDetails('user-1', 'order-1', dto);

    expect(pushSpy).toHaveBeenCalled();
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { shiprocketOrderId: 'sr-1', shipmentId: 'ship-1' },
    });
  });

  it('does not notify when the guarded accept write loses (order no longer PLACED) but still pushes', async () => {
    const { service, notifySpy, pushSpy } = build({ updatedCount: 0 });
    await service.updateShippingDetails('user-1', 'order-1', dto);

    expect(notifySpy).not.toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalled();
  });

  it('skips the extra persist when the push no-ops (already pushed / failed)', async () => {
    const { service, prisma, pushSpy } = build();
    pushSpy.mockResolvedValue({});
    await service.updateShippingDetails('user-1', 'order-1', dto);

    const persistCalls = prisma.order.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.shiprocketOrderId,
    );
    expect(persistCalls).toHaveLength(0);
  });

  it('never lets an auto-accept/push failure break the shipping-details save itself', async () => {
    const { service, pushSpy } = build();
    pushSpy.mockRejectedValue(new Error('shiprocket down'));
    await expect(
      service.updateShippingDetails('user-1', 'order-1', dto),
    ).resolves.toEqual({ id: 'order-1' });
  });
});

describe('OrdersService.cancelOrder', () => {
  const build = (
    order: {
      buyerId?: string;
      orderStatus?: OrderStatus;
      paymentStatus?: PaymentStatus;
    } = {},
    // Lets a test simulate a payment confirming in the gap between the
    // initial read and the guarded transactional write, by controlling how
    // many rows the guarded updateMany reports as matched.
    guardedUpdateCount = 1,
  ) => {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          buyerId: order.buyerId ?? 'buyer-1',
          orderStatus: order.orderStatus ?? OrderStatus.PLACED,
          paymentStatus: order.paymentStatus ?? PaymentStatus.PENDING,
          items: [],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: guardedUpdateCount }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'order-1', orderStatus: OrderStatus.CANCELLED }),
      },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(prisma)),
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  };

  const paidGuardWhere = {
    id: 'order-1',
    paymentStatus: { notIn: [PaymentStatus.SUCCESS, PaymentStatus.PARTIAL] },
  };

  it('cancels an unpaid PLACED order and restores stock', async () => {
    const { service, prisma } = build();

    await service.cancelOrder('buyer-1', 'order-1', Role.BUYER);

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: paidGuardWhere,
      data: { orderStatus: OrderStatus.CANCELLED },
    });
  });

  it('refuses to cancel an order that has already been paid for, even for its own buyer', async () => {
    const { service, prisma } = build({ paymentStatus: PaymentStatus.SUCCESS });

    await expect(
      service.cancelOrder('buyer-1', 'order-1', Role.BUYER),
    ).rejects.toThrow('This order has a confirmed payment');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to cancel a paid order for an admin caller too', async () => {
    const { service, prisma } = build({ paymentStatus: PaymentStatus.SUCCESS });

    await expect(
      service.cancelOrder('admin-1', 'order-1', Role.ADMIN),
    ).rejects.toThrow('This order has a confirmed payment');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to cancel a PARTIAL-payment order — that represents real confirmed money, not "unpaid yet"', async () => {
    const { service, prisma } = build({ paymentStatus: PaymentStatus.PARTIAL });

    await expect(
      service.cancelOrder('buyer-1', 'order-1', Role.BUYER),
    ).rejects.toThrow('This order has a confirmed payment');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('still rejects an already-cancelled order before the payment check would even matter', async () => {
    const { service } = build({ orderStatus: OrderStatus.CANCELLED });

    await expect(
      service.cancelOrder('buyer-1', 'order-1', Role.BUYER),
    ).rejects.toThrow('Cannot cancel order in CANCELLED status');
  });

  it('aborts if the payment gets confirmed in the gap between the read and the guarded write', async () => {
    // Initial read still sees PENDING (so it passes the first guard), but
    // the guarded updateMany matches zero rows - as it would if a separate
    // PaymentsService.confirmPayment transaction committed SUCCESS/PARTIAL
    // in between. Nothing after the guarded write must run.
    const { service, prisma } = build({ paymentStatus: PaymentStatus.PENDING }, 0);

    await expect(
      service.cancelOrder('buyer-1', 'order-1', Role.BUYER),
    ).rejects.toThrow('This order has a confirmed payment');
    expect(prisma.order.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
