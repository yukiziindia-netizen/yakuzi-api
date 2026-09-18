import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BuyerEmailsService } from './buyer-emails.service';
import { AdminAlertsService } from './admin-alerts.service';
import { MailService } from './mail.service';

/**
 * The two buyer emails that are not triggered by anything the buyer does — the
 * review request that follows a delivery, and the reminder about a cart left
 * sitting.
 *
 * Both are deliberately conservative:
 *
 *   - They look at a **window**, not "everything older than X". Without an
 *     upper bound, the first run after deploy would email every buyer who
 *     ever received an order, which is how a legitimate sender becomes a spam
 *     sender in one afternoon.
 *   - They send **at most one** of each. The unique index behind
 *     BuyerEmailsService.claim() is what enforces that, not this file.
 *   - They process sequentially and cap each run. These are background jobs
 *     with all night to finish; nothing is gained by hammering the database
 *     or the SMTP quota in bursts.
 */
@Injectable()
export class LifecycleEmailsCron {
  private readonly logger = new Logger(LifecycleEmailsCron.name);

  /** Never send more than this per run, whatever the query returns. */
  private readonly BATCH_LIMIT = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly buyerEmails: BuyerEmailsService,
    private readonly mail: MailService,
    private readonly adminAlerts: AdminAlertsService,
  ) {}

  // ── Review requests ────────────────────────────────────────

  /** Days after delivery to ask. Long enough to have opened the box. */
  private get reviewDelayDays(): number {
    return this.positiveInt(process.env.REVIEW_REQUEST_DELAY_DAYS, 3);
  }

  /** How far back to look. Anything older is left alone forever. */
  private get reviewWindowDays(): number {
    return this.positiveInt(process.env.REVIEW_REQUEST_WINDOW_DAYS, 10);
  }

  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async sendReviewRequests(): Promise<void> {
    if (!this.mail.isConfigured()) return;

    const now = Date.now();
    const newest = new Date(now - this.reviewDelayDays * 86_400_000);
    const oldest = new Date(now - this.reviewWindowDays * 86_400_000);

    // There is no deliveredAt column, so updatedAt stands in for it: an order
    // that reached DELIVERED is not written to again in normal operation, so
    // its updatedAt is effectively the delivery time. Being approximate is
    // fine here — the worst case is asking a day early or late.
    const orders = await this.prisma.order.findMany({
      where: {
        orderStatus: OrderStatus.DELIVERED,
        updatedAt: { lt: newest, gt: oldest },
      },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: this.BATCH_LIMIT,
    });

    if (orders.length === 0) return;

    let sent = 0;
    for (const order of orders) {
      // Never throws; already-asked orders are dropped inside.
      await this.buyerEmails.sendReviewRequest(order.id);
      sent += 1;
    }

    this.logger.log(`Review-request sweep considered ${sent} delivered order(s)`);
  }

  // ── Cart reminders ─────────────────────────────────────────

  /** Hours a cart must sit untouched before it counts as abandoned. */
  private get cartIdleHours(): number {
    return this.positiveInt(process.env.CART_REMINDER_IDLE_HOURS, 6);
  }

  /** How far back to look. A cart older than this is left alone. */
  private get cartWindowHours(): number {
    return this.positiveInt(process.env.CART_REMINDER_WINDOW_HOURS, 72);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sendCartReminders(): Promise<void> {
    if (!this.mail.isConfigured()) return;

    const now = Date.now();
    const newest = new Date(now - this.cartIdleHours * 3_600_000);
    const oldest = new Date(now - this.cartWindowHours * 3_600_000);

    // A cart that was checked out is emptied by checkout(), so `some: {}`
    // already excludes everyone who completed an order — no separate "did
    // they buy since" check is needed.
    const carts = await this.prisma.cart.findMany({
      where: {
        updatedAt: { lt: newest, gt: oldest },
        items: { some: {} },
      },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
      take: this.BATCH_LIMIT,
    });

    if (carts.length === 0) return;

    for (const cart of carts) {
      // updatedAt is part of the dedupe key: a buyer who changes their cart
      // and abandons it again is reachable a second time, while a cart nobody
      // has touched only ever earns one reminder.
      await this.buyerEmails.sendCartReminder(cart.id, cart.updatedAt);
    }

    this.logger.log(`Cart-reminder sweep considered ${carts.length} cart(s)`);
  }

  // ── Dispatched with no tracking ────────────────────────────

  /** How long after "dispatched" a missing courier link counts as stuck. */
  private get noTrackingAfterHours(): number {
    return this.positiveInt(process.env.NO_TRACKING_ALERT_HOURS, 12);
  }

  /**
   * Finds orders a seller marked dispatched that still have no way for the
   * buyer to follow them, and reports them as one digest.
   *
   * Twice a day rather than hourly: this is a chase-the-seller job, and
   * nothing about it improves by arriving in the inbox twelve times.
   */
  @Cron(CronExpression.EVERY_12_HOURS)
  async alertOnUntrackedDispatches(): Promise<void> {
    if (!this.mail.isConfigured()) return;

    const cutoff = new Date(Date.now() - this.noTrackingAfterHours * 3_600_000);

    const orders = await this.prisma.order.findMany({
      where: {
        orderStatus: {
          in: [
            OrderStatus.DISPATCHED_FROM_SELLER,
            OrderStatus.SHIPPED,
            OrderStatus.OUT_FOR_DELIVERY,
          ],
        },
        // Either channel counts as trackable: Shiprocket writes awbCode, a
        // self-ship seller pastes trackingUrl. Missing both is the problem.
        awbCode: null,
        OR: [{ trackingUrl: null }, { trackingUrl: '' }],
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        updatedAt: true,
        items: { take: 1, select: { seller: { select: { companyName: true } } } },
      },
      orderBy: { updatedAt: 'asc' },
      take: this.BATCH_LIMIT,
    });

    if (orders.length === 0) return;

    const now = Date.now();
    await this.adminAlerts.noTrackingDigest(
      orders.map((order) => ({
        id: order.id,
        hours: Math.round((now - order.updatedAt.getTime()) / 3_600_000),
        sellerName: order.items[0]?.seller?.companyName ?? 'Unknown seller',
      })),
    );

    this.logger.log(`Untracked-dispatch sweep found ${orders.length} order(s)`);
  }

  private positiveInt(raw: string | undefined, fallback: number): number {
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }
}
