import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { PaymentMethod, PaymentStatus, PaymentVerificationStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PaymentsService } from './payments.service';
import { VerifyRazorpayDto } from './dto/verify-razorpay.dto';

/**
 * Razorpay checkout.
 *
 * The buyer's order already exists by the time this runs; this covers taking the
 * money for it. Two steps, because that is how Razorpay works:
 *
 *   1. createOrder - we ask Razorpay for an order id and hand it to the browser.
 *   2. verifyPayment - the browser returns a signature, we check it here, and an
 *      unmodified signature is what marks the payment confirmed.
 *
 * The signature check is the whole security boundary. Everything the browser
 * sends after checkout is attacker-controlled, so nothing is trusted until the
 * HMAC computed with the key secret matches.
 */
@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private client: Razorpay | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
  ) {}

  private get keyId(): string | undefined {
    return this.configService.get<string>('RAZORPAY_KEY_ID');
  }

  private get keySecret(): string | undefined {
    return this.configService.get<string>('RAZORPAY_KEY_SECRET');
  }

  /** True when both keys are present, so callers can hide online payment cleanly. */
  isConfigured(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  private getClient(): Razorpay {
    if (!this.keyId || !this.keySecret) {
      this.logger.warn(
        'Razorpay was called but RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set',
      );
      throw new ServiceUnavailableException(
        'Online payment is not available right now.',
      );
    }
    if (!this.client) {
      this.client = new Razorpay({
        key_id: this.keyId,
        key_secret: this.keySecret,
      });
    }
    return this.client;
  }

  /**
   * Creates the Razorpay order for one of our orders and records a pending
   * payment against it.
   *
   * The amount comes from the order in our database, never from the client - a
   * caller-supplied amount would let a buyer pay one rupee for a large order.
   */
  async createOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        totalAmount: true,
        paymentStatus: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.buyerId !== userId) {
      throw new ForbiddenException('This order belongs to another account');
    }
    if (order.paymentStatus === PaymentStatus.SUCCESS) {
      throw new BadRequestException('This order has already been paid');
    }

    const amountInPaise = Math.round(Number(order.totalAmount) * 100);
    if (!Number.isFinite(amountInPaise) || amountInPaise <= 0) {
      throw new BadRequestException('This order has no amount to pay');
    }

    let razorpayOrder: { id: string };
    try {
      razorpayOrder = (await this.getClient().orders.create({
        amount: amountInPaise,
        currency: 'INR',
        // Our own id travels with the Razorpay order, so a payment can still be
        // traced back from their dashboard.
        receipt: order.id,
        notes: { orderId: order.id },
      })) as { id: string };
    } catch (err) {
      this.logger.error(
        `Razorpay refused to create an order for ${order.id}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      throw new ServiceUnavailableException(
        'Could not start the payment. Please try again.',
      );
    }

    // Recorded before the buyer pays, so a payment that completes always has a
    // row waiting for it even if they close the tab immediately afterwards.
    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        amount: order.totalAmount,
        // There is no ONLINE method in the PaymentMethod enum and the deploy
        // does not run migrations, so adding one would need a manual step on
        // the server. UPI is the closest existing value; the Razorpay ids in
        // referenceNumber are what actually identify the payment.
        method: PaymentMethod.UPI,
        referenceNumber: razorpayOrder.id,
        verificationStatus: PaymentVerificationStatus.PENDING,
      },
    });

    return {
      razorpayOrderId: razorpayOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      keyId: this.keyId,
      orderId: order.id,
    };
  }

  /**
   * Confirms a payment, but only if the signature Razorpay gave the browser
   * verifies against our key secret.
   */
  async verifyPayment(userId: string, dto: VerifyRazorpayDto) {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = dto;

    const keySecret = this.keySecret;
    if (!keySecret) {
      throw new ServiceUnavailableException(
        'Online payment is not available right now.',
      );
    }

    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (!this.signaturesMatch(expected, razorpaySignature)) {
      this.logger.warn(
        `Rejected a Razorpay signature for ${razorpayOrderId}`,
      );
      throw new BadRequestException('This payment could not be verified.');
    }

    // The signature proves Razorpay issued the pair. This lookup is what ties it
    // to one of OUR orders - without it a valid signature from any other payment
    // could be replayed against someone else's order.
    const payment = await this.prisma.payment.findFirst({
      where: { referenceNumber: { startsWith: razorpayOrderId } },
      include: { order: { select: { buyerId: true } } },
    });

    if (!payment) {
      throw new NotFoundException('No payment is pending for this order');
    }
    if (payment.order.buyerId !== userId) {
      throw new ForbiddenException('This payment belongs to another account');
    }

    // Checkout can call this more than once for the same payment; saying "done"
    // is better than failing a payment that already went through.
    if (payment.verificationStatus === PaymentVerificationStatus.CONFIRMED) {
      return { alreadyConfirmed: true, paymentId: payment.id };
    }

    // Both ids kept, so the payment is traceable in the Razorpay dashboard and a
    // refund can be issued against it later.
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { referenceNumber: `${razorpayOrderId}|${razorpayPaymentId}` },
    });

    const result = await this.paymentsService.confirmPayment(payment.id);
    this.logger.log(
      `Confirmed Razorpay payment ${razorpayPaymentId} for order ${payment.orderId}`,
    );
    return result;
  }

  /** Constant-time compare, so a wrong signature cannot be narrowed down by timing. */
  private signaturesMatch(expected: string, received: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received || '', 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
}
