import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from './mail.service';
import { renderEmail } from './templates/email-layout';
import {
  paragraph,
  button,
  panel,
  productList,
  quote,
  type ProductLine,
} from './templates/email-blocks';
import { adminLink } from './templates/email-theme';

/**
 * Alerts to whoever is on the hook for running Yukizi.
 *
 * Every one of these exists because somebody would otherwise only find out by
 * looking — a ticket nobody answers for days, a parcel that never got tracking,
 * a seller waiting on a shipment somebody has to start.
 *
 * Recipient resolution is MailService.resolveAdminRecipient(): the Admin Alert
 * Email in platform settings first, then ADMIN_NOTIFICATION_EMAIL, then the
 * platform's own inbox. When none is configured these log once and stop, the
 * same as every other mail path.
 */

const KIND = {
  TICKET_RAISED: 'admin_ticket_raised',
  SHIPPING_DETAILS: 'admin_shipping_details',
  SELF_SHIP_TRACKING: 'admin_self_ship_tracking',
  NO_TRACKING: 'admin_no_tracking',
} as const;

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // 1. A customer is waiting
  // ────────────────────────────────────────────────────────────

  /**
   * A buyer or seller has opened a ticket.
   *
   * Nothing has ever announced these, so a ticket sat unread until somebody
   * happened to open the panel. The full first message is included on purpose
   * — most tickets can be triaged from the inbox without opening anything.
   */
  async ticketRaised(ticketId: string): Promise<void> {
    await this.guard('admin ticket-raised', async () => {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          subject: true,
          orderId: true,
          user: {
            select: {
              email: true,
              phone: true,
              role: true,
              buyerProfile: { select: { legalName: true } },
              sellerProfile: { select: { companyName: true } },
            },
          },
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { message: true },
          },
        },
      });
      if (!ticket) return;

      const to = await this.recipient(KIND.TICKET_RAISED, ticket.id);
      if (!to) return;
      if (!(await this.claim(KIND.TICKET_RAISED, ticket.id))) return;

      const ref = this.reference(ticket.id);
      const who =
        ticket.user?.sellerProfile?.companyName ||
        ticket.user?.buyerProfile?.legalName ||
        ticket.user?.email ||
        ticket.user?.phone ||
        'Unknown';
      const rows = [
        { label: 'Ticket', value: `#${ref}` },
        { label: 'From', value: `${who} (${ticket.user?.role ?? 'USER'})` },
      ];
      if (ticket.user?.email) rows.push({ label: 'Email', value: ticket.user.email });
      if (ticket.orderId) {
        rows.push({ label: 'About order', value: `#${this.reference(ticket.orderId)}` });
      }

      const html = renderEmail({
        audience: 'admin',
        preheader: `${who}: ${ticket.subject}`,
        eyebrow: 'New support ticket',
        title: ticket.subject,
        subtitle: `Raised by ${who}. Nobody has replied yet.`,
        blocks: [
          panel(rows, { tone: 'purple' }),
          ticket.messages[0]
            ? quote(this.trim(ticket.messages[0].message, 1500), 'What they said')
            : '',
          button('Open the ticket', adminLink(`/tickets/${ticket.id}`)),
          paragraph(
            'Replying from the panel emails them straight away, so they are not left checking the site.',
            { top: 20, size: 14 },
          ),
        ].filter(Boolean),
      });

      const text = [
        `New support ticket #${ref}`,
        '',
        `Subject: ${ticket.subject}`,
        `From: ${who} (${ticket.user?.role ?? 'USER'})`,
        ticket.user?.email ? `Email: ${ticket.user.email}` : '',
        ticket.orderId ? `About order: #${this.reference(ticket.orderId)}` : '',
        '',
        ticket.messages[0] ? this.trim(ticket.messages[0].message, 1500) : '',
        '',
        `Open it: ${adminLink(`/tickets/${ticket.id}`)}`,
      ]
        .filter((l) => l !== '')
        .join('\n');

      await this.deliver(
        to,
        `New ticket #${ref} — ${ticket.subject}`,
        text,
        html,
        KIND.TICKET_RAISED,
        ticket.id,
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // 2. A seller has given us what we need to ship
  // ────────────────────────────────────────────────────────────

  /**
   * A seller has submitted package dimensions and weight, which is what admin
   * needs before a shipment can be booked.
   *
   * This replaces a bare one-line email that said only that it had happened.
   * The numbers are in here now, so an obviously wrong 200kg figure can be
   * caught from the inbox rather than after a courier quote comes back.
   *
   * Deduped on the order, because a seller correcting a typo should not put
   * the same alert in the inbox twice — the panel always shows the current
   * values.
   */
  async shippingDetailsSubmitted(orderId: string, sellerId: string): Promise<void> {
    await this.guard('admin shipping-details', async () => {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          packageLength: true,
          packageBreadth: true,
          packageHeight: true,
          packageWeight: true,
          items: {
            where: { sellerId },
            select: {
              quantity: true,
              seller: { select: { companyName: true } },
              sellerOffer: { select: this.offerSelect() },
            },
          },
        },
      });
      if (!order) return;

      const to = await this.recipient(KIND.SHIPPING_DETAILS, orderId);
      if (!to) return;
      if (!(await this.claim(KIND.SHIPPING_DETAILS, `${orderId}:${sellerId}`))) return;

      const ref = this.reference(order.id);
      const company = order.items[0]?.seller?.companyName ?? 'A seller';
      const dims = [order.packageLength, order.packageBreadth, order.packageHeight];
      const dimText = dims.every((d) => d != null)
        ? `${dims.map((d) => this.num(d)).join(' × ')} cm`
        : 'Not given';

      const lines: ProductLine[] = order.items.map((item) => ({
        ...this.offerToProductLine(item.sellerOffer, order.id),
        meta: item.quantity > 1 ? `Qty ${item.quantity}` : undefined,
      }));

      const html = renderEmail({
        audience: 'admin',
        preheader: `${company} submitted package details for order ${ref} — ready to book.`,
        eyebrow: 'Ready to ship',
        title: 'Package details are in.',
        subtitle: `${company} has measured order #${ref}. It can be booked with the courier now.`,
        blocks: [
          panel(
            [
              { label: 'Order', value: `#${ref}` },
              { label: 'Seller', value: company },
              { label: 'Dimensions', value: dimText },
              {
                label: 'Weight',
                value: order.packageWeight != null ? `${this.num(order.packageWeight)} kg` : 'Not given',
              },
            ],
            { tone: 'green', title: 'What the seller entered' },
          ),
          productList(lines),
          button('Open the order', adminLink(`/orders/${order.id}`)),
          paragraph(
            'Worth a glance before booking — a mistyped weight is cheaper to catch here than in a courier invoice.',
            { top: 20, size: 14 },
          ),
        ],
      });

      const text = [
        `${company} has submitted package details for order #${ref}.`,
        '',
        `Dimensions: ${dimText}`,
        `Weight: ${order.packageWeight != null ? `${this.num(order.packageWeight)} kg` : 'Not given'}`,
        '',
        `Open the order: ${adminLink(`/orders/${order.id}`)}`,
      ].join('\n');

      await this.deliver(
        to,
        `Ready to ship — order #${ref} measured by ${company}`,
        text,
        html,
        KIND.SHIPPING_DETAILS,
        `${orderId}:${sellerId}`,
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // 3. A self-ship seller has posted tracking
  // ────────────────────────────────────────────────────────────

  /**
   * A self-shipping seller has entered (or corrected) their tracking link.
   *
   * Unlike the others this is NOT deduped on the order alone — a corrected
   * link is exactly the thing somebody needs to know about, so the key carries
   * the URL. Re-saving the same link stays silent.
   */
  async selfShipTracking(
    orderId: string,
    sellerId: string,
    trackingUrl: string,
    courierName?: string | null,
    isFirstSubmit = true,
  ): Promise<void> {
    await this.guard('admin self-ship tracking', async () => {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          items: {
            where: { sellerId },
            select: { seller: { select: { companyName: true } } },
          },
        },
      });
      if (!order) return;

      const to = await this.recipient(KIND.SELF_SHIP_TRACKING, orderId);
      if (!to) return;

      const key = `${orderId}:${sellerId}:${trackingUrl}`;
      if (!(await this.claim(KIND.SELF_SHIP_TRACKING, key))) return;

      const ref = this.reference(order.id);
      const company = order.items[0]?.seller?.companyName ?? 'A seller';
      const verb = isFirstSubmit ? 'added' : 'updated';

      const html = renderEmail({
        audience: 'admin',
        preheader: `${company} ${verb} tracking for self-ship order ${ref}.`,
        eyebrow: 'Self-ship tracking',
        title: `Tracking ${verb} for #${ref}.`,
        subtitle: `${company} is shipping this one themselves and has posted the courier link.`,
        blocks: [
          panel(
            [
              { label: 'Order', value: `#${ref}` },
              { label: 'Seller', value: company },
              { label: 'Courier', value: courierName?.trim() || 'Not given' },
            ],
            { tone: isFirstSubmit ? 'green' : 'orange' },
          ),
          button('Open the tracking link', trackingUrl),
          paragraph(
            isFirstSubmit
              ? 'The buyer has been emailed and texted the same link.'
              : 'This replaces a link the buyer was already given — worth checking it resolves before they try it.',
            { top: 20, size: 14 },
          ),
          button('Open the order', adminLink(`/orders/${order.id}`), { top: 18 }),
        ],
      });

      const text = [
        `${company} has ${verb} tracking for self-ship order #${ref}.`,
        '',
        `Courier: ${courierName?.trim() || 'Not given'}`,
        `Tracking: ${trackingUrl}`,
        '',
        `Open the order: ${adminLink(`/orders/${order.id}`)}`,
      ].join('\n');

      await this.deliver(
        to,
        `Self-ship tracking ${verb} for order #${ref}`,
        text,
        html,
        KIND.SELF_SHIP_TRACKING,
        key,
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // 4. Dispatched, but nobody can track it
  // ────────────────────────────────────────────────────────────

  /**
   * Orders a seller marked dispatched that still carry no tracking.
   *
   * Sent as one digest rather than one email per order: the useful question is
   * "what is stuck right now", and twelve separate emails answer it worse than
   * one list does. Deduped per order per day, so an order that stays stuck is
   * raised again tomorrow but not every hour.
   */
  async noTrackingDigest(
    stuck: { id: string; hours: number; sellerName: string }[],
  ): Promise<void> {
    await this.guard('admin no-tracking digest', async () => {
      if (stuck.length === 0) return;

      const to = await this.recipient(KIND.NO_TRACKING, 'digest');
      if (!to) return;

      // Claim each order for today; only report the ones we actually won.
      const fresh: typeof stuck = [];
      const day = new Date().toISOString().slice(0, 10);
      for (const order of stuck) {
        if (await this.claim(KIND.NO_TRACKING, `${order.id}:${day}`)) {
          fresh.push(order);
        }
      }
      if (fresh.length === 0) return;

      const rows = fresh
        .slice(0, 25)
        .map((o) => ({
          label: `#${this.reference(o.id)} — ${o.sellerName}`,
          value: `${o.hours}h ago`,
        }));

      const html = renderEmail({
        audience: 'admin',
        preheader: `${fresh.length} dispatched order${fresh.length === 1 ? '' : 's'} with no tracking.`,
        eyebrow: 'Needs chasing',
        title:
          fresh.length === 1
            ? 'An order was dispatched with no tracking.'
            : `${fresh.length} orders were dispatched with no tracking.`,
        subtitle:
          'The seller marked these as dispatched but never added a courier link, so the buyer has nothing to follow.',
        blocks: [
          panel(rows, { tone: 'orange', title: 'Dispatched, untracked' }),
          fresh.length > 25
            ? paragraph(
                `Showing the 25 oldest of ${fresh.length}. The rest are in the panel.`,
                { top: 16, size: 13 },
              )
            : '',
          button('Open orders', adminLink('/orders')),
          paragraph(
            'Each of these is a buyer who will email support asking where their parcel is. Chasing the seller now is cheaper than answering that later.',
            { top: 20, size: 14 },
          ),
        ].filter(Boolean),
        footerNote:
          'Each order is reported once a day until it has tracking, not on every sweep.',
      });

      const text = [
        `${fresh.length} dispatched order(s) have no tracking:`,
        '',
        ...fresh.slice(0, 25).map((o) => `  #${this.reference(o.id)} — ${o.sellerName} (${o.hours}h ago)`),
        '',
        `Open orders: ${adminLink('/orders')}`,
      ].join('\n');

      await this.deliver(
        to,
        fresh.length === 1
          ? 'An order was dispatched with no tracking'
          : `${fresh.length} orders dispatched with no tracking`,
        text,
        html,
        KIND.NO_TRACKING,
        `digest:${day}`,
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // Plumbing
  // ────────────────────────────────────────────────────────────

  /**
   * Resolves who gets platform alerts, logging clearly when nobody does — an
   * alert nobody receives is worse than no alert, because it looks covered.
   */
  private async recipient(kind: string, context: string): Promise<string | undefined> {
    const to = (await this.mail.resolveAdminRecipient())?.trim();
    if (!to) {
      this.logger.warn(
        `${kind} alert skipped (${context}): no Admin Alert Email in settings, and neither ADMIN_NOTIFICATION_EMAIL nor SMTP_USER is set`,
      );
      return undefined;
    }
    return to;
  }

  private async claim(kind: string, dedupeKey: string): Promise<boolean> {
    try {
      await this.prisma.emailDispatch.create({ data: { kind, dedupeKey } });
      return true;
    } catch (error: any) {
      if (error?.code !== UNIQUE_VIOLATION) {
        this.logger.warn(
          `Could not claim ${kind} for ${dedupeKey}: ${error?.message ?? error}`,
        );
      }
      return false;
    }
  }

  private async deliver(
    to: string,
    subject: string,
    text: string,
    html: string,
    kind: string,
    dedupeKey: string,
  ): Promise<void> {
    const result = await this.mail.sendMail({ to, subject, text, html });
    if (result.sent) return;

    if (result.retryable) {
      await this.release(kind, dedupeKey);
      this.logger.warn(`${kind} alert deferred for retry (${dedupeKey})`);
    } else {
      this.logger.warn(`${kind} alert could not be sent (${dedupeKey})`);
    }
  }

  private async release(kind: string, dedupeKey: string): Promise<void> {
    try {
      await this.prisma.emailDispatch.deleteMany({ where: { kind, dedupeKey } });
    } catch {
      // Keeping the claim costs one retry, nothing more.
    }
  }

  private async guard(label: string, work: () => Promise<void>): Promise<void> {
    if (!this.mail.isConfigured()) return;
    try {
      await work();
    } catch (error: any) {
      this.logger.error(`${label} alert failed: ${error?.message ?? error}`);
    }
  }

  private offerSelect() {
    return {
      id: true,
      name: true,
      catalogProduct: {
        select: {
          name: true,
          images: { orderBy: { order: 'asc' as const }, take: 1, select: { url: true } },
        },
      },
    } as const;
  }

  private offerToProductLine(offer: any, orderId: string): ProductLine {
    return {
      name: offer?.catalogProduct?.name || offer?.name || 'Item',
      imageUrl: offer?.catalogProduct?.images?.[0]?.url ?? null,
      url: adminLink(`/orders/${orderId}`),
    };
  }

  private reference(id: string): string {
    return id.slice(0, 8).toUpperCase();
  }

  /** Trims the trailing zeros off a measurement without losing precision. */
  private num(value: unknown): string {
    const n = Number(value);
    return Number.isFinite(n) ? String(Number(n.toFixed(2))) : '—';
  }

  private trim(value: string, max: number): string {
    const clean = String(value ?? '').trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  }
}
