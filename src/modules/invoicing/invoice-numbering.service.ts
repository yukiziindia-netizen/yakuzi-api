import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Admin-controlled sequential invoice numbering, shared by the consumer tax
 * invoice (InvoiceService) and the commission invoice (CommissionInvoiceService).
 *
 * WHY THIS EXISTS
 * Invoice numbers used to be derived from the order/settlement UUID
 * (YKZ/INV/2026-27/00323711). Legible and stable, but not a gapless sequence —
 * and a store owner needs to control the series a tax authority sees: where it
 * starts, and when it restarts each year.
 *
 * TWO HARD CONSTRAINTS SHAPED THE DESIGN
 *  1. No migrations. The API deploy runs `prisma generate` but never
 *     `prisma migrate deploy`, so a new table cannot be relied on. Everything
 *     here lives in the existing SystemSetting key/value store — both the
 *     admin config AND the per-invoice number ledger.
 *  2. Invoices are re-derived on every view, so a number computed at render
 *     time would change between views. A number is therefore ALLOCATED ONCE,
 *     at issuance, and written to the ledger; every later render reads it back.
 *
 * FORWARD-ONLY. When numbering is disabled, or for any invoice with no ledger
 * entry (everything issued before this feature), callers fall back to the old
 * UUID scheme. Turning this on never renumbers an invoice already issued —
 * retroactively changing an issued tax invoice's number is itself
 * non-compliant.
 */

export type InvoiceSeries = 'consumer' | 'seller';

const KEY = {
  enabled: 'invoiceNumbering.enabled',
  resetMonth: 'invoiceNumbering.resetMonth',
  resetDay: 'invoiceNumbering.resetDay',
  prefix: (s: InvoiceSeries) => `invoiceNumbering.${s}.prefix`,
  next: (s: InvoiceSeries) => `invoiceNumbering.${s}.next`,
  resetStart: (s: InvoiceSeries) => `invoiceNumbering.${s}.resetStart`,
  period: (s: InvoiceSeries) => `invoiceNumbering.${s}.period`,
} as const;

const DEFAULTS = {
  resetMonth: 4, // 1 April — the Indian financial year, matching the old scheme
  resetDay: 1,
  prefix: { consumer: 'YKZ/INV', seller: 'YKZ/COM' } as Record<InvoiceSeries, string>,
  start: 1,
  padding: 4,
};

const consumerLedgerKey = (orderId: string, sellerId: string) =>
  `invoiceAssigned.consumer.${orderId}.${sellerId}`;
const sellerLedgerKey = (settlementId: string) =>
  `invoiceAssigned.seller.${settlementId}`;

/**
 * The number to issue, given the counter's state. Pure so the one rule that
 * must never be wrong — the admin's number is issued exactly, and a new
 * reset-window restarts at the start number — is testable without a database.
 */
export function nextInSeries(input: {
  storedPeriod: string;
  currentPeriod: string;
  next: number;
  resetStart: number;
}): number {
  return input.storedPeriod === input.currentPeriod ? input.next : input.resetStart;
}

