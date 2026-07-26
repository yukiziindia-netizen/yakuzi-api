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
        throw new BadRequestException(
          result.message || 'GST verification failed',
        );
      }
      gstPanResponse = result;
    }

    const profile = await this.prisma.sellerProfile.create({
      data: {
        userId,
        companyName: dto.companyName,
        gstNumber: dto.gstNumber,
        panNumber: dto.panNumber ?? null,
        aadhaarNumber: dto.aadhaarNumber ?? null,
        drugLicenseNumber: dto.drugLicenseNumber || '',
        drugLicenseUrl: dto.drugLicenseUrl || '',
        drugLicenseExpiry: dto.drugLicenseExpiry
          ? new Date(dto.drugLicenseExpiry)
          : null,
        drugLicenseNumber2: dto.drugLicenseNumber2 ?? null,
        drugLicenseUrl2: dto.drugLicenseUrl2 ?? null,
        drugLicenseExpiry2: dto.drugLicenseExpiry2
          ? new Date(dto.drugLicenseExpiry2)
          : null,
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
        verificationStatus:
          gstPanResponse || dto.aadhaarNumber ? 'PENDING' : 'UNVERIFIED',
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
    try {
      let profile = await this.prisma.sellerProfile.findUnique({
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
        // Auto-create blank profile for seller user
        profile = await this.prisma.sellerProfile.create({
          data: {
            userId,
            companyName: '',
            gstNumber: '',
            panNumber: '',
            drugLicenseNumber: '',
            drugLicenseUrl: '',
            address: '',
            city: '',
            state: '',
            pincode: '',
            verificationStatus: 'UNVERIFIED',
            rating: 0,
          },
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
      }

      return {
        ...profile,
        phone: profile.user?.phone || '',
        email: profile.user?.email || '',
        status: profile.user?.status || 'PENDING',
        userCreatedAt: profile.user?.createdAt || new Date(),
      };
    } catch (error) {
      this.logger.warn(`Failed to fetch seller profile for ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        id: `temp-${userId}`,
        userId,
        companyName: '',
        gstNumber: '',
        panNumber: '',
        drugLicenseNumber: '',
        drugLicenseUrl: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        verificationStatus: 'UNVERIFIED',
        rating: 0,
        phone: '',
        email: '',
        status: 'PENDING',
        userCreatedAt: new Date(),
      };
    }
  }

  /**
   * Partially update the seller profile.
   */
  async updateProfile(userId: string, dto: UpdateSellerProfileDto) {
    try {
      let existing = await this.prisma.sellerProfile.findUnique({
        where: { userId },
      });

      if (!existing) {
        // Auto create before updating
        await this.getProfile(userId);
        existing = await this.prisma.sellerProfile.findUnique({
          where: { userId },
        });
      }

      const isFirstUpdate = existing ? existing.verificationStatus === 'UNVERIFIED' : true;

      if (isFirstUpdate) {
        try {
          await this.prisma.user.update({
            where: { id: userId },
            data: { status: 'PENDING' },
          });
        } catch (userErr) {
          // Ignore status update warning
        }
      }

      const {
        companyName,
        gstNumber,
        panNumber,
        aadhaarNumber,
        drugLicenseNumber,
        drugLicenseUrl,
        drugLicenseNumber2,
        drugLicenseUrl2,
        drugLicenseExpiry,
        drugLicenseExpiry2,
        address,
        city,
        state,
        pincode,
        email,
        fssaiNumber,
        bankAccount,
        cancelCheck,
        additionalDocuments,
        gstPanResponse,
        isVacation,
      } = dto as any;

      if (email) {
        try {
          await this.prisma.user.update({
            where: { id: userId },
            data: { email },
          });
        } catch (userErr) {
          // Ignore email collision
        }
      }

      const dataToUpdate: any = {};
      if (companyName !== undefined) dataToUpdate.companyName = companyName;
      if (gstNumber !== undefined) dataToUpdate.gstNumber = gstNumber;
      if (panNumber !== undefined) dataToUpdate.panNumber = panNumber;
      if (aadhaarNumber !== undefined) dataToUpdate.aadhaarNumber = aadhaarNumber;
      if (drugLicenseNumber !== undefined) dataToUpdate.drugLicenseNumber = drugLicenseNumber;
      if (drugLicenseUrl !== undefined) dataToUpdate.drugLicenseUrl = drugLicenseUrl;
      if (drugLicenseNumber2 !== undefined) dataToUpdate.drugLicenseNumber2 = drugLicenseNumber2;
      if (drugLicenseUrl2 !== undefined) dataToUpdate.drugLicenseUrl2 = drugLicenseUrl2;
      if (address !== undefined) dataToUpdate.address = address;
      if (city !== undefined) dataToUpdate.city = city;
      if (state !== undefined) dataToUpdate.state = state;
      if (pincode !== undefined) dataToUpdate.pincode = pincode;
      if (email !== undefined) dataToUpdate.email = email;
      if (fssaiNumber !== undefined) dataToUpdate.fssaiNumber = fssaiNumber;
      if (bankAccount !== undefined) dataToUpdate.bankAccount = bankAccount;
      if (cancelCheck !== undefined) dataToUpdate.cancelCheck = cancelCheck;
      if (additionalDocuments !== undefined) dataToUpdate.additionalDocuments = additionalDocuments;
      if (gstPanResponse !== undefined) dataToUpdate.gstPanResponse = gstPanResponse;
      if (isVacation !== undefined) dataToUpdate.isVacation = isVacation;

      if (drugLicenseExpiry) {
        const parsed = new Date(drugLicenseExpiry);
        if (!isNaN(parsed.getTime())) dataToUpdate.drugLicenseExpiry = parsed;
      }

      if (drugLicenseExpiry2) {
        const parsed = new Date(drugLicenseExpiry2);
        if (!isNaN(parsed.getTime())) dataToUpdate.drugLicenseExpiry2 = parsed;
      }

      if (isFirstUpdate) {
        dataToUpdate.verificationStatus = 'PENDING';
      }

      const profile = await this.prisma.sellerProfile.update({
        where: { userId },
        data: dataToUpdate,
      });

      this.logger.log(`Seller profile updated for user ${userId}`);
      return profile;
    } catch (error) {
      this.logger.error(`Error updating seller profile for ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to update seller profile');
    }
  }


  /**
   * Get seller dashboard metrics.
   */
  async getDashboard(userId: string) {
    const DEFAULT_DASHBOARD = {
      stats: {
        totalProducts: 0,
        activeListings: 0,
        totalOrders: 0,
        pendingOrders: 0,
        totalRevenue: 0,
        pendingPayouts: 0,
        avgRating: 0,
        lowStockItems: 0,
      },
      overview: {
        orders: [],
        revenueTrend: [],
      },
    };

    try {
      const seller = await this.prisma.sellerProfile.findUnique({
        where: { userId },
      });

      if (!seller) {
        return DEFAULT_DASHBOARD;
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
        (this.prisma as any).sellerOffer ? this.prisma.sellerOffer.count({ where: { sellerId: seller.id } }) : Promise.resolve(0),
        (this.prisma as any).sellerOffer ? this.prisma.sellerOffer.count({
          where: { sellerId: seller.id, isActive: true, deletedAt: null },
        }) : Promise.resolve(0),
        (this.prisma as any).orderItem ? this.prisma.orderItem.count({ where: { sellerId: seller.id } }) : Promise.resolve(0),
        (this.prisma as any).orderItem ? this.prisma.orderItem.count({
          where: {
            sellerId: seller.id,
            order: {
              orderStatus: {
                in: ['PLACED', 'ACCEPTED', 'SHIPPED', 'OUT_FOR_DELIVERY'],
              },
            },
          },
        }) : Promise.resolve(0),
        (this.prisma as any).orderItem ? this.prisma.orderItem.aggregate({
          where: {
            sellerId: seller.id,
            order: { orderStatus: 'DELIVERED' },
          },
          _sum: { totalPrice: true },
        }) : Promise.resolve({ _sum: { totalPrice: 0 } }),
        (this.prisma as any).sellerSettlement ? this.prisma.sellerSettlement.aggregate({
          where: { sellerId: seller.id, payoutStatus: 'PENDING' },
          _sum: { amount: true },
        }) : Promise.resolve({ _sum: { amount: 0 } }),
        (this.prisma as any).productBatch ? this.prisma.productBatch.count({
          where: { sellerOffer: { sellerId: seller.id }, stock: { lt: 10 } },
        }) : Promise.resolve(0),
      ]);

      const orders = (this.prisma as any).orderItem ? await this.prisma.orderItem.findMany({
        where: { sellerId: seller.id },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          quantity: true,
          totalPrice: true,
          sellerOffer: { select: { name: true } },
          order: {
            select: {
              id: true,
              orderStatus: true,
              paymentStatus: true,
              createdAt: true,
            },
          },
        },
      }) : [];

      return {
        stats: {
          totalProducts: totalProducts || 0,
          activeListings: activeListings || 0,
          totalOrders: totalOrders || 0,
          pendingOrders: pendingOrders || 0,
          totalRevenue: Number((totalRevenue as any)?._sum?.totalPrice || 0),
          pendingPayouts: (pendingPayouts as any)?._sum?.amount ? Number((pendingPayouts as any)._sum.amount) : 0,
          avgRating: seller.rating || 0,
          lowStockItems: lowStockItems || 0,
        },
        overview: {
          orders: (orders || []).map((item) => ({
            id: item.order?.id,
            productName: item.sellerOffer?.name || 'Unknown Product',
            quantity: item.quantity,
            totalPrice: item.totalPrice,
            status: item.order?.orderStatus,
            paymentStatus: item.order?.paymentStatus,
            createdAt: item.order?.createdAt,
          })),
          revenueTrend: [],
        },
      };
    } catch (error) {
      this.logger.warn(`Failed to fetch seller dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return DEFAULT_DASHBOARD;
    }
  }

}
