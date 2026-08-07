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
