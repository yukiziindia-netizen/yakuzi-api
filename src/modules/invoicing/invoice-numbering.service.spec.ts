import { InvoiceNumberingService, nextInSeries } from './invoice-numbering.service';

describe('nextInSeries', () => {
  it('issues the admin-set number exactly, not one after it', () => {
    // The whole point of the feature: type 1000, the next invoice IS 1000.
    expect(
      nextInSeries({ storedPeriod: '2026', currentPeriod: '2026', next: 1000, resetStart: 1 }),
    ).toBe(1000);
  });

  it('restarts at the start number when the reset window rolls over', () => {
    expect(
      nextInSeries({ storedPeriod: '2025', currentPeriod: '2026', next: 4821, resetStart: 1 }),
    ).toBe(1);
  });

  it('restarts at a non-1 start number when configured', () => {
    expect(
      nextInSeries({ storedPeriod: '2025', currentPeriod: '2026', next: 9999, resetStart: 500 }),
    ).toBe(500);
  });
});

describe('InvoiceNumberingService.periodFor', () => {
  const svc = new InvoiceNumberingService({} as never);

  it('opens the window on the reset day (default 1 April = Indian FY)', () => {
    // 31 March 2027 still belongs to the window that opened 1 April 2026.
    expect(svc.periodFor(new Date(2027, 2, 31), 4, 1)).toBe(2026);
    // 1 April 2027 opens the next window.
    expect(svc.periodFor(new Date(2027, 3, 1), 4, 1)).toBe(2027);
  });

  it('honours a custom reset date', () => {
    // Reset on 1 January: a December date is still the year it falls in.
    expect(svc.periodFor(new Date(2026, 11, 31), 1, 1)).toBe(2026);
    expect(svc.periodFor(new Date(2026, 0, 1), 1, 1)).toBe(2026);
    // The day before the reset belongs to the previous window.
    expect(svc.periodFor(new Date(2026, 5, 30), 7, 1)).toBe(2025);
    expect(svc.periodFor(new Date(2026, 6, 1), 7, 1)).toBe(2026);
  });
});

describe('InvoiceNumberingService gating', () => {
  it('does nothing and assigns no number when numbering is disabled', async () => {
    const prisma = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue({ key: 'invoiceNumbering.enabled', value: 'false' }),
        findMany: jest.fn(),
        upsert: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const svc = new InvoiceNumberingService(prisma as never);

    await svc.assignForOrder('order-1', ['seller-1'], new Date(2026, 5, 1));
    expect(await svc.resolveForOrder('order-1')).toEqual(new Map());
    expect(await svc.peekForSettlement('settle-1')).toBeNull();

    // No allocation, no ledger write, ever, while disabled.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