@Injectable()
export class InvoiceNumberingService {
  private readonly logger = new Logger(InvoiceNumberingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Master switch. Off (the default) means every caller keeps the UUID scheme. */
  async isEnabled(): Promise<boolean> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: KEY.enabled },
    });
    return row?.value?.trim().toLowerCase() === 'true';
  }

  // ── Consumer (buyer tax invoice) ──────────────────────────────────────────

  /**
   * Assign numbers for an order's per-seller invoices, at issuance. Idempotent:
   * a seller already in the ledger keeps its number, so a retried dispatch or a
   * second "email me" never advances the sequence or renumbers anything.
   * `sellerIds` MUST arrive in the same sorted order InvoiceService renders in,
   * so the number a seller gets is deterministic.
   */
  async assignForOrder(
    orderId: string,
    sellerIds: string[],
    issuedAt: Date,
  ): Promise<void> {
    if (!(await this.isEnabled())) return;
    for (const sellerId of sellerIds) {
      const key = consumerLedgerKey(orderId, sellerId);
      const existing = await this.prisma.systemSetting.findUnique({ where: { key } });
      if (existing) continue;
      const number = await this.allocateFormatted('consumer', issuedAt);
      // create-only: if a concurrent dispatch got here first, keep theirs.
      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: number },
        update: {},
      });
    }
  }

  /** sellerId → assigned invoice number, for numbers already in the ledger. */
  async resolveForOrder(orderId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!(await this.isEnabled())) return out;
    const prefix = `invoiceAssigned.consumer.${orderId}.`;
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: prefix } },
    });
    for (const row of rows) out.set(row.key.slice(prefix.length), row.value);
    return out;
  }

  // ── Seller (commission invoice) ───────────────────────────────────────────

  /** Assign — or return the already-assigned — number for one settlement. */
  async assignForSettlement(settlementId: string, issuedAt: Date): Promise<string | null> {
    if (!(await this.isEnabled())) return null;
    const key = sellerLedgerKey(settlementId);
    const existing = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (existing) return existing.value;
    const number = await this.allocateFormatted('seller', issuedAt);
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: number },
      update: {},
    });
    // Re-read in case a concurrent caller won the create.
    const settled = await this.prisma.systemSetting.findUnique({ where: { key } });
    return settled?.value ?? number;
  }

  /** The assigned number for a settlement, or null if none/disabled. */
  async peekForSettlement(settlementId: string): Promise<string | null> {
    if (!(await this.isEnabled())) return null;
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: sellerLedgerKey(settlementId) },
    });
    return row?.value ?? null;
  }

  /**
   * Mark both series' counters as belonging to the current reset-window.
   *
   * Called right after an admin saves the numbering settings. Without it, a
   * freshly-typed "next number" would be discarded on its first use: the
   * allocator, seeing the stored window marker still empty or stale, would
   * treat that allocation as a new year and reset to the start number instead
   * of issuing the number the admin just entered. Stamping the current window
   * here makes the admin's value authoritative immediately, while a genuine
   * year rollover (detected between saves) still resets on its own.
   */
  async stampCurrentPeriods(at: Date = new Date()): Promise<void> {
    const resetMonth = await this.readInt(KEY.resetMonth, DEFAULTS.resetMonth);
    const resetDay = await this.readInt(KEY.resetDay, DEFAULTS.resetDay);
    const period = String(this.periodFor(at, resetMonth, resetDay));
    for (const series of ['consumer', 'seller'] as InvoiceSeries[]) {
      const key = KEY.period(series);
      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: period },
        update: { value: period },
      });
    }
  }

  // ── Allocation ────────────────────────────────────────────────────────────

  private async allocateFormatted(series: InvoiceSeries, at: Date): Promise<string> {
    const [n, cfg] = await this.allocate(series, at);
    const label = this.fyLabel(this.periodFor(at, cfg.resetMonth, cfg.resetDay));
    return `${cfg.prefix}/${label}/${String(n).padStart(DEFAULTS.padding, '0')}`;
  }

  /**
   * The next number in the series, and the config used. Locks the counter row
   * so two invoices issued at once cannot take the same number. Applies the
   * annual reset: the first invoice of a new reset-window restarts at the
   * admin's start number.
   */
  private async allocate(
    series: InvoiceSeries,
    at: Date,
  ): Promise<[number, { resetMonth: number; resetDay: number; prefix: string }]> {
    const resetMonth = await this.readInt(KEY.resetMonth, DEFAULTS.resetMonth);
    const resetDay = await this.readInt(KEY.resetDay, DEFAULTS.resetDay);
    const prefix = await this.readStr(KEY.prefix(series), DEFAULTS.prefix[series]);
    const period = String(this.periodFor(at, resetMonth, resetDay));

    const nextKey = KEY.next(series);
    const periodKey = KEY.period(series);
    const startKey = KEY.resetStart(series);

    // Guarantee the rows exist so FOR UPDATE has something to lock; never
    // clobber an admin-set value.
    await this.prisma.systemSetting.createMany({
      data: [
        { key: nextKey, value: String(DEFAULTS.start) },
        { key: startKey, value: String(DEFAULTS.start) },
        { key: periodKey, value: '' },
      ],
      skipDuplicates: true,
    });

    const number = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ key: string; value: string }[]>`
        SELECT key, value FROM system_settings
        WHERE key IN (${nextKey}, ${periodKey}, ${startKey})
        FOR UPDATE
      `;
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      const toInt = (v: string | undefined, fb: number) => {
        const n = parseInt((v ?? '').trim(), 10);
        return Number.isFinite(n) ? n : fb;
      };
      const storedPeriod = (byKey.get(periodKey) ?? '').trim();
      const resetStart = toInt(byKey.get(startKey), DEFAULTS.start);
      const nextVal = toInt(byKey.get(nextKey), DEFAULTS.start);

      // A new reset-window restarts the sequence; within one, take `next` as-is
      // — so the number an admin typed is the one actually issued, never +1.
      const allocated = nextInSeries({
        storedPeriod,
        currentPeriod: period,
        next: nextVal,
        resetStart,
      });

      await tx.$executeRaw`
        UPDATE system_settings SET value = ${String(allocated + 1)} WHERE key = ${nextKey}
      `;
      await tx.$executeRaw`
        UPDATE system_settings SET value = ${period} WHERE key = ${periodKey}
      `;
      return allocated;
    });

    return [number, { resetMonth, resetDay, prefix }];
  }

  // ── Date maths ──────────────────────────────────────────────────────────

  /**
   * The calendar year the current reset-window opened in. A date on/after the
   * reset day this year belongs to this year's window; earlier, to last year's.
   * With the 1-April default this is exactly the Indian financial year start.
   */
  periodFor(date: Date, resetMonth: number, resetDay: number): number {
    const y = date.getFullYear();
    const started = new Date(y, resetMonth - 1, resetDay, 0, 0, 0, 0);
    return date >= started ? y : y - 1;
  }

  /** e.g. 2026 -> "2026-27". */
  private fyLabel(startYear: number): string {
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  }

  private async readInt(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const n = parseInt((row?.value ?? '').trim(), 10);
    return Number.isFinite(n) ? n : fallback;
  }

  private async readStr(key: string, fallback: string): Promise<string> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row?.value?.trim() || fallback;
  }
}
