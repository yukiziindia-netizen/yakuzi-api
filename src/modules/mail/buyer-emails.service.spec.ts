import { BuyerEmailsService } from './buyer-emails.service';

/**
 * The rules that matter for these emails are the ones about restraint: never
 * twice, never to the wrong person, never at all when there is nothing useful
 * to say. Those are what this covers.
 */

const UNIQUE_VIOLATION = Object.assign(new Error('unique'), { code: 'P2002' });

const buildPrisma = () => ({
  emailDispatch: {
    create: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  user: { findUnique: jest.fn() },
  order: { findUnique: jest.fn() },
  ticket: { findUnique: jest.fn() },
  message: { findUnique: jest.fn() },
  cart: { findUnique: jest.fn() },
  review: { findMany: jest.fn().mockResolvedValue([]) },
});

const buildMail = (over: Partial<Record<string, unknown>> = {}) => ({
  isConfigured: jest.fn().mockReturnValue(true),
  sendMail: jest.fn().mockResolvedValue({ sent: true, retryable: false }),
  ...over,
});

const build = (mailOver = {}) => {
  const prisma = buildPrisma();
  const mail = buildMail(mailOver);
  const service = new BuyerEmailsService(prisma as never, mail as never);
  return { service, prisma, mail };
};

const OFFER = {
  id: 'offer-1',
  name: 'Nendoroid Gojo',
  slug: null,
  catalogProduct: {
    id: 'cat-1',
    name: 'Nendoroid Gojo Satoru',
    slug: 'nendoroid-gojo-satoru',
    images: [{ url: 'https://cdn.example.com/gojo.jpg' }],
  },
};

const ORDER = {
  id: 'order-1234-5678',
  buyerId: 'buyer-1',
  totalAmount: 7998,
  buyer: { email: 'buyer@example.com', buyerProfile: { legalName: 'Rishi Raj' } },
  items: [{ quantity: 2, unitPrice: 3999, totalPrice: 7998, sellerOffer: OFFER }],
};

describe('BuyerEmailsService', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  describe('when SMTP is not configured', () => {
    it('sends nothing and — crucially — claims nothing', async () => {
      const { service, prisma, mail } = build({
        isConfigured: jest.fn().mockReturnValue(false),
      });

      await service.sendWelcome('user-1');

      expect(mail.sendMail).not.toHaveBeenCalled();
      // If it claimed here, configuring the mailbox later would find every
      // buyer already marked as welcomed and nobody would ever get one.
      expect(prisma.emailDispatch.create).not.toHaveBeenCalled();
    });
  });

  describe('sendWelcome', () => {
    it('writes to a new buyer and greets them by first name', async () => {
      const { service, prisma, mail } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'buyer@example.com',
        buyerProfile: { legalName: 'Rishi Raj' },
      });

      await service.sendWelcome('user-1');

      expect(mail.sendMail).toHaveBeenCalledTimes(1);
      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.to).toBe('buyer@example.com');
      expect(sent.html).toContain('Rishi');
      expect(sent.text).toContain('Welcome to Yukizi');
    });

    it('stays quiet for a buyer who signed up with only a phone number', async () => {
      const { service, prisma, mail } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: null,
        buyerProfile: { legalName: 'Rishi' },
      });

      await service.sendWelcome('user-1');

      expect(mail.sendMail).not.toHaveBeenCalled();
    });

    it('sends nothing the second time, because the claim is already taken', async () => {
      const { service, prisma, mail } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'buyer@example.com',
        buyerProfile: null,
      });
      prisma.emailDispatch.create.mockRejectedValueOnce(UNIQUE_VIOLATION);

      await service.sendWelcome('user-1');

      expect(mail.sendMail).not.toHaveBeenCalled();
    });

    it('never throws, whatever the database does', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockRejectedValue(new Error('db is down'));

      await expect(service.sendWelcome('user-1')).resolves.toBeUndefined();
    });
  });

  describe('sendPaymentRecovery', () => {
    it('shows the items and links a one-tap cart restore', async () => {
      const { service, prisma, mail } = build();
      prisma.order.findUnique.mockResolvedValue(ORDER);

      await service.sendPaymentRecovery('order-1234-5678');

      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.subject).toContain('did not go through');
      expect(sent.html).toContain('Nendoroid Gojo Satoru');
      expect(sent.html).toContain('restore-cart?t=');
      // Says plainly that no money moved — the first thing the reader wants.
      expect(sent.html).toContain('nothing has been charged');
    });

    it('releases the claim when the failure is worth retrying', async () => {
      const { service, prisma } = build({
        sendMail: jest.fn().mockResolvedValue({ sent: false, retryable: true }),
      });
      prisma.order.findUnique.mockResolvedValue(ORDER);

      await service.sendPaymentRecovery('order-1234-5678');

      // Released under the SAME key it was claimed with — the order id, not
      // the buyer id — or the next run would find a claim nobody can clear.
      expect(prisma.emailDispatch.deleteMany).toHaveBeenCalledWith({
        where: { kind: 'payment_recovery', dedupeKey: 'order-1234-5678' },
      });
    });

    it('reports whether the buyer was actually reached', async () => {
      const reached = build();
      reached.prisma.order.findUnique.mockResolvedValue(ORDER);
      await expect(reached.service.sendPaymentRecovery('order-1234-5678')).resolves.toBe(true);

      // No email address — the sweep needs to know, so it can fall back to the
      // cancellation notice and its SMS.
      const unreachable = build();
      unreachable.prisma.order.findUnique.mockResolvedValue({
        ...ORDER,
        buyer: { email: null, buyerProfile: { legalName: 'Rishi' } },
      });
      await expect(
        unreachable.service.sendPaymentRecovery('order-1234-5678'),
      ).resolves.toBe(false);
    });

    it('keeps the claim when retrying could never work', async () => {
      const { service, prisma } = build({
        sendMail: jest.fn().mockResolvedValue({ sent: false, retryable: false }),
      });
      prisma.order.findUnique.mockResolvedValue(ORDER);

      await service.sendPaymentRecovery('order-1234-5678');

      expect(prisma.emailDispatch.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('sendRefundIssued', () => {
    const REFUNDED = {
      ...ORDER,
      refundedAt: new Date('2026-09-18T00:00:00Z'),
      refundAmount: 7998,
      refundReference: 'rfnd_abc123',
      refundNotes: 'Seller could not source it.',
    };

    it('leads with the amount and carries the reference', async () => {
      const { service, prisma, mail } = build();
      prisma.order.findUnique.mockResolvedValue(REFUNDED);

      await service.sendRefundIssued('order-1234-5678');

      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.subject).toContain('Refund issued');
      expect(sent.html).toContain('7,998.00');
      expect(sent.html).toContain('rfnd_abc123');
      expect(sent.html).toContain('Seller could not source it.');
    });

    it('says nothing until a refund has actually been recorded', async () => {
      const { service, prisma, mail } = build();
      prisma.order.findUnique.mockResolvedValue({ ...ORDER, refundedAt: null });

      await service.sendRefundIssued('order-1234-5678');

      expect(mail.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('sendTicketReply', () => {
    const REPLY = {
      id: 'msg-1',
      message: 'We have asked the seller to ship a replacement.',
      senderId: 'admin-1',
      sender: { role: 'ADMIN', adminProfile: { displayName: 'Aditi' } },
      ticket: {
        id: 'ticket-abcdef12',
        subject: 'Damaged box',
        userId: 'buyer-1',
        user: { email: 'buyer@example.com', buyerProfile: { legalName: 'Rishi' } },
      },
    };

    it('passes the reply on, named', async () => {
      const { service, prisma, mail } = build();
      prisma.message.findUnique.mockResolvedValue(REPLY);

      await service.sendTicketReply('ticket-abcdef12', 'msg-1');

      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.html).toContain('We have asked the seller to ship a replacement.');
      expect(sent.html).toContain('Aditi');
      expect(sent.subject).toContain('Damaged box');
    });

    it('never emails somebody their own message back', async () => {
      const { service, prisma, mail } = build();
      prisma.message.findUnique.mockResolvedValue({
        ...REPLY,
        senderId: 'buyer-1', // the ticket owner replying to themselves
      });

      await service.sendTicketReply('ticket-abcdef12', 'msg-1');

      expect(mail.sendMail).not.toHaveBeenCalled();
    });

    it('deduplicates on the message, so one reply is one email', async () => {
      const { service, prisma, mail } = build();
      prisma.message.findUnique.mockResolvedValue(REPLY);
      prisma.emailDispatch.create.mockRejectedValueOnce(UNIQUE_VIOLATION);

      await service.sendTicketReply('ticket-abcdef12', 'msg-1');

      expect(mail.sendMail).not.toHaveBeenCalled();
      expect(prisma.emailDispatch.create).toHaveBeenCalledWith({
        data: { kind: 'ticket_reply', dedupeKey: 'msg-1', userId: 'buyer-1' },
      });
    });
  });

  describe('sendReviewRequest', () => {
    it('asks about the products in the order', async () => {
      const { service, prisma, mail } = build();
      prisma.order.findUnique.mockResolvedValue(ORDER);

      await service.sendReviewRequest('order-1234-5678');

      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.subject).toContain('How was your Yukizi order');
      expect(sent.html).toContain('Nendoroid Gojo Satoru');
      // Steers a bad experience to support rather than into a public review.
      expect(sent.html).toContain('tell us instead');
    });

    it('leaves out anything the buyer has already reviewed', async () => {
      const { service, prisma, mail } = build();
      prisma.order.findUnique.mockResolvedValue({
        ...ORDER,
        items: [
          { quantity: 1, unitPrice: 100, totalPrice: 100, sellerOffer: OFFER },
          {
            quantity: 1,
            unitPrice: 200,
            totalPrice: 200,
            sellerOffer: {
              ...OFFER,
              catalogProduct: { ...OFFER.catalogProduct, id: 'cat-2', name: 'Nezuko' },
            },
          },
        ],
      });
      prisma.review.findMany.mockResolvedValue([{ catalogProductId: 'cat-1' }]);

      await service.sendReviewRequest('order-1234-5678');

      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.html).toContain('Nezuko');
      expect(sent.html).not.toContain('Nendoroid Gojo Satoru');
    });

    it('says nothing when every product has already been reviewed', async () => {
      const { service, prisma, mail } = build();
      prisma.order.findUnique.mockResolvedValue(ORDER);
      prisma.review.findMany.mockResolvedValue([{ catalogProductId: 'cat-1' }]);

      await service.sendReviewRequest('order-1234-5678');

      expect(mail.sendMail).not.toHaveBeenCalled();
      expect(prisma.emailDispatch.create).not.toHaveBeenCalled();
    });
  });

  describe('sendCartReminder', () => {
    const CART = {
      id: 'cart-1',
      userId: 'buyer-1',
      user: { email: 'buyer@example.com', buyerProfile: { legalName: 'Rishi' } },
      items: [{ quantity: 2, unitPrice: 3999, sellerOffer: OFFER }],
    };

    it('lists what is still in the cart, with a total', async () => {
      const { service, prisma, mail } = build();
      prisma.cart.findUnique.mockResolvedValue(CART);

      await service.sendCartReminder('cart-1', new Date('2026-09-18T10:00:00Z'));

      const sent = mail.sendMail.mock.calls[0][0];
      expect(sent.html).toContain('Nendoroid Gojo Satoru');
      expect(sent.html).toContain('7,998.00');
    });

    it('keys the claim on when the cart was last touched, so a changed cart is reachable again', async () => {
      const { service, prisma } = build();
      prisma.cart.findUnique.mockResolvedValue(CART);

      await service.sendCartReminder('cart-1', new Date('2026-09-18T10:00:00Z'));

      expect(prisma.emailDispatch.create).toHaveBeenCalledWith({
        data: {
          kind: 'cart_reminder',
          dedupeKey: 'cart-1:2026-09-18T10:00:00.000Z',
          userId: 'buyer-1',
        },
      });
    });

    it('says nothing about an empty cart', async () => {
      const { service, prisma, mail } = build();
      prisma.cart.findUnique.mockResolvedValue({ ...CART, items: [] });

      await service.sendCartReminder('cart-1', new Date());

      expect(mail.sendMail).not.toHaveBeenCalled();
    });
  });
});
