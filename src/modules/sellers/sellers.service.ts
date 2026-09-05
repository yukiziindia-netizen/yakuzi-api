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
import { MailService } from '../mail/mail.service';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idfyService: IdfyService,
    private readonly mailService: MailService,
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
    await this.emailAdminNewSeller(userId, profile.companyName);
    return profile;
  }

  /**
   * Best-effort — the seller profile has already been created by the time
   * this runs, so a mail failure here must never fail the signup.
   */
  private async emailAdminNewSeller(userId: string, companyName: string): Promise<void> {
    // Admin Alert Email (platform settings) wins, then ADMIN_NOTIFICATION_EMAIL,
    // then the platform's own inbox — see MailService.resolveAdminRecipient.
    const to = await this.mailService.resolveAdminRecipient();
    if (!to) {
      // Silent no-op here means every new-seller signup goes completely
      // unnoticed with zero trace in the logs - this is the one config gap
      // that made this whole feature look like it was never built.
      this.logger.warn(
        `new-seller-signup admin email skipped: no Admin Alert Email in settings and neither ADMIN_NOTIFICATION_EMAIL nor SMTP_USER is set (user ${userId}, company "${companyName}")`,
      );
      return;
    }

    const adminAppUrl = process.env.ADMIN_APP_URL?.trim() || 'https://admin.yukizi.com';
    const reviewUrl = `${adminAppUrl}/users/${userId}`;

    const result = await this.mailService.sendMail({
      to,
      subject: `New seller application: ${companyName}`,
      text: `A new seller has applied for verification.\n\nCompany: ${companyName}\n\nReview: ${reviewUrl}`,
      html: `<p>A new seller has applied for verification.</p><p>Company: <strong>${this.escape(companyName)}</strong></p><p><a href="${reviewUrl}">Review this seller</a></p>`,
    });
    if (!result.sent) {
      this.logger.warn(
        `Could not email admin about new seller signup for user ${userId} (retryable=${result.retryable})`,
      );
    }
  }

  /**
   * HTML-escapes free text before it goes into an email's html field.
   * `companyName` is seller-supplied and unsanitized — same convention as
   * InvoiceEmailService.escape() (src/modules/orders/invoice-email.service.ts)
   * and AdminService.escape() (src/modules/admin/admin.service.ts).
   */
  private escape(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
      chartData: [],
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
        // deletedAt: null on both counts — a soft-deleted listing must leave
        // the "Active Listings x/y" denominator, or a deleted product reads
        // as "1 not live" forever.
        (this.prisma as any).sellerOffer ? this.prisma.sellerOffer.count({ where: { sellerId: seller.id, deletedAt: null } }) : Promise.resolve(0),
        (this.prisma as any).sellerOffer ? this.prisma.sellerOffer.count({
          where: { sellerId: seller.id, isActive: true, deletedAt: null },
        }) : Promise.resolve(0),
        // Product decision (2026-08-24): sellers see ALL their orders including
        // payment-pending ones - same rule as getSellerOrders(), so the
        // dashboard's own counts never disagree with the order list it links to.
        // Revenue still only counts DELIVERED (inherently paid) orders.
        (this.prisma as any).orderItem ? this.prisma.orderItem.count({
          where: { sellerId: seller.id },
        }) : Promise.resolve(0),
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
          where: { sellerOffer: { sellerId: seller.id, deletedAt: null }, stock: { lt: 10 } },
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

      // Monthly series for the seller Analytics charts, which have read a
      // `chartData` field since they were built but no endpoint ever supplied
      // it. Six calendar months including the current one. Revenue counts
      // DELIVERED orders only (same rule as totalRevenue above); the order
      // count includes every order so the chart total matches the Orders card.
      const chartStart = new Date();
      chartStart.setDate(1);
      chartStart.setHours(0, 0, 0, 0);
      chartStart.setMonth(chartStart.getMonth() - 5);

      const chartItems = (this.prisma as any).orderItem ? await this.prisma.orderItem.findMany({
        where: { sellerId: seller.id, order: { createdAt: { gte: chartStart } } },
        select: {
          totalPrice: true,
          order: { select: { createdAt: true, orderStatus: true } },
        },
      }) : [];

      const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const buckets = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(chartStart);
        d.setMonth(d.getMonth() + i);
        return {
          key: `${d.getFullYear()}-${d.getMonth()}`,
          month: MONTH_LABELS[d.getMonth()],
          revenue: 0,
          orders: 0,
        };
      });
      const bucketByKey = new Map(buckets.map((b) => [b.key, b]));
      for (const item of chartItems) {
        const created = item.order?.createdAt;
        if (!created) continue;
        const bucket = bucketByKey.get(`${created.getFullYear()}-${created.getMonth()}`);
        if (!bucket) continue;
        bucket.orders += 1;
        if (item.order.orderStatus === 'DELIVERED') {
          bucket.revenue += Number(item.totalPrice || 0);
        }
      }

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
        chartData: buckets.map(({ key: _key, ...rest }) => rest),
      };
    } catch (error) {
      this.logger.warn(`Failed to fetch seller dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return DEFAULT_DASHBOARD;
    }
  }

  /**
   * Buyers waiting on products this seller currently carries. Scoped through
   * the seller's own active SellerOffers, not a direct FK on ProductWaitlist —
   * a buyer's "Notify Me" click targets the catalog product, not any one
   * seller's specific offer (a product page can list several sellers), and
   * the existing restock flow already notifies every waitlisted buyer for a
   * catalogProductId regardless of which seller restocked. So "this seller's
   * waitlist" means: any catalog product they currently have an active,
   * approved listing for.
   */
  async getWaitlist(userId: string, productId?: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      return [];
    }

    const activeOffers = await this.prisma.sellerOffer.findMany({
      where: {
        sellerId: seller.id,
        isActive: true,
        deletedAt: null,
        approvalStatus: 'APPROVED',
        catalogProductId: { not: null },
      },
      select: { catalogProductId: true },
      distinct: ['catalogProductId'],
    });

    let catalogProductIds = activeOffers
      .map((o) => o.catalogProductId)
      .filter((id): id is string => id !== null);

    if (productId) {
      catalogProductIds = catalogProductIds.filter((id) => id === productId);
    }

    if (catalogProductIds.length === 0) {
      return [];
    }

    const entries = await this.prisma.productWaitlist.findMany({
      where: { catalogProductId: { in: catalogProductIds } },
      orderBy: { createdAt: 'desc' },
      include: {
        catalogProduct: {
          select: {
            id: true,
            name: true,
            images: {
              orderBy: [{ order: 'asc' }, { id: 'asc' }],
              take: 1,
              select: { url: true },
            },
          },
        },
        user: { select: { username: true } },
      },
    });

    return entries.map((entry) => ({
      id: entry.id,
      product: {
        id: entry.catalogProduct.id,
        name: entry.catalogProduct.name,
        image: entry.catalogProduct.images[0]?.url ?? null,
      },
      buyer: { name: entry.user.username ?? 'Yukizi buyer' },
      createdAt: entry.createdAt,
      isNotified: entry.isNotified,
    }));
  }
}
