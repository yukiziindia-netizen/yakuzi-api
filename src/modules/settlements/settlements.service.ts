import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MarkPaidDto } from './dto/mark-paid.dto';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── SELLER-FACING ────────────────────────────────────

  /**
   * Get all settlements for the authenticated seller.
   */
  async getSellerSettlements(userId: string, dateFrom?: string, dateTo?: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    const where: any = { sellerId: seller.id };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const settlements = await this.prisma.sellerSettlement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        orderItem: {
          select: {
            id: true,
            orderId: true,
            quantity: true,
            totalPrice: true,
            product: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    return settlements;
  }

  /**
   * Get settlement summary for the authenticated seller.
   */
  async getSellerSummary(userId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    const settlements = await this.prisma.sellerSettlement.findMany({
      where: { sellerId: seller.id },
    });

    let totalEarnings = 0;
    let pendingPayouts = 0;
    let paidPayouts = 0;
    let commissionPaid = 0;

    for (const s of settlements) {
      totalEarnings += s.amount;
      commissionPaid += s.commission;
      if (s.payoutStatus === 'PAID') {
        paidPayouts += s.amount;
      } else {
        pendingPayouts += s.amount;
      }
    }

    return {
      totalEarnings: +totalEarnings.toFixed(2),
      pendingPayouts: +pendingPayouts.toFixed(2),
      paidPayouts: +paidPayouts.toFixed(2),
      commissionPaid: +commissionPaid.toFixed(2),
      totalSettlements: settlements.length,
    };
  }

  /**
   * Get payout history (only PAID settlements) for the seller.
   */
  async getSellerHistory(userId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    return this.prisma.sellerSettlement.findMany({
      where: { sellerId: seller.id, payoutStatus: 'PAID' },
      orderBy: { payoutDate: 'desc' },
      select: {
        id: true,
        amount: true,
        commission: true,
        payoutStatus: true,
        payoutReference: true,
        payoutDate: true,
        createdAt: true,
        orderItem: {
          select: {
            orderId: true,
            product: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  // ─── ADMIN-FACING ─────────────────────────────────────

  /**
   * Admin: get all settlements with optional filter.
   */
  async getAllSettlements(status?: string) {
    const where: any = {};
    if (status) {
      where.payoutStatus = status;
    }

    return this.prisma.sellerSettlement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        seller: {
          select: { id: true, companyName: true, userId: true },
        },
        orderItem: {
          select: {
            orderId: true,
            totalPrice: true,
            product: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /**
   * Admin: mark a settlement as paid.
   */
  async markPaid(settlementId: string, dto: MarkPaidDto) {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: settlementId },
    });

    if (!settlement) {
      throw new NotFoundException('Settlement not found');
    }

    if (settlement.payoutStatus === 'PAID') {
      throw new BadRequestException('Settlement is already marked as paid');
    }

    const updated = await this.prisma.sellerSettlement.update({
      where: { id: settlementId },
      data: {
        payoutStatus: 'PAID',
        payoutReference: dto.payoutReference,
        payoutDate: new Date(),
      },
    });

    this.logger.log(
      `Settlement ${settlementId} marked as PAID — ref: ${dto.payoutReference}`,
    );

    return updated;
  }
}
