import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

type SellerContact = {
  id: string;
  userId: string;
  email: string | null;
  companyName: string;
  user: { email: string | null };
};

/**
 * Tells sellers about a new order - the in-app bell and, when they have an
 * address on file, an email.
 *
 * Split out of OrdersService so PaymentsService can also call it: a
 * Razorpay-intent order defers this until payment is confirmed (see
 * Order.sellersNotifiedAt), and that confirmation can come from
 * PaymentsService.confirmPayment() via the browser, the webhook, or an
 * admin's manual confirm - none of which is OrdersService's job to know
 * about.
 */
@Injectable()
export class SellerOrderNotifierService {
  private readonly logger = new Logger(SellerOrderNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async findSellerContacts(
    sellerIds: string[],
  ): Promise<Map<string, SellerContact>> {
    const sellers = await this.prisma.sellerProfile.findMany({
      where: { id: { in: Array.from(new Set(sellerIds)) } },
      select: {
        id: true,
        userId: true,
        email: true,
        companyName: true,
        user: { select: { email: true } },
      },
    });
    return new Map(sellers.map((s) => [s.id, s]));
  }

  /**
   * SellerProfile.email is the business contact sellers fill in during
   * onboarding and can be blank (e.g. accounts created before it was a
   * required field); User.email is the separate login address shown in
   * their own dashboard, which is usually present. Fall back to it so a
   * seller with no business email on file still gets order emails.
   */
  private resolveSellerEmail(seller: SellerContact): string | undefined {
    return seller.email?.trim() || seller.user?.email?.trim() || undefined;
  }

  async notifySellersOfNewOrder(
    pairs: { orderId: string; sellerId: string }[],
  ): Promise<void> {
    if (pairs.length === 0) return;

    const sellerById = await this.findSellerContacts(
      pairs.map((p) => p.sellerId),
    );

    // Notify all sellers concurrently. Callers await this whole method before
    // the buyer/payment-confirmation caller gets a response, so a
    // multi-seller cart - the normal case, not an edge case - must not pay N
    // sequential rounds of DB writes and live SMTP sends. Promise.allSettled
    // means one seller's total failure can't stop the others being notified.
    await Promise.allSettled(
      pairs.map((pair) => this.notifyOneSeller(pair, sellerById)),
    );

    // Admin copy of the same event. This method is the single convergence
    // point for "a real order exists": checkout calls it immediately for
    // COD/bank/credit, and PaymentsService calls it for Razorpay-intent
    // orders only after payment succeeds (sellersNotifiedAt claim) — so the
    // admin gets exactly one email per real order and none for abandoned
    // Razorpay checkouts. Best-effort like everything else here.
    await this.emailAdminNewOrder([...new Set(pairs.map((p) => p.orderId))]);
  }

  /**
   * One email per notifySellersOfNewOrder call, covering every order in the
   * group (a multi-seller checkout creates one Order per seller in the same
   * instant — the admin wants one email about the purchase, not N).
   * Never throws: an admin-email failure must not affect order flow.
   */
  private async emailAdminNewOrder(orderIds: string[]): Promise<void> {
    if (orderIds.length === 0) return;
    const to =
      process.env.ADMIN_NOTIFICATION_EMAIL?.trim() ||
      process.env.SMTP_USER?.trim();
    if (!to) {
      this.logger.warn(
        `new-order admin email skipped: neither ADMIN_NOTIFICATION_EMAIL nor SMTP_USER is set (orders ${orderIds.join(', ')})`,
      );
      return;
    }
    try {
      const orders = await this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          totalAmount: true,
          buyer: { select: { username: true, phone: true } },
        },
      });
      if (orders.length === 0) return;
      const buyer = orders[0].buyer;
      const buyerLabel = buyer?.username?.trim() || buyer?.phone || 'a buyer';
      const lines = orders.map(
        (o) => `#${o.id.slice(0, 8).toUpperCase()} — ₹${String(o.totalAmount)}`,
      );
      const adminAppUrl =
        process.env.ADMIN_APP_URL?.trim() || 'https://admin.yukizi.com';
      const result = await this.mailService.sendMail({
        to,
        subject: `New order${orders.length > 1 ? 's' : ''} from ${buyerLabel}: ${lines.join(', ')}`,
        text: `A new order has been placed on Yukizi.\n\nBuyer: ${buyerLabel}\n${lines.join('\n')}\n\nReview: ${adminAppUrl}/orders`,
        html: `<p>A new order has been placed on Yukizi.</p><p>Buyer: <strong>${this.escapeHtml(buyerLabel)}</strong></p><p>${lines.map((l) => this.escapeHtml(l)).join('<br/>')}</p><p><a href="${adminAppUrl}/orders">Review orders</a></p>`,
      });
      if (!result.sent) {
        this.logger.warn(
          `new-order admin email not sent (retryable=${result.retryable}) for orders ${orderIds.join(', ')}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `new-order admin email failed for orders ${orderIds.join(', ')}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Per-seller body of {@link notifySellersOfNewOrder}, split out so the
   * caller can fan these out concurrently with Promise.allSettled. Each
   * failure path here (missing seller row, in-app notification write,
   * mail-send result) is logged and swallowed on its own - nothing here may
   * throw out to the caller.
   */
  private async notifyOneSeller(
    { orderId, sellerId }: { orderId: string; sellerId: string },
    sellerById: Map<string, SellerContact>,
  ): Promise<void> {
    const seller = sellerById.get(sellerId);
    if (!seller) {
      this.logger.warn(
        `Could not find seller profile ${sellerId} while notifying about order ${orderId}`,
      );
      return;
    }

    await this.notificationsService
      .notifySellerNewOrder(seller.userId, orderId)
      .catch((err) => {
        this.logger.warn(
          `Could not create the in-app new-order notification for seller ${seller.userId}: ${
            err instanceof Error ? err.message : 'Unknown error'
          }`,
        );
      });

    const to = this.resolveSellerEmail(seller);
    if (!to) {
      this.logger.warn(
        `new-order-email skipped: seller ${seller.userId} has no email on file (order ${orderId})`,
      );
      return;
    }

    const orderRef = orderId.slice(0, 8).toUpperCase();
    const safeCompanyName = this.escape(seller.companyName);
    const result = await this.mailService.sendMail({
      to,
      subject: `New Yukizi order ${orderRef}`,
      text: `Hello ${seller.companyName},\n\nYou have a new order (${orderRef}) to process. Log in to your seller dashboard to view and accept it.\n\nYukizi`,
      html: `<p>Hello ${safeCompanyName},</p><p>You have a new order (<strong>${orderRef}</strong>) to process. Log in to your seller dashboard to view and accept it.</p><p>Yukizi</p>`,
    });
    if (!result.sent) {
      this.logger.warn(
        `Could not email seller ${seller.userId} about new order ${orderId} (retryable=${result.retryable})`,
      );
    }
  }

  /**
   * Tells sellers their admin-prepared shipping documents (label, invoice,
   * manifest) are ready to download. Fire only when the admin actually
   * uploaded a document — see OrdersService.updateAdminShippingDocs, which
   * also calls this for lock-only updates with no doc URLs and must filter
   * those out before calling here.
   */
  async notifySellersDocsReady(
    pairs: { orderId: string; sellerId: string }[],
  ): Promise<void> {
    if (pairs.length === 0) return;

    const sellerById = await this.findSellerContacts(
      pairs.map((p) => p.sellerId),
    );

    await Promise.allSettled(
      pairs.map((pair) => this.notifyOneSellerDocsReady(pair, sellerById)),
    );
  }

  private async notifyOneSellerDocsReady(
    { orderId, sellerId }: { orderId: string; sellerId: string },
    sellerById: Map<string, SellerContact>,
  ): Promise<void> {
    const seller = sellerById.get(sellerId);
    if (!seller) {
      this.logger.warn(
        `Could not find seller profile ${sellerId} while notifying about ready shipping docs for order ${orderId}`,
      );
      return;
    }

    const to = this.resolveSellerEmail(seller);
    if (!to) {
      this.logger.warn(
        `shipping-docs-ready email skipped: seller ${seller.userId} has no email on file (order ${orderId})`,
      );
      return;
    }

    const orderRef = orderId.slice(0, 8).toUpperCase();
    const safeCompanyName = this.escape(seller.companyName);
    const result = await this.mailService.sendMail({
      to,
      subject: `Shipping documents ready for order ${orderRef}`,
      text: `Hello ${seller.companyName},\n\nThe shipping label and other documents for order ${orderRef} are ready. Log in to your seller dashboard to download them.\n\nYukizi`,
      html: `<p>Hello ${safeCompanyName},</p><p>The shipping label and other documents for order <strong>${orderRef}</strong> are ready. Log in to your seller dashboard to download them.</p><p>Yukizi</p>`,
    });
    if (!result.sent) {
      this.logger.warn(
        `Could not email seller ${seller.userId} about ready shipping docs for order ${orderId} (retryable=${result.retryable})`,
      );
    }
  }

  /**
   * Escapes text for safe interpolation into an HTML email body. Same
   * approach as InvoiceEmailService.escape() - company names and buyer
   * names are free text and must not be spliced into HTML unescaped.
   */
  private escape(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
