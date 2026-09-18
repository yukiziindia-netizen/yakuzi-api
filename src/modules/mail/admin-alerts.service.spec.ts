import { AdminAlertsService } from './admin-alerts.service';

const UNIQUE_VIOLATION = Object.assign(new Error('unique'), { code: 'P2002' });

const build = (mailOver: Record<string, unknown> = {}) => {
  const prisma = {
    emailDispatch: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ticket: { findUnique: jest.fn() },
    order: { findUnique: jest.fn() },
  };
  const mail = {
    isConfigured: jest.fn().mockReturnValue(true),
    sendMail: jest.fn().mockResolvedValue({ sent: true, retryable: false }),
    resolveAdminRecipient: jest.fn().mockResolvedValue('ops@yukizi.com'),
    ...mailOver,
  };
  const service = new AdminAlertsService(prisma as never, mail as never);
  return { service, prisma, mail };
};

describe('AdminAlertsService', () => {
  describe('ticketRaised', () => {
    const TICKET = {
      id: 'ticket-abcdef12',
      subject: 'Order not delivered',
      orderId: 'order-1234abcd',
      user: {
        email: 'buyer@example.com',
        phone: null,
        role: 'BUYER',
        buyerProfile: { legalName: 'Rishi Raj' },
        sellerProfile: null,
      },
      messages: [{ message: 'It has been two weeks and nothing has arrived.' }],
    };

    it('puts enough in the inbox to triage without opening the panel', async () => {
      const { service, prisma, mail } = build();
      prisma.ticket.findUnique.mockResolvedValue(TICKET);

      await service.ticketRaised('ticket-abcdef12');

      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.to).toBe('ops@yukizi.com');
      expect(sent.subject).toContain('Order not delivered');
      expect(sent.html).toContain('Rishi Raj');
      expect(sent.html).toContain('It has been two weeks and nothing has arrived.');
      // The order it is about, so it can be looked up before replying.
      expect(sent.html).toContain('ORDER-12');
    });

    it('sends once per ticket', async () => {
      const { service, prisma, mail } = build();
      prisma.ticket.findUnique.mockResolvedValue(TICKET);
      prisma.emailDispatch.create.mockRejectedValueOnce(UNIQUE_VIOLATION);

      await service.ticketRaised('ticket-abcdef12');

      expect(mail.sendMail).not.toHaveBeenCalled();
    });

    it('does nothing — loudly — when no alert recipient is configured', async () => {
      const { service, prisma, mail } = build({
        resolveAdminRecipient: jest.fn().mockResolvedValue(undefined),
      });
      prisma.ticket.findUnique.mockResolvedValue(TICKET);

      await service.ticketRaised('ticket-abcdef12');

      expect(mail.sendMail).not.toHaveBeenCalled();
      // Nothing claimed either, so configuring a recipient later still works.
      expect(prisma.emailDispatch.create).not.toHaveBeenCalled();
    });
  });

  describe('shippingDetailsSubmitted', () => {
    it('carries the actual measurements, so a wrong one is catchable', async () => {
      const { service, prisma, mail } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1234abcd',
        packageLength: 30,
        packageBreadth: 20.5,
        packageHeight: 15,
        packageWeight: 1.25,
        items: [
          {
            quantity: 1,
            seller: { companyName: 'Acme Collectibles' },
            sellerOffer: { id: 'o1', name: 'Gojo', catalogProduct: { name: 'Gojo', images: [] } },
          },
        ],
      });

      await service.shippingDetailsSubmitted('order-1234abcd', 'seller-1');

      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.html).toContain('30 × 20.5 × 15 cm');
      expect(sent.html).toContain('1.25 kg');
      expect(sent.html).toContain('Acme Collectibles');
    });

    it('says so plainly when the seller left measurements out', async () => {
      const { service, prisma, mail } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1234abcd',
        packageLength: null,
        packageBreadth: null,
        packageHeight: null,
        packageWeight: null,
        items: [{ quantity: 1, seller: { companyName: 'Acme' }, sellerOffer: null }],
      });

      await service.shippingDetailsSubmitted('order-1234abcd', 'seller-1');

      expect(mail.sendMail.mock.calls[0][0].html).toContain('Not given');
    });
  });

  describe('selfShipTracking', () => {
    beforeEach(() => {
      // Nothing here depends on order contents beyond the seller name.
    });

    const setup = (build_: ReturnType<typeof build>) =>
      build_.prisma.order.findUnique.mockResolvedValue({
        id: 'order-1234abcd',
        items: [{ seller: { companyName: 'Acme Collectibles' } }],
      });

    it('includes the tracking link itself', async () => {
      const b = build();
      setup(b);

      await b.service.selfShipTracking(
        'order-1234abcd',
        'seller-1',
        'https://track.delhivery.com/abc',
        'Delhivery',
        true,
      );

      const sent = b.mail.sendMail.mock.calls[0][0];
      expect(sent.html).toContain('https://track.delhivery.com/abc');
      expect(sent.html).toContain('Delhivery');
      expect(sent.subject).toContain('added');
    });

    it('speaks up again when the seller CHANGES the link', async () => {
      const b = build();
      setup(b);

      await b.service.selfShipTracking('order-1234abcd', 'seller-1', 'https://a/1', null, true);
      await b.service.selfShipTracking('order-1234abcd', 'seller-1', 'https://b/2', null, false);

      // A corrected link is exactly the thing somebody needs to know about,
      // so the dedupe key carries the URL rather than just the order.
      expect(b.mail.sendMail).toHaveBeenCalledTimes(2);
      expect(b.mail.sendMail.mock.calls[1][0].subject).toContain('updated');
    });

    it('stays quiet when the same link is saved twice', async () => {
      const b = build();
      setup(b);
      b.prisma.emailDispatch.create
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(UNIQUE_VIOLATION);

      await b.service.selfShipTracking('order-1234abcd', 'seller-1', 'https://a/1', null, true);
      await b.service.selfShipTracking('order-1234abcd', 'seller-1', 'https://a/1', null, false);

      expect(b.mail.sendMail).toHaveBeenCalledTimes(1);
    });
  });

  describe('noTrackingDigest', () => {
    const stuck = [
      { id: 'order-1111aaaa', hours: 20, sellerName: 'Acme' },
      { id: 'order-2222bbbb', hours: 36, sellerName: 'Beta' },
    ];

    it('reports them as one list, not one email each', async () => {
      const { service, mail } = build();

      await service.noTrackingDigest(stuck);

      expect(mail.sendMail).toHaveBeenCalledTimes(1);
      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.subject).toContain('2 orders');
      expect(sent.html).toContain('ORDER-11');
      expect(sent.html).toContain('ORDER-22');
      expect(sent.html).toContain('36h ago');
    });

    it('leaves out orders already reported today, and sends nothing if all were', async () => {
      const { service, prisma, mail } = build();
      prisma.emailDispatch.create
        .mockRejectedValueOnce(UNIQUE_VIOLATION)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      await service.noTrackingDigest(stuck);

      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.html).not.toContain('ORDER-11');
      expect(sent.html).toContain('ORDER-22');
    });

    it('says nothing at all when there is nothing stuck', async () => {
      const { service, mail } = build();

      await service.noTrackingDigest([]);

      expect(mail.sendMail).not.toHaveBeenCalled();
    });

    it('uses the singular when there is exactly one', async () => {
      const { service, mail } = build();

      await service.noTrackingDigest([stuck[0]]);

      expect(mail.sendMail.mock.calls[0][0].subject).toBe(
        'An order was dispatched with no tracking',
      );
    });
  });
});
