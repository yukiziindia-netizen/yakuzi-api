import { InvoiceEmailService } from './invoice-email.service';
import type { Invoice } from './invoice.service';
import type { SendMailOptions } from '../mail/mail.service';

const ORDER_ID = '00323711-1111-2222-3333-444444444444';
const ORDER_ID_2 = '00abcdef-5555-6666-7777-888888888888';

const invoice = (): Invoice => ({
  invoiceNumber: 'YKZ/INV/2026-27/00323711',
  invoiceDate: '2026-08-06T10:00:00.000Z',
  orderReference: 'YKZ/ORD/2026-27/00323711',
  seller: {
    name: 'Galazy',
    gstin: null,
    address: '',
    phone: null,
    email: null,
  },
  buyer: {
    name: 'Arko',
    gstin: null,
    address: '',
    phone: null,
    email: 'buyer@example.com',
  },
  placeOfSupply: 'West Bengal',
  isIntraState: true,
  lines: [],
  taxBreakdown: [],
  subtotal: 168.71,
  cgst: 8.44,
  sgst: 8.43,
  igst: 0,
  totalTax: 16.87,
  totalAmount: 185.58,
  amountInWords: 'One Hundred Eighty Five Rupees and Fifty Eight Paise Only',
});

const build = (
  over: {
    buyerEmail?: string | null;
    ledgerHit?: boolean;
    mailResults?: { sent: boolean; retryable: boolean }[];
  } = {},
) => {
  const prisma = {
    order: {
      // sendForOrders loads the whole confirmed group at once, so this is
      // findMany returning an array — not findUnique.
      findMany: jest.fn().mockResolvedValue([
        {
          id: ORDER_ID,
          buyerId: 'buyer-1',
          buyer: {
            id: 'buyer-1',
            email:
              over.buyerEmail === undefined
                ? 'buyer@example.com'
                : over.buyerEmail,
          },
        },
      ]),
    },
    notification: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.ledgerHit ? { id: 'n1' } : null),
      create: jest.fn().mockResolvedValue({ id: 'n2' }),
    },
  };

  const results = over.mailResults ?? [{ sent: true, retryable: false }];
  let call = 0;
  const mail = {
    isConfigured: jest.fn().mockReturnValue(true),
    sendMail: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(results[Math.min(call++, results.length - 1)]),
      ),
  };

  const invoices = {
    buildInvoicesForOrder: jest.fn().mockResolvedValue([invoice()]),
  };
  const pdf = {
    render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.3 fake')),
    filename: jest.fn().mockReturnValue('YKZ-INV-2026-27-00323711.pdf'),
  };

  const service = new InvoiceEmailService(
    prisma as never,
    invoices as never,
    pdf as never,
    mail as never,
  );
  // Keep the retry test fast.
  (service as unknown as { backoffMs: number[] }).backoffMs = [0, 0, 0];

  return { service, prisma, mail, invoices, pdf };
};

describe('InvoiceEmailService', () => {
  it('sends one email carrying every order invoice and writes the ledger', async () => {
    const { service, mail, prisma } = build();

    const sent = await service.sendForOrders([ORDER_ID]);

    expect(sent).toBe(true);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    const sentMessage = (mail.sendMail.mock.calls as SendMailOptions[][])[0][0];
    expect(sentMessage.to).toBe('buyer@example.com');
    expect(sentMessage.attachments).toHaveLength(1);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the invoice was already emailed', async () => {
    const { service, mail, prisma } = build({ ledgerHit: true });

    const sent = await service.sendForOrders([ORDER_ID]);

    expect(sent).toBe(false);
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('resends when forced, ignoring the ledger', async () => {
    const { service, mail } = build({ ledgerHit: true });

    await service.sendForOrders([ORDER_ID], { force: true });

    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it('skips silently when the buyer has no email address', async () => {
    const { service, mail, prisma } = build({ buyerEmail: null });

    const sent = await service.sendForOrders([ORDER_ID]);

    expect(sent).toBe(false);
    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('retries a transient failure and writes the ledger once it succeeds', async () => {
    const { service, mail, prisma } = build({
      mailResults: [
        { sent: false, retryable: true },
        { sent: true, retryable: false },
      ],
    });

    const sent = await service.sendForOrders([ORDER_ID]);

    expect(sent).toBe(true);
    expect(mail.sendMail).toHaveBeenCalledTimes(2);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('gives up after three attempts and does NOT write the ledger', async () => {
    const { service, mail, prisma } = build({
      mailResults: [{ sent: false, retryable: true }],
    });

    const sent = await service.sendForOrders([ORDER_ID]);

    expect(sent).toBe(false);
    expect(mail.sendMail).toHaveBeenCalledTimes(3);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('does not retry a permanent failure', async () => {
    const { service, mail } = build({
      mailResults: [{ sent: false, retryable: false }],
    });

    await service.sendForOrders([ORDER_ID]);

    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it('never rejects, whatever the database does', async () => {
    const { service, prisma } = build();
    prisma.order.findMany.mockRejectedValue(new Error('connection lost'));

    await expect(service.sendForOrders([ORDER_ID])).resolves.toBe(false);
  });

  it('drops orders belonging to a different buyer and still emails the rest', async () => {
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: ORDER_ID,
            buyerId: 'buyer-1',
            buyer: { id: 'buyer-1', email: 'buyer@example.com' },
          },
          {
            id: ORDER_ID_2,
            buyerId: 'buyer-2',
            buyer: { id: 'buyer-2', email: 'other@example.com' },
          },
        ]),
      },
      notification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n2' }),
      },
    };

    const mail = {
      isConfigured: jest.fn().mockReturnValue(true),
      sendMail: jest.fn().mockResolvedValue({ sent: true, retryable: false }),
    };

    const invoices = {
      buildInvoicesForOrder: jest.fn().mockResolvedValue([invoice()]),
    };
    const pdf = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.3 fake')),
      filename: jest.fn().mockReturnValue('YKZ-INV-2026-27-00323711.pdf'),
    };

    const service = new InvoiceEmailService(
      prisma as never,
      invoices as never,
      pdf as never,
      mail as never,
    );
    (service as unknown as { backoffMs: number[] }).backoffMs = [0, 0, 0];

    const sent = await service.sendForOrders([ORDER_ID, ORDER_ID_2]);

    expect(sent).toBe(true);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    const sentMessage = (mail.sendMail.mock.calls as SendMailOptions[][])[0][0];
    // Only the first buyer's single order should have produced an invoice/attachment.
    expect(sentMessage.attachments).toHaveLength(1);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    const createArgs = (
      prisma.notification.create.mock.calls as { data: { userId: string } }[][]
    )[0][0];
    expect(createArgs.data.userId).toBe('buyer-1');
  });
});
