import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from './mail.service';
import { renderEmail, escapeHtml } from './templates/email-layout';
import {
  paragraph,
  button,
  textLink,
  panel,
  productList,
  steps,
  quote,
  starRow,
  rupees,
  type ProductLine,
} from './templates/email-blocks';
import { link, SUPPORT_EMAIL } from './templates/email-theme';
import { signCartRestore } from '../orders/cart-restore.token';

/**
 * Every email Yukizi sends a buyer about their own life on the site, as
 * opposed to a single transaction.
 *
 * Three rules hold for every method here:
 *
 *   1. **Nothing throws.** These are called from order flows, signup and cron
 *      jobs. A buyer must never fail to sign up, and an order must never fail
 *      to cancel, because a mail server was slow.
 *   2. **Nothing sends twice.** Anything a cron can re-read claims a row in
 *      `email_dispatches` first, and that table has a unique index — so two
 *      overlapping runs cannot both decide they were first.
 *   3. **No email without an address.** Buyers can sign in with a phone
 *      number alone; those simply skip.
 */

/** Ledger keys. Changing a value re-sends to everyone — don't. */
const KIND = {
  WELCOME: 'welcome',
  PAYMENT_RECOVERY: 'payment_recovery',
  REFUND_ISSUED: 'refund_issued',
  TICKET_RECEIVED: 'ticket_received',
  TICKET_REPLY: 'ticket_reply',
  REVIEW_REQUEST: 'review_request',
  CART_REMINDER: 'cart_reminder',
} as const;

