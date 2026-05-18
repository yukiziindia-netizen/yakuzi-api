import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UploadProofDto } from './dto/upload-proof.dto';
import {
  PaymentStatus,
  PaymentVerificationStatus,
  OrderStatus,
} from '@prisma/client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly commissionRate: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.commissionRate = parseFloat(
      this.config.get<string>('PLATFORM_COMMISSION_RATE', '0.05'),
    );
  }

  // ──────────────────────────────────────────────
  // BUYER: Record a payment attempt
  // ──────────────────────────────────────────────

  async createPayment(userId: string, dto: CreatePaymentDto) {
    const { orderId, amount, method, referenceNumber } = dto;

    // 1. Verify order exists and belongs to buyer
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.buyerId !== userId) {
      throw new NotFoundException('Order not found');
    }

    // 2. Check if order is already fully paid
    if (order.paymentStatus === PaymentStatus.SUCCESS) {
      throw new BadRequestException('Order is already fully paid');
    }

    // 3. Compute remaining balance dynamically
    const confirmedTotal = await this.getConfirmedTotal(orderId);
    const remaining = order.totalAmount - confirmedTotal;

    if (remaining <= 0) {
      throw new BadRequestException('Order is already fully paid');
    }

    // 4. Validate amount does not exceed remaining
    if (amount > remaining) {
      throw new BadRequestException(
        `Amount exceeds remaining balance. Remaining: ₹${remaining.toFixed(2)}`,
      );
    }

    // 5. Create payment record
    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        amount,
        method,
        referenceNumber: referenceNumber || null,
        verificationStatus: PaymentVerificationStatus.PENDING,
      },
    });

    this.logger.log(
      `Payment recorded: ${payment.id} — ₹${amount} via ${method} for order ${orderId}`,
    );

    return payment;
  }

  // ──────────────────────────────────────────────
  // BUYER: Upload payment proof
  // ──────────────────────────────────────────────

  async uploadProof(userId: string, paymentId: string, dto: UploadProofDto) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: { select: { buyerId: true } } },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.order.buyerId !== userId) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.verificationStatus !== PaymentVerificationStatus.PENDING) {
      throw new BadRequestException(
        `Cannot upload proof for a ${payment.verificationStatus.toLowerCase()} payment`,
      );
    }

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { proofUrl: dto.proofUrl },
    });

    this.logger.log(`Proof uploaded for payment ${paymentId}`);
    return updated;
  }

  async uploadProofByOrder(userId: string, orderId: string, dto: UploadProofDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });

    if (!order || order.buyerId !== userId) {
      throw new NotFoundException('Order not found');
    }

    // Update existing pending payment or create new one
    let payment = order.payments.find(
      (p) => p.verificationStatus === PaymentVerificationStatus.PENDING,
    );

    if (payment) {
      payment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: { proofUrl: dto.proofUrl },
      });
    } else {
      payment = await this.prisma.payment.create({
        data: {
          orderId,
          amount: order.totalAmount,
          method: 'BANK_TRANSFER',
          proofUrl: dto.proofUrl,
          verificationStatus: PaymentVerificationStatus.PENDING,
        },
      });
    }

    this.logger.log(`Proof uploaded for order ${orderId} — payment ${payment.id}`);
    return payment;
  }

  // ──────────────────────────────────────────────
  // BUYER: Get all payments for an order
  // ──────────────────────────────────────────────

  async getOrderPayments(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.buyerId !== userId) {
      throw new NotFoundException('Order not found');
    }

    const payments = await this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderId: true,
        amount: true,
        method: true,
        referenceNumber: true,
        proofUrl: true,
        verificationStatus: true,
        createdAt: true,
      },
    });

    const confirmedTotal = await this.getConfirmedTotal(orderId);
    const remaining = Math.max(0, order.totalAmount - confirmedTotal);

    return {
      orderId,
      totalAmount: order.totalAmount,
      totalPaid: confirmedTotal,
      remaining,
      paymentStatus: this.computePaymentStatus(confirmedTotal, order.totalAmount),
      payments,
    };
  }

  // ──────────────────────────────────────────────
  // ADMIN: Confirm a payment
  // ──────────────────────────────────────────────

  async confirmPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        order: {
          include: {
            items: { select: { id: true, sellerId: true, totalPrice: true } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.verificationStatus === PaymentVerificationStatus.CONFIRMED) {
      throw new BadRequestException('Payment is already confirmed');
    }

    if (payment.verificationStatus === PaymentVerificationStatus.REJECTED) {
      throw new BadRequestException('Cannot confirm a rejected payment');
    }

    // Transactional: confirm payment + recalculate order status + maybe settle
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Mark payment as CONFIRMED
      const confirmed = await tx.payment.update({
        where: { id: paymentId },
        data: { verificationStatus: PaymentVerificationStatus.CONFIRMED },
      });

      // 2. Recalculate order payment status
      const confirmedPayments = await tx.payment.findMany({
        where: {
          orderId: payment.orderId,
          verificationStatus: PaymentVerificationStatus.CONFIRMED,
        },
      });

      const totalPaid = confirmedPayments.reduce((sum, p) => sum + p.amount, 0);
      const newStatus = this.computePaymentStatus(
        totalPaid,
        payment.order.totalAmount,
      );

      const isInitialStatus =
        payment.order.orderStatus === OrderStatus.PLACED ||
        payment.order.orderStatus === OrderStatus.ACCEPTED;

      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          paymentStatus: newStatus,
          ...(newStatus === PaymentStatus.SUCCESS &&
            isInitialStatus && { orderStatus: OrderStatus.PAYMENT_RECEIVED }),
        },
      });

      // 3. If fully paid AND delivered → create seller settlements
      if (
        newStatus === PaymentStatus.SUCCESS &&
        payment.order.orderStatus === OrderStatus.DELIVERED
      ) {
        await this.createSettlements(tx, payment.order.items);
      }

      return { confirmed, totalPaid, newStatus };
    });

    this.logger.log(
      `Payment ${paymentId} confirmed → order ${payment.orderId} status: ${result.newStatus}`,
    );

    return {
      payment: result.confirmed,
      orderPaymentStatus: result.newStatus,
      totalPaid: result.totalPaid,
      totalAmount: payment.order.totalAmount,
    };
  }

  // ──────────────────────────────────────────────
  // ADMIN: Reject a payment
  // ──────────────────────────────────────────────

  async rejectPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.verificationStatus === PaymentVerificationStatus.REJECTED) {
      throw new BadRequestException('Payment is already rejected');
    }

    if (payment.verificationStatus === PaymentVerificationStatus.CONFIRMED) {
      throw new BadRequestException('Cannot reject a confirmed payment');
    }

    const rejected = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { verificationStatus: PaymentVerificationStatus.REJECTED },
    });

    this.logger.log(`Payment ${paymentId} rejected`);
    return rejected;
  }

  // ──────────────────────────────────────────────
  // HELPER: Compute confirmed total for an order
  // ──────────────────────────────────────────────

  private async getConfirmedTotal(orderId: string): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      where: {
        orderId,
        verificationStatus: PaymentVerificationStatus.CONFIRMED,
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  // ──────────────────────────────────────────────
  // HELPER: Compute payment status from totals
  // ──────────────────────────────────────────────

  private computePaymentStatus(
    totalPaid: number,
    totalAmount: number,
  ): PaymentStatus {
    if (totalPaid >= totalAmount) return PaymentStatus.SUCCESS;
    if (totalPaid > 0) return PaymentStatus.PARTIAL;
    return PaymentStatus.PENDING;
  }

  // ──────────────────────────────────────────────
  // HELPER: Create seller settlements
  // ──────────────────────────────────────────────

  private async createSettlements(
    tx: any,
    items: { id: string; sellerId: string; totalPrice: number }[],
  ) {
    for (const item of items) {
      // Skip if settlement already exists for this order item
      const existing = await tx.sellerSettlement.findUnique({
        where: { orderItemId: item.id },
      });
      if (existing) continue;

      const commission = +(item.totalPrice * this.commissionRate).toFixed(2);
      const sellerAmount = +(item.totalPrice - commission).toFixed(2);

      await tx.sellerSettlement.create({
        data: {
          sellerId: item.sellerId,
          orderItemId: item.id,
          amount: sellerAmount,
          commission,
          payoutStatus: 'PENDING',
        },
      });
    }

    this.logger.log(
      `Seller settlements created for ${items.length} order items`,
    );
  }
}
