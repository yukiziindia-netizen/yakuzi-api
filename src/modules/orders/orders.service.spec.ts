import { OrdersService } from './orders.service';
import type { CreateOrderDto } from './dto/create-order.dto';

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
  const service = new OrdersService(prisma as never, {} as never);
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

  const build = (createOrderImpl?: jest.Mock) => {
    const shiprocketService = {
      createOrder:
        createOrderImpl ??
        jest.fn().mockResolvedValue({
          order_id: 'sr-order-1',
          shipment_id: 'sr-shipment-1',
          awb_code: null,
          courier_name: null,
        }),
    };
    const service = new OrdersService({} as never, shiprocketService as never);
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
});

describe('OrdersService.syncTrackingFields', () => {
  const build = () => {
    const prisma = { order: { update: jest.fn().mockResolvedValue({}) } };
    const service = new OrdersService(prisma as never, {} as never);
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
    const service = new OrdersService(prisma as never, {} as never);
    await expect(
      service.syncTrackingFields('order-1', { awb_code: 'AWB1' }),
    ).resolves.toBeUndefined();
  });
});
