import { NotificationsService } from './notifications.service';

/**
 * These four methods were written a long time ago and never called by
 * anything. Now that they are wired up, the part worth pinning down is the
 * one judgement call in them: how many notifications one checkout produces.
 */
describe('NotificationsService.notifyCheckoutPlaced', () => {
  const build = () => {
    const prisma = {
      notification: { create: jest.fn().mockResolvedValue({ id: 'n1' }) },
    };
    return { service: new NotificationsService(prisma as never), prisma };
  };

  const messageOf = (prisma: any) =>
    prisma.notification.create.mock.calls[0][0].data.message as string;

  it('writes one notification for a single-seller checkout', async () => {
    const { service, prisma } = build();

    await service.notifyCheckoutPlaced('buyer-1', ['7f3c1a2b-0000-1111-2222-333344445555']);

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(messageOf(prisma)).toContain('has been placed');
    expect(messageOf(prisma)).toContain('7f3c1a2b');
  });

  it('writes ONE notification for a multi-seller checkout, not one per order', async () => {
    const { service, prisma } = build();

    await service.notifyCheckoutPlaced('buyer-1', ['o1', 'o2', 'o3']);

    // Three pings for one button press reads as a bug. Every later
    // notification is per order, which is right — by then they are genuinely
    // separate things being tracked separately.
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(messageOf(prisma)).toContain('3 shipments');
  });

  it('writes nothing when there are no orders', async () => {
    const { service, prisma } = build();

    await service.notifyCheckoutPlaced('buyer-1', []);

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('addresses it to the buyer', async () => {
    const { service, prisma } = build();

    await service.notifyCheckoutPlaced('buyer-1', ['o1']);

    expect(prisma.notification.create.mock.calls[0][0].data.userId).toBe('buyer-1');
  });
});