/** Prisma's code for "unique constraint violated" — i.e. somebody beat us to it. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class BuyerEmailsService {
  private readonly logger = new Logger(BuyerEmailsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // 1. Welcome
  // ────────────────────────────────────────────────────────────

  /**
   * First thing a new buyer hears from us. Called once, the moment the account
   * is created.
   */
  async sendWelcome(userId: string): Promise<void> {
    await this.guard('welcome', async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, buyerProfile: { select: { legalName: true } } },
      });
      if (!user?.email) return;
      if (!(await this.claim(KIND.WELCOME, user.id, user.id))) return;

      const firstName = this.firstName(user.buyerProfile?.legalName);
      const html = renderEmail({
        preheader: 'Your Yukizi account is ready — here is where to start.',
        eyebrow: 'Welcome',
        title: firstName ? `Welcome to Yukizi, ${firstName}.` : 'Welcome to Yukizi.',
        subtitle:
          'Figures, statues and collectibles from sellers across India — in one place, with one checkout.',
        blocks: [
          steps(
            [
              'Browse by series or character — One Piece, Naruto, Demon Slayer and more.',
              'Every listing shows the seller, the delivery estimate and the final price. No surprises at checkout.',
              'Track everything you buy from your Orders page, and tell us at any point if something looks wrong.',
            ],
            { title: 'How Yukizi works' },
          ),
          button('Start browsing', link('/')),
          textLink('See what is trending', link('/collections')),
          paragraph(
            `If you ever need us, reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#593696;font-weight:600;">${SUPPORT_EMAIL}</a>.`,
            { top: 24 },
          ),
        ],
      });

      const text = [
        firstName ? `Welcome to Yukizi, ${firstName}.` : 'Welcome to Yukizi.',
        '',
        'Figures, statues and collectibles from sellers across India, in one place.',
        '',
        '1. Browse by series or character.',
        '2. Every listing shows the seller, delivery estimate and final price.',
        '3. Track everything from your Orders page.',
        '',
        `Start browsing: ${link('/')}`,
        '',
        `Need us? ${SUPPORT_EMAIL}`,
        '',
        '— Team Yukizi',
      ].join('\n');

      await this.deliver(
        user.email,
        'Welcome to Yukizi',
        text,
        html,
        KIND.WELCOME,
        user.id,
        user.id,
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // 2. Payment didn't go through
  // ────────────────────────────────────────────────────────────

  /**
   * The buyer reached the payment screen and never came back.
   *
   * Sent instead of the plain "your order was cancelled" message, because the
   * two mean very different things to the reader: one is an ending, this is an
   * invitation. The button puts the same items back in their cart in one tap.
   *
   * Returns whether the buyer was actually reached. The sweep needs to know:
   * a buyer who signed up with only a phone number has no address for this,
   * and must still get the SMS the old cancellation notice sends.
   */
  async sendPaymentRecovery(orderId: string): Promise<boolean> {
    let sent = false;
    await this.guard('payment recovery', async () => {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          buyerId: true,
          totalAmount: true,
          buyer: { select: { email: true, buyerProfile: { select: { legalName: true } } } },
          items: { select: this.orderItemSelect() },
        },
      });
      if (!order?.buyer?.email) return;
      if (!(await this.claim(KIND.PAYMENT_RECOVERY, order.id, order.buyerId))) return;

      const items = order.items.map((item) => this.toProductLine(item));
      const restoreUrl = `${this.apiBase()}/orders/${order.id}/restore-cart?t=${encodeURIComponent(
        signCartRestore(order.id, order.buyerId),
      )}`;

      const html = renderEmail({
        preheader: 'Your payment did not complete — your items are still here.',
        eyebrow: 'Payment not completed',
        title: 'Your order did not go through.',
        subtitle:
          'The payment was never confirmed, so nothing has been charged and the order has been released. Your items are still waiting.',
        blocks: [
          productList(items),
          panel([{ label: 'Order total', value: rupees(Number(order.totalAmount)) }], {
            tone: 'orange',
          }),
          button('Put these back in my cart', restoreUrl),
          paragraph(
            'Stock moves quickly on popular figures, so the sooner you finish the better the chances everything is still available at this price.',
            { top: 22, size: 14 },
          ),
          paragraph(
            `If the payment failed at your bank's end and you think money <em>did</em> leave your account, tell us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#593696;font-weight:600;">${SUPPORT_EMAIL}</a> and we will trace it.`,
            { top: 14, size: 14 },
          ),
        ],
        footerNote:
          'Nothing was charged for this order. Any amount your bank shows as held will be released by them automatically.',
      });

      const text = [
        'Your Yukizi order did not go through.',
        '',
        'The payment was never confirmed, so nothing has been charged.',
        '',
        ...items.map((i) => `  ${i.name}${i.meta ? ` (${i.meta})` : ''}`),
        '',
        `Total: ${rupees(Number(order.totalAmount))}`,
        '',
        `Put these back in your cart: ${restoreUrl}`,
        '',
        `If you think money did leave your account, write to ${SUPPORT_EMAIL} and we will trace it.`,
        '',
        '— Team Yukizi',
      ].join('\n');

      sent = await this.deliver(
        order.buyer.email,
        'Your Yukizi order did not go through',
        text,
        html,
        KIND.PAYMENT_RECOVERY,
        order.id,
        order.buyerId,
      );
    });
    return sent;
  }

  // ────────────────────────────────────────────────────────────
  // 3. Refund issued
  // ────────────────────────────────────────────────────────────

  /**
   * The money has actually gone back. Sent when an admin records the refund,
   * not when the order is cancelled — the cancellation email promises it, this
   * one closes the loop.
   */
  async sendRefundIssued(orderId: string): Promise<void> {
    await this.guard('refund issued', async () => {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          buyerId: true,
          totalAmount: true,
          refundAmount: true,
          refundReference: true,
          refundNotes: true,
          refundedAt: true,
          buyer: { select: { email: true, buyerProfile: { select: { legalName: true } } } },
        },
      });
      if (!order?.buyer?.email || !order.refundedAt) return;
      if (!(await this.claim(KIND.REFUND_ISSUED, order.id, order.buyerId))) return;

      const shortId = this.reference(order.id);
      const amount = rupees(Number(order.refundAmount ?? order.totalAmount));
      const rows = [
        { label: 'Order', value: `#${shortId}` },
        { label: 'Amount refunded', value: amount },
      ];
      if (order.refundReference) {
        rows.push({ label: 'Reference', value: order.refundReference });
      }

      const html = renderEmail({
        preheader: `${amount} is on its way back to you for order #${shortId}.`,
        eyebrow: 'Refund issued',
        title: `${amount} is on its way back.`,
        subtitle: `We have refunded order #${shortId} to the method you paid with.`,
        blocks: [
          panel(rows, { tone: 'green', title: 'Refund details' }),
          paragraph(
            'Banks usually take <strong>3–7 working days</strong> to show a refund on your statement. If it has not appeared after that, send us the reference above and we will chase it with the payment provider ourselves.',
            { top: 22 },
          ),
          order.refundNotes
            ? paragraph(`<span style="color:#64748b;">Note from our team:</span> ${escapeHtml(order.refundNotes)}`, {
                top: 16,
                size: 14,
              })
            : '',
          button('View this order', link('/orders')),
        ].filter(Boolean),
        footerNote:
          'This refund was sent to the original payment method. We cannot redirect a refund to a different account.',
      });

      const text = [
        `${amount} is on its way back to you.`,
        '',
        `We have refunded order #${shortId} to the method you paid with.`,
        order.refundReference ? `Reference: ${order.refundReference}` : '',
        '',
        'Banks usually take 3-7 working days to show a refund on your statement.',
        order.refundNotes ? `\nNote from our team: ${order.refundNotes}` : '',
        '',
        `Your orders: ${link('/orders')}`,
        '',
        '— Team Yukizi',
      ]
        .filter((line) => line !== '')
        .join('\n');

      await this.deliver(
        order.buyer.email,
        `Refund issued for your Yukizi order #${shortId}`,
        text,
        html,
        KIND.REFUND_ISSUED,
        order.id,
        order.buyerId,
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // 4. Support ticket received
  // ────────────────────────────────────────────────────────────

  /** Acknowledges a ticket the moment it is raised, so nobody wonders. */
  async sendTicketReceived(ticketId: string): Promise<void> {
    await this.guard('ticket acknowledgement', async () => {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true,
          subject: true,
          userId: true,
          createdAt: true,
          user: { select: { email: true, buyerProfile: { select: { legalName: true } } } },
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { message: true },
          },
        },
      });
      if (!ticket?.user?.email) return;
      if (!(await this.claim(KIND.TICKET_RECEIVED, ticket.id, ticket.userId))) return;

      const ref = this.reference(ticket.id);
      const firstName = this.firstName(ticket.user.buyerProfile?.legalName);
      const opening = ticket.messages[0]?.message;

      const html = renderEmail({
        preheader: `We have your message — ticket #${ref}. Someone will reply shortly.`,
        eyebrow: 'Support',
        title: 'We have your message.',
        subtitle: firstName
          ? `Thanks ${firstName} — a real person is looking at this, not a bot.`
          : 'A real person is looking at this, not a bot.',
        blocks: [
          panel(
            [
              { label: 'Ticket', value: `#${ref}` },
              { label: 'Subject', value: ticket.subject },
            ],
            { tone: 'purple' },
          ),
          opening ? quote(this.trim(opening, 600), 'What you told us') : '',
          steps(
            [
              'Our support team reads every ticket in the order it arrives.',
              'You will get an email the moment someone replies — no need to keep checking.',
              'Reply from your ticket page and the whole conversation stays in one place.',
            ],
            { title: 'What happens now' },
          ),
          button('Open your ticket', link(`/support/${ticket.id}`)),
        ].filter(Boolean),
      });

      const text = [
        'We have your message.',
        '',
        `Ticket: #${ref}`,
        `Subject: ${ticket.subject}`,
        '',
        'Our support team reads every ticket in the order it arrives, and you will',
        'get an email the moment someone replies.',
        '',
        `Open your ticket: ${link(`/support/${ticket.id}`)}`,
        '',
        '— Team Yukizi',
      ].join('\n');

      await this.deliver(
        ticket.user.email,
        `We have your message — ticket #${ref}`,
        text,
        html,
        KIND.TICKET_RECEIVED,
        ticket.id,
        ticket.userId,
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // 5. Support ticket reply
  // ────────────────────────────────────────────────────────────

  /**
   * Somebody from the team answered. Deduped on the message id, so one reply
   * is one email however many times this is called.
   */
  async sendTicketReply(ticketId: string, messageId: string): Promise<void> {
    await this.guard('ticket reply', async () => {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          message: true,
          senderId: true,
          sender: { select: { role: true, adminProfile: { select: { displayName: true } } } },
          ticket: {
            select: {
              id: true,
              subject: true,
              userId: true,
              user: { select: { email: true, buyerProfile: { select: { legalName: true } } } },
            },
          },
        },
      });
      if (!message?.ticket?.user?.email) return;
      // Never email someone their own message back.
      if (message.senderId === message.ticket.userId) return;
      if (!(await this.claim(KIND.TICKET_REPLY, message.id, message.ticket.userId))) {
        return;
      }

      const ref = this.reference(message.ticket.id);
      const who = message.sender?.adminProfile?.displayName?.trim() || 'Yukizi Support';

      const html = renderEmail({
        preheader: `${who} replied to your ticket #${ref}.`,
        eyebrow: 'Support reply',
        title: 'Someone has replied.',
        subtitle: `On your ticket #${ref} — ${message.ticket.subject}`,
        blocks: [
          quote(this.trim(message.message, 1500), `${who}, Yukizi Support`),
          button('Reply to this', link(`/support/${message.ticket.id}`)),
          paragraph(
            'Replying on your ticket page keeps the whole conversation together, which means whoever picks it up next already has the context.',
            { top: 20, size: 14 },
          ),
        ],
      });

      const text = [
        `${who} replied to your ticket #${ref}.`,
        '',
        `Subject: ${message.ticket.subject}`,
        '',
        this.trim(message.message, 1500),
        '',
        `Reply here: ${link(`/support/${message.ticket.id}`)}`,
        '',
        '— Team Yukizi',
      ].join('\n');

      await this.deliver(
        message.ticket.user.email,
        `Re: ${message.ticket.subject} — ticket #${ref}`,
        text,
        html,
        KIND.TICKET_REPLY,
        message.id,
        message.ticket.userId,
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // 6. Review request
  // ────────────────────────────────────────────────────────────

  /**
   * Asks how the order went, a few days after it landed.
   *
   * Only products the buyer has not already reviewed are listed — nobody
   * should be asked twice for something they have already written about.
   */
  async sendReviewRequest(orderId: string): Promise<void> {
    await this.guard('review request', async () => {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          buyerId: true,
          buyer: { select: { email: true, buyerProfile: { select: { legalName: true } } } },
          items: { select: this.orderItemSelect() },
        },
      });
      if (!order?.buyer?.email) return;

      const reviewed = await this.prisma.review.findMany({
        where: { userId: order.buyerId },
        select: { catalogProductId: true },
      });
      const alreadyReviewed = new Set(reviewed.map((r) => r.catalogProductId));

      const pending = order.items.filter((item) => {
        const catalogId = item.sellerOffer?.catalogProduct?.id;
        return !catalogId || !alreadyReviewed.has(catalogId);
      });
      // Everything in this order has already been reviewed — say nothing.
      if (pending.length === 0) return;

      if (!(await this.claim(KIND.REVIEW_REQUEST, order.id, order.buyerId))) return;

      // No price and no quantity here — this email is not about the money,
      // and the prompt does more work in that space than a number would.
      const items = pending.map((item) => ({
        ...this.toProductLine(item, { withPrice: false }),
        meta: 'Tap to write a review',
      }));
      const firstName = this.firstName(order.buyer.buyerProfile?.legalName);

      const html = renderEmail({
        preheader: 'How was it? A line or two helps the next collector decide.',
        eyebrow: 'Your order',
        title: firstName ? `How was it, ${firstName}?` : 'How was it?',
        subtitle:
          'Your order landed a few days ago. If you have a minute, tell other collectors what you thought.',
        blocks: [
          starRow(),
          productList(items, { top: 18 }),
          paragraph(
            'Honest reviews are the single most useful thing on a product page — the sculpt, the paint, the box, whether it matched the photos. Two lines is plenty.',
            { top: 20 },
          ),
          button(
            items.length === 1 ? 'Review this' : 'Review your order',
            items[0]?.url ?? link('/orders'),
            { tone: 'orange' },
          ),
          paragraph(
            'If something was not right, please do not write a review — <strong>tell us instead</strong> and we will actually fix it.',
            { top: 20, size: 14 },
          ),
          textLink('Raise it with support', link('/support')),
        ],
        footerNote:
          'We only ask once per order, and never for anything you have already reviewed.',
      });

      const text = [
        firstName ? `How was it, ${firstName}?` : 'How was it?',
        '',
        'Your order landed a few days ago. If you have a minute, tell other',
        'collectors what you thought:',
        '',
        ...items.map((i) => `  ${i.name}\n    ${i.url}`),
        '',
        'If something was not right, please tell us instead and we will fix it:',
        link('/support'),
        '',
        '— Team Yukizi',
      ].join('\n');

      await this.deliver(
        order.buyer.email,
        'How was your Yukizi order?',
        text,
        html,
        KIND.REVIEW_REQUEST,
        order.id,
        order.buyerId,
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // 7. Cart reminder
  // ────────────────────────────────────────────────────────────

  /**
   * Items left in a cart, hours later.
   *
   * The dedupe key carries the cart's last-touched timestamp, so a buyer who
   * abandons, comes back, adds something and abandons again is reachable a
   * second time — but sitting on an untouched cart only ever earns one email.
   */
  async sendCartReminder(cartId: string, touchedAt: Date): Promise<void> {
    await this.guard('cart reminder', async () => {
      const cart = await this.prisma.cart.findUnique({
        where: { id: cartId },
        select: {
          id: true,
          userId: true,
          user: { select: { email: true, buyerProfile: { select: { legalName: true } } } },
          items: {
            select: {
              quantity: true,
              unitPrice: true,
              sellerOffer: { select: this.offerSelect() },
            },
          },
        },
      });
      if (!cart?.user?.email || cart.items.length === 0) return;

      const key = `${cart.id}:${touchedAt.toISOString()}`;
      if (!(await this.claim(KIND.CART_REMINDER, key, cart.userId))) return;

      const items: ProductLine[] = cart.items.map((item) => ({
        ...this.offerToProductLine(item.sellerOffer),
        meta: item.quantity > 1 ? `Qty ${item.quantity}` : undefined,
        amount: rupees(Number(item.unitPrice) * item.quantity),
      }));
      const total = cart.items.reduce(
        (sum, i) => sum + Number(i.unitPrice) * i.quantity,
        0,
      );

      const html = renderEmail({
        preheader: 'Your cart is still here — and so is everything in it.',
        eyebrow: 'Still in your cart',
        title: 'You left something behind.',
        subtitle:
          'Everything below is still in your Yukizi cart. We have not touched it.',
        blocks: [
          productList(items),
          panel([{ label: 'Cart total', value: rupees(total) }], { tone: 'purple' }),
          button('Finish checking out', link('/checkout')),
          paragraph(
            'Collectibles are stocked in small numbers by individual sellers, so a piece that is available today genuinely may not be next week.',
            { top: 22, size: 14 },
          ),
        ],
        footerNote:
          'We will only send one reminder for this cart. Change what is in it and we will leave you alone again.',
      });

      const text = [
        'You left something behind.',
        '',
        'Everything below is still in your Yukizi cart:',
        '',
        ...items.map((i) => `  ${i.name}${i.meta ? ` (${i.meta})` : ''} — ${i.amount ?? ''}`),
        '',
        `Cart total: ${rupees(total)}`,
        '',
        `Finish checking out: ${link('/checkout')}`,
        '',
        '— Team Yukizi',
      ].join('\n');

      await this.deliver(
        cart.user.email,
        'You left something in your Yukizi cart',
        text,
        html,
        KIND.CART_REMINDER,
        key,
        cart.userId,
      );
    });
  }

  // ────────────────────────────────────────────────────────────
  // Plumbing
  // ────────────────────────────────────────────────────────────

  /**
   * Claims the right to send. Returns false if somebody already has.
   *
   * The unique index on (kind, dedupeKey) is what makes this safe against two
   * cron runs overlapping: one insert wins, the other gets P2002 and backs
   * off. Any other database error is treated as "do not send" — a missed email
   * is a far smaller problem than a duplicate one.
   */
  private async claim(kind: string, dedupeKey: string, userId?: string): Promise<boolean> {
    try {
      await this.prisma.emailDispatch.create({ data: { kind, dedupeKey, userId } });
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

  /**
   * Hands the message over, and gives the claim back if it is worth retrying.
   *
   * A transient SMTP failure should not cost the buyer the email permanently —
   * releasing the claim lets the next cron run pick it up. A permanent failure
   * (bad address, message rejected) keeps the claim, because retrying that
   * only burns the sending quota.
   */
  private async deliver(
    to: string,
    subject: string,
    text: string,
    html: string,
    kind: string,
    /** Must be the exact key claim() was called with, or the release misses. */
    dedupeKey: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.mail.sendMail({ to, subject, text, html });
    if (result.sent) return true;

    if (result.retryable) {
      await this.release(kind, dedupeKey);
      this.logger.warn(`${kind} email deferred for retry (user ${userId})`);
    } else {
      this.logger.warn(`${kind} email could not be sent (user ${userId})`);
    }
    return false;
  }

  private async release(kind: string, dedupeKey: string): Promise<void> {
    try {
      await this.prisma.emailDispatch.deleteMany({ where: { kind, dedupeKey } });
    } catch {
      // Keeping the claim just means this one email is not retried. Harmless.
    }
  }

  /**
   * Runs a send and swallows whatever it throws.
   *
   * Every caller of this service is doing something more important than
   * sending an email — creating an account, cancelling an order, closing a
   * ticket. None of them may fail because of what happens in here.
   */
  private async guard(label: string, work: () => Promise<void>): Promise<void> {
    // Checked before anything claims a ledger row. On an install with no SMTP
    // configured, claiming first would burn the one-and-only send for every
    // buyer against a message that never left — and they would never get it
    // once the mailbox was finally set up.
    if (!this.mail.isConfigured()) return;

    try {
      await work();
    } catch (error: any) {
      this.logger.error(`${label} email failed: ${error?.message ?? error}`);
    }
  }

  // ── Shaping ──

  private orderItemSelect() {
    return {
      quantity: true,
      unitPrice: true,
      totalPrice: true,
      sellerOffer: { select: this.offerSelect() },
    } as const;
  }

  private offerSelect() {
    return {
      id: true,
      name: true,
      slug: true,
      catalogProduct: {
        select: {
          id: true,
          name: true,
          slug: true,
          images: { orderBy: { order: 'asc' as const }, take: 1, select: { url: true } },
        },
      },
    } as const;
  }

  private toProductLine(
    item: {
      quantity: number;
      unitPrice: any;
      totalPrice?: any;
      sellerOffer: any;
    },
    opts: { withPrice?: boolean } = {},
  ): ProductLine {
    const { withPrice = true } = opts;
    const base = this.offerToProductLine(item.sellerOffer);
    return {
      ...base,
      meta: item.quantity > 1 ? `Qty ${item.quantity}` : undefined,
      amount: withPrice
        ? rupees(Number(item.totalPrice ?? Number(item.unitPrice) * item.quantity))
        : undefined,
    };
  }

  private offerToProductLine(offer: any): ProductLine {
    const catalog = offer?.catalogProduct;
    const name = catalog?.name || offer?.name || 'Your item';
    return {
      name,
      imageUrl: catalog?.images?.[0]?.url ?? null,
      url: link(`/products/${this.productSlug(name, catalog?.id ?? offer?.id, catalog?.slug ?? offer?.slug)}`),
    };
  }

  /**
   * Mirrors generateProductSlug in packages/utils — a product with a real slug
   * uses it, everything else falls back to the name-and-id form. Both resolve
   * on the storefront; keeping them in step just keeps the URLs clean.
   */
  private productSlug(name: string, id?: string | null, slug?: string | null): string {
    if (slug) return slug;
    if (!name) return id ?? '';
    const slugified = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    return id ? `${slugified}-${id}` : slugified;
  }

  /** The 8-character reference buyers and support both quote. */
  private reference(id: string): string {
    return id.slice(0, 8).toUpperCase();
  }

  private firstName(name?: string | null): string {
    return (name ?? '').trim().split(/\s+/)[0] ?? '';
  }

  private trim(value: string, max: number): string {
    const clean = String(value ?? '').trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  }

  /**
   * Where the API itself answers, for the one link that has to hit an endpoint
   * rather than a page. Same variable and same default as the integrations
   * OAuth callbacks use, and like those it already includes the /api prefix.
   */
  private apiBase(): string {
    return (
      process.env.API_PUBLIC_URL?.trim().replace(/\/$/, '') || 'https://yukizi.com/api'
    );
  }
}
