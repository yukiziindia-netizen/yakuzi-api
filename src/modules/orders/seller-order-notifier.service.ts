import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

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

  async notifySellersOfNewOrder(
    pairs: { orderId: string; sellerId: string }[],
  ): Promise<void> {
    if (pairs.length === 0) return;

    const sellers = await this.prisma.sellerProfile.findMany({
      where: { id: { in: Array.from(new Set(pairs.map((p) => p.sellerId))) } },
      select: {
        id: true,
        userId: true,
        email: true,
        companyName: true,
        user: { select: { email: true } },
      },
    });
    const sellerById = new Map(sellers.map((s) => [s.id, s]));

    // Notify all sellers concurrently. Callers await this whole method before
    // the buyer/payment-confirmation caller gets a response, so a
    // multi-seller cart - the normal case, not an edge case - must not pay N
    // sequential rounds of DB writes and live SMTP sends. Promise.allSettled
    // means one seller's total failure can't stop the others being notified.
    await Promise.allSettled(
      pairs.map((pair) => this.notifyOneSeller(pair, sellerById)),
    );
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
    sellerById: Map<
      string,
      {
        id: string;
        userId: string;
        email: string | null;
        companyName: string;
        user: { email: string | null };
      }
    >,
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

    // SellerProfile.email is the business contact sellers fill in during
    // onboarding and can be blank (e.g. accounts created before it was a
    // required field); User.email is the separate login address shown in
    // their own dashboard, which is usually present. Fall back to it so a
    // seller with no business email on file still gets order emails.
    const to = seller.email?.trim() || seller.user?.email?.trim();
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
