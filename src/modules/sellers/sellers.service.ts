import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IdfyService } from '../verification/idfy.service';
import { CreateSellerProfileDto } from './dto/create-seller-profile.dto';
import { UpdateSellerProfileDto } from './dto/update-seller-profile.dto';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idfyService: IdfyService,
  ) {}

  /**
   * Create a new seller profile for an authenticated SELLER user.
   * Verifies GST via IDFY; blocks creation on verification failure (legacy behavior).
   * Sets verificationStatus = PENDING after successful IDFY check.
   */
  async createProfile(userId: string, dto: CreateSellerProfileDto) {
    const existing = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException('Seller profile already exists');
    }

    // IDFY GST verification — BLOCK on failure (legacy behavior)
    let gstPanResponse: any = null;
    if (this.idfyService.isConfigured() && dto.gstNumber) {
      const result = await this.idfyService.verifyGst(dto.gstNumber);
      if (!result.status) {
        throw new BadRequestException(result.message || 'GST verification failed');
      }
      gstPanResponse = result;
    }

    const profile = await this.prisma.sellerProfile.create({
      data: {
        userId,
        companyName: dto.companyName,
        gstNumber: dto.gstNumber,
        panNumber: dto.panNumber,
        drugLicenseNumber: dto.drugLicenseNumber,
        drugLicenseUrl: dto.drugLicenseUrl,
        drugLicenseExpiry: dto.drugLicenseExpiry ? new Date(dto.drugLicenseExpiry) : null,
        drugLicenseNumber2: dto.drugLicenseNumber2 ?? null,
        drugLicenseUrl2: dto.drugLicenseUrl2 ?? null,
        drugLicenseExpiry2: dto.drugLicenseExpiry2 ? new Date(dto.drugLicenseExpiry2) : null,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        // @ts-ignore
        email: dto.email,
        // @ts-ignore
        fssaiNumber: dto.fssaiNumber,
        // @ts-ignore
        bankAccount: dto.bankAccount,
        // @ts-ignore
        cancelCheck: dto.cancelCheck,
        gstPanResponse,
        verificationStatus: gstPanResponse ? 'PENDING' : 'UNVERIFIED',
        rating: 0,
      },
    });

    this.logger.log(`Seller profile created for user ${userId}`);
    return profile;
  }

  /**
   * Get the seller profile for an authenticated user.
   */
  async getProfile(userId: string) {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            phone: true,
            email: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Seller profile not found');
    }

    return {
      ...profile,
      phone: profile.user?.phone,
      email: profile.user?.email,
      status: profile.user?.status,
      userCreatedAt: profile.user?.createdAt,
    };
  }

  /**
   * Partially update the seller profile.
   */
  async updateProfile(userId: string, dto: UpdateSellerProfileDto) {
    const existing = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw new NotFoundException(
        'Seller profile not found. Create a profile first.',
      );
    }

    const isFirstUpdate = existing.verificationStatus === 'UNVERIFIED';

    if (isFirstUpdate) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: 'PENDING' },
      });
    }

    const profile = await this.prisma.sellerProfile.update({
      where: { userId },
      data: {
        ...dto,
        drugLicenseExpiry: dto.drugLicenseExpiry ? new Date(dto.drugLicenseExpiry) : undefined,
        drugLicenseExpiry2: dto.drugLicenseExpiry2 ? new Date(dto.drugLicenseExpiry2) : undefined,
        // @ts-ignore
        email: dto.email,
        // @ts-ignore
        fssaiNumber: dto.fssaiNumber,
        // @ts-ignore
        bankAccount: dto.bankAccount,
        // @ts-ignore
        cancelCheck: dto.cancelCheck,
        ...(isFirstUpdate && { verificationStatus: 'PENDING' }),
      },
    });

    this.logger.log(`Seller profile updated for user ${userId}`);
    return profile;
  }

  /**
   * Get seller dashboard metrics.
   */
  async getDashboard(userId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    const [
      totalProducts,
      activeListings,
      totalOrders,
      pendingOrders,
      totalRevenue,
      pendingPayouts,
      lowStockItems,
    ] = await Promise.all([
      this.prisma.product.count({ where: { sellerId: seller.id } }),
      this.prisma.product.count({
        where: { sellerId: seller.id, isActive: true, deletedAt: null },
      }),
      this.prisma.orderItem.count({ where: { sellerId: seller.id } }),
      this.prisma.orderItem.count({
        where: {
          sellerId: seller.id,
          order: {
            orderStatus: { in: ['PLACED', 'ACCEPTED', 'SHIPPED', 'OUT_FOR_DELIVERY'] },
          },
        },
      }),
      this.prisma.orderItem.aggregate({
        where: {
          sellerId: seller.id,
          order: { orderStatus: 'DELIVERED' },
        },
        _sum: { totalPrice: true },
      }),
      this.prisma.sellerSettlement.aggregate({
        where: { sellerId: seller.id, payoutStatus: 'PENDING' },
        _sum: { amount: true },
      }),
      this.prisma.productBatch.count({
        where: { product: { sellerId: seller.id }, stock: { lt: 10 } },
      }),
    ]);

    const orders = await this.prisma.orderItem.findMany({
      where: { sellerId: seller.id },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        quantity: true,
        totalPrice: true,
        product: { select: { name: true } },
        order: {
          select: {
            id: true,
            orderStatus: true,
            paymentStatus: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      stats: {
        totalProducts,
        activeListings,
        totalOrders,
        pendingOrders,
        totalRevenue: totalRevenue._sum.totalPrice || 0,
        pendingPayouts: pendingPayouts._sum.amount || 0,
        avgRating: seller.rating,
        lowStockItems,
      },
      overview: {
        orders: orders.map((item) => ({
          id: item.order.id,
          productName: item.product.name,
          quantity: item.quantity,
          totalPrice: item.totalPrice,
          status: item.order.orderStatus,
          paymentStatus: item.order.paymentStatus,
          createdAt: item.order.createdAt,
        })),
        revenueTrend: [], // Empty for now, would aggregate by day in production
      },
    };
  }
}
