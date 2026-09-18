import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentStatus, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { OrdersService } from './orders.service';
import { BuyerEmailsService } from '../mail/buyer-emails.service';

const DEFAULT_TIMEOUT_MINUTES = 30;

/**
 * Cancels Razorpay-intent orders (Order.sellersNotifiedAt still null - see
 * CreateOrderDto.deferSellerNotification) that never got paid within the
 * timeout window, restoring their stock.
 *
 * checkout() creates the order (and reserves stock) before the Razorpay
 * popup even opens, so a buyer who never completes payment - however they
 * leave: closing the popup, the browser/phone back button, closing the tab,
 * the app crashing - leaves a real PLACED order behind with nothing to ever
 * clean it up. The checkout page's own auto-cancel-on-dismiss only catches
 * the "closed the popup" case; every other way of leaving skips that
 * client-side code entirely. This sweep is the backstop that catches all of
 * them, independent of how the buyer's browser exited.
 *
 * Deliberately does NOT touch orders placed via any other payment method
 * (COD/bank transfer/UPI/credit): those stamp sellersNotifiedAt immediately
 * at checkout (see checkout()'s dto.deferSellerNotification), so they never
 * match this query's sellersNotifiedAt: null filter and can legitimately
 * stay PLACED and unpaid for as long as it takes admin to confirm payment.
 *
 * Deliberately does NOT create the order any later than checkout() already
 * does (see PaymentsService.confirmPayment's reliance on the order already
 * existing for the Razorpay payment.captured webhook to reconcile against
 * even if the browser's own /verify call never lands) - this sweep only
 * ever cancels an order that a payment never actually completed for.
 */
@Injectable()
export class CheckoutAbandonmentSweepService {
  private readonly logger = new Logger(CheckoutAbandonmentSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly configService: ConfigService,
    private readonly buyerEmails: BuyerEmailsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron(): Promise<void> {
    await this.cancelAbandonedCheckouts();
  }

  private getTimeoutMinutes(): number {
    const configured = this.configService.get<string>(
      'CHECKOUT_ABANDONMENT_TIMEOUT_MINUTES',
    );
    const parsed = configured ? Number(configured) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_TIMEOUT_MINUTES;
  }

  async cancelAbandonedCheckouts(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.getTimeoutMinutes() * 60 * 1000,
    );

    const stale = await this.prisma.order.findMany({
      where: {
        sellersNotifiedAt: null,
        orderStatus: OrderStatus.PLACED,
        paymentStatus: { notIn: [PaymentStatus.SUCCESS, PaymentStatus.PARTIAL] },
        createdAt: { lt: cutoff },
      },
      select: { id: true, buyerId: true },
    });

    // Sequential, like ShiprocketSyncService's poller - this is a background
    // cleanup job, not a user-facing request, so there is no reason to race
    // N cancellations concurrently against the database.
    for (const order of stale) {
      try {
        // Email first, cancel second. The recovery email needs the order's
        // items to show what the buyer was buying, and reading them before
        // the cancellation avoids any question of racing the write that
        // releases the stock.
        const recovered = await this.buyerEmails.sendPaymentRecovery(order.id);

        // Suppress the standard cancellation notice only when the better one
        // actually reached them — two messages about one abandoned checkout is
        // one too many, but none at all is worse. A buyer who signed up with
        // just a phone number has no address for the recovery email, and still
        // gets the SMS the cancellation notice sends.
        await this.ordersService.cancelOrder(
          order.buyerId,
          order.id,
          Role.ADMIN,
          undefined,
          recovered ? 'none' : 'cancellation',
        );
        this.logger.log(`Cancelled abandoned unpaid checkout: order ${order.id}`);
      } catch (error: any) {
        this.logger.warn(
          `Failed to auto-cancel abandoned order ${order.id}: ${error?.message}`,
        );
      }
    }
  }
}
