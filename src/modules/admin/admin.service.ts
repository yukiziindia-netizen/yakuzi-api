import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import csv from 'csv-parser';
import { Readable } from 'stream';
import slugify from 'slugify';
import { AdminQuerySuggestionsDto } from './dto/query-suggestions.dto';
import {
  UserStatus,
  OrderStatus,
  PaymentStatus,
  PaymentVerificationStatus,
  ProductApprovalStatus,
  TicketStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { QueryUsersDto } from './dto/query-users.dto';
import { AdminQueryProductsDto } from './dto/query-products.dto';
import { AdminQueryOrdersDto } from './dto/query-orders.dto';
import { AdminQueryPaymentsDto } from './dto/query-payments.dto';
import { AdminQuerySettlementsDto } from './dto/query-settlements.dto';
import { AdminQueryTicketsDto } from './dto/query-tickets.dto';
import { AdminUpdateOrderStatusDto } from './dto/admin-update-order-status.dto';
import { AdminUpdateTicketStatusDto } from './dto/admin-update-ticket-status.dto';
import { AdminReplyTicketDto } from './dto/admin-reply-ticket.dto';
import { NotificationsService } from '../notifications/notifications.service';


@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}


  // ════════════════════════════════════════════════════════
  // DASHBOARD
  // ════════════════════════════════════════════════════════

  async getDashboard(params: { dateFrom?: string; dateTo?: string } = {}) {
    try {
      const { dateFrom, dateTo } = params;
      const dateWhere: any = {};
      if (dateFrom || dateTo) {
        dateWhere.createdAt = {};
        if (dateFrom) dateWhere.createdAt.gte = new Date(dateFrom);
        if (dateTo) dateWhere.createdAt.lte = new Date(dateTo);
      }

      const [
        totalUsers,
        totalBuyers,
        totalSellers,
        totalOrders,
        revenueResult,
        pendingOrders,
        pendingPayments,
        pendingSettlements,
        totalProducts,
        openTickets,
        blockedUsers,
        recentOrders,
        referralStats,
        pendingProductRequests,
      ] = await Promise.all([
        this.prisma.user.count({ where: dateWhere }),
        this.prisma.user.count({ where: { role: 'BUYER', ...dateWhere } }),
        this.prisma.user.count({ where: { role: 'SELLER', ...dateWhere } }),
        this.prisma.order.count({ where: dateWhere }),
        this.prisma.order.aggregate({
          where: dateWhere,
          _sum: { totalAmount: true },
        }),
        this.prisma.order.count({
          where: { orderStatus: OrderStatus.PLACED, ...dateWhere },
        }),
        this.prisma.payment.count({
          where: {
            verificationStatus: PaymentVerificationStatus.PENDING,
            ...dateWhere,
          },
        }),
        this.prisma.sellerSettlement.count({
          where: { payoutStatus: 'PENDING', ...dateWhere },
        }),
        this.prisma.product.count({
          where: { deletedAt: null, ...dateWhere },
        }),
        this.prisma.ticket.count({
          where: {
            status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
            ...dateWhere,
          },
        }),
        this.prisma.user.count({
          where: { status: UserStatus.BLOCKED, ...dateWhere },
        }),
        this.prisma.order.findMany({
          where: dateWhere,
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            totalAmount: true,
            orderStatus: true,
            paymentStatus: true,
            createdAt: true,
            buyer: { select: { id: true, phone: true } },
          },
        }),
        this.prisma.order.aggregate({
          where: {
            referralCodeId: { not: null },
            orderStatus: OrderStatus.DELIVERED,
            ...dateWhere,
          },
          _count: { id: true },
          _sum: { totalAmount: true },
        }),
        (this.prisma as any).productRequest.count({
          where: { status: 'PENDING', ...dateWhere },
        }),
      ]);

      return {
        totalUsers,
        totalBuyers,
        totalSellers,
        blockedUsers,
        totalOrders,
        totalRevenue: revenueResult?._sum?.totalAmount ?? 0,
        totalProducts,
        pendingOrders,
        pendingPayments,
        pendingSettlements,
        openTickets,
        recentOrders,
        referralCount: (referralStats as any)?._count?.id ?? 0,
        referralRevenue: (referralStats as any)?._sum?.totalAmount ?? 0,
        pendingProductRequests,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch dashboard metrics: ${error.message}`, error.stack);
      throw error; // Re-throw so NestJS returns 500 but we at least see the log on Render
    }
  }

  // ════════════════════════════════════════════════════════
  // USER MANAGEMENT
  // ════════════════════════════════════════════════════════

  async getAllUsers(query: QueryUsersDto) {
    const { role, status, search, dateFrom, dateTo, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};
    if (role) where.role = role;
    if (status) where.status = status;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as any).gte = new Date(dateFrom);
      if (dateTo) (where.createdAt as any).lte = new Date(dateTo);
    }

    if (search) {
      where.OR = [
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { buyerProfile: { legalName: { contains: search, mode: 'insensitive' } } },
        { sellerProfile: { companyName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          phone: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          buyerProfile: true,
          sellerProfile: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        buyerProfile: true,
        sellerProfile: {
          select: {
            id: true,
            companyName: true,
            gstNumber: true,
            panNumber: true,
            address: true,
            city: true,
            state: true,
            pincode: true,
            // @ts-ignore
            email: true,
            // @ts-ignore
            fssaiNumber: true,
            // @ts-ignore
            bankAccount: true,
            // @ts-ignore
            cancelCheck: true,
            drugLicenseNumber: true,
            drugLicenseUrl: true,
            drugLicenseExpiry: true,
            drugLicenseNumber2: true,
            drugLicenseUrl2: true,
            drugLicenseExpiry2: true,
            verificationStatus: true,
            updatedAt: true,
          }
        },
        _count: { select: { orders: true, reviews: true, tickets: true } },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getPendingUsers() {
    return this.prisma.user.findMany({
      where: { status: UserStatus.PENDING },
      select: {
        id: true,
        phone: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        buyerProfile: true,
        sellerProfile: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approveUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { sellerProfile: true },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.status === UserStatus.APPROVED) {
      throw new BadRequestException('User is already approved');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.APPROVED },
      select: {
        id: true, phone: true, email: true, role: true,
        status: true, createdAt: true, updatedAt: true,
        buyerProfile: true, sellerProfile: true,
      },
    });

    if (user.sellerProfile) {
      await this.prisma.sellerProfile.update({
        where: { userId },
        data: { verificationStatus: 'VERIFIED' },
      });
    }

    // Also approve buyer profile — set VERIFIED + default PREPAID tier so buyer can place orders
    const buyerProfile = await this.prisma.buyerProfile.findUnique({ where: { userId } });
    if (buyerProfile) {
      await this.prisma.buyerProfile.update({
        where: { userId },
        data: {
          verificationStatus: 'VERIFIED',
          creditTier: buyerProfile.creditTier ?? 'PREPAID', // preserve existing tier, or default to PREPAID
        },
      });
    }

    this.logger.log(`User ${userId} approved by admin`);
    await this.notificationsService.notifyUserVerified(userId, user.role);
    return updatedUser;
  }

  async rejectUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { sellerProfile: true },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.status === UserStatus.REJECTED) {
      throw new BadRequestException('User is already rejected');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.REJECTED },
      select: {
        id: true, phone: true, email: true, role: true,
        status: true, createdAt: true, updatedAt: true,
        buyerProfile: true, sellerProfile: true,
      },
    });

    if (user.sellerProfile) {
      await this.prisma.sellerProfile.update({
        where: { userId },
        data: { verificationStatus: 'REJECTED' },
      });
    }

    // Also reject buyer profile
    const buyerProfile = await this.prisma.buyerProfile.findUnique({ where: { userId } });
    if (buyerProfile) {
      await this.prisma.buyerProfile.update({
        where: { userId },
        data: { verificationStatus: 'REJECTED', creditTier: null },
      });
    }

    this.logger.log(`User ${userId} rejected by admin`);
    await this.notificationsService.notifyUserRejected(userId, user.role);
    return updatedUser;
  }

  async blockUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status === UserStatus.BLOCKED) {
      throw new BadRequestException('User is already blocked');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.BLOCKED },
      select: {
        id: true, phone: true, email: true, role: true,
        status: true, createdAt: true, updatedAt: true,
        buyerProfile: true, sellerProfile: true,
      },
    });

    this.logger.log(`User ${userId} blocked by admin`);
    return updatedUser;
  }

  async unblockUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== UserStatus.BLOCKED) {
      throw new BadRequestException('User is not blocked');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.APPROVED },
      select: {
        id: true, phone: true, email: true, role: true,
        status: true, createdAt: true, updatedAt: true,
        buyerProfile: true, sellerProfile: true,
      },
    });

    this.logger.log(`User ${userId} unblocked by admin`);
    return updatedUser;
  }

  // ════════════════════════════════════════════════════════
  // PRODUCT MANAGEMENT
  // ════════════════════════════════════════════════════════

  async getAllProducts(query: AdminQueryProductsDto) {
    const { sellerId, categoryId, subCategoryId, search, isActive, approvalStatus, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = { deletedAt: null };
    if (sellerId) where.sellerId = sellerId;
    if (categoryId) where.categoryId = categoryId;
    if (subCategoryId) where.subCategoryId = subCategoryId;
    if (isActive === 'true') where.isActive = true;
    if (isActive === 'false') where.isActive = false;
    if (approvalStatus && ['PENDING', 'APPROVED', 'REJECTED'].includes(approvalStatus.toUpperCase())) {
      where.approvalStatus = approvalStatus.toUpperCase() as ProductApprovalStatus;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { manufacturer: { contains: search, mode: 'insensitive' } },
        { chemicalComposition: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          manufacturer: true,
          mrp: true,
          gstPercent: true,
          isActive: true,
          approvalStatus: true,
          rejectionReason: true,
          createdAt: true,
          updatedAt: true,
          masterProduct: {
            select: {
              id: true,
              _count: { select: { products: true } }
            }
          },
          seller: { select: { id: true, companyName: true, userId: true } },
          category: { select: { id: true, name: true } },
          subCategory: { select: { id: true, name: true } },
          batches: {
            select: { id: true, batchNumber: true, stock: true, expiryDate: true },
            orderBy: { expiryDate: 'asc' },
          },
          inventoryAlerts: {
            select: { id: true, alertType: true, message: true, createdAt: true },
            take: 5,
            orderBy: { createdAt: 'desc' },
          },
          _count: { select: { reviews: true, orderItems: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getProductById(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        seller: { select: { id: true, companyName: true, userId: true, city: true, state: true } },
        category: { select: { id: true, name: true } },
        subCategory: { select: { id: true, name: true } },
        batches: { orderBy: { expiryDate: 'asc' } },
        images: { select: { id: true, url: true } },
        inventoryAlerts: { orderBy: { createdAt: 'desc' }, take: 10 },
        _count: { select: { reviews: true, orderItems: true, cartItems: true } },
      },
    });

    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async disableProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.isActive) throw new BadRequestException('Product is already disabled');

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
      select: { id: true, name: true, isActive: true, updatedAt: true },
    });

    this.logger.log(`Product ${productId} disabled by admin`);
    return updated;
  }

  async enableProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.isActive) throw new BadRequestException('Product is already active');

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { isActive: true },
      select: { id: true, name: true, isActive: true, updatedAt: true },
    });

    this.logger.log(`Product ${productId} enabled by admin`);
    return updated;
  }

  async softDeleteProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.deletedAt) throw new BadRequestException('Product is already deleted');

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { deletedAt: new Date(), isActive: false },
      select: { id: true, name: true, isActive: true, deletedAt: true },
    });

    this.logger.log(`Product ${productId} soft-deleted by admin`);
    return updated;
  }

  async approveProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.approvalStatus === ProductApprovalStatus.APPROVED) {
      throw new BadRequestException('Product is already approved');
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        approvalStatus: ProductApprovalStatus.APPROVED,
        isActive: true,
        rejectionReason: null,
      },
      select: {
        id: true, name: true, isActive: true, approvalStatus: true, updatedAt: true,
        seller: { select: { id: true, companyName: true } },
      },
    });

    this.logger.log(`Product ${productId} approved by admin`);
    return updated;
  }

  async rejectProduct(productId: string, reason?: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.approvalStatus === ProductApprovalStatus.REJECTED) {
      throw new BadRequestException('Product is already rejected');
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        approvalStatus: ProductApprovalStatus.REJECTED,
        isActive: false,
        rejectionReason: reason || null,
      },
      select: {
        id: true, name: true, isActive: true, approvalStatus: true, rejectionReason: true, updatedAt: true,
        seller: { select: { id: true, companyName: true } },
      },
    });

    this.logger.log(`Product ${productId} rejected by admin${reason ? `: ${reason}` : ''}`);
    return updated;
  }

  // ════════════════════════════════════════════════════════
  // ORDER MANAGEMENT
  // ════════════════════════════════════════════════════════

  async getAllOrders(query: AdminQueryOrdersDto) {
    const { status, sellerId, buyerId, dateFrom, dateTo, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {};
    if (status) where.orderStatus = status;
    if (buyerId) where.buyerId = buyerId;
    if (sellerId) where.items = { some: { sellerId } };

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as any).gte = new Date(dateFrom);
      if (dateTo) (where.createdAt as any).lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          totalAmount: true,
          orderStatus: true,
          paymentStatus: true,
          createdAt: true,
          updatedAt: true,
          buyer: {
            select: {
              id: true,
              phone: true,
              email: true,
              buyerProfile: { select: { legalName: true } },
            },
          },
          items: {
            select: {
              id: true,
              quantity: true,
              unitPrice: true,
              totalPrice: true,
              product: { select: { id: true, name: true } },
              seller: { select: { id: true, companyName: true } },
              settlement: { select: { id: true, payoutStatus: true } },
            },
          },
          address: true,
          payments: {
            select: { proofUrl: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
          _count: { select: { payments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getOrderById(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        buyer: {
          select: {
            id: true,
            phone: true,
            email: true,
            buyerProfile: {
              select: {
                legalName: true,
                gstNumber: true,
                panNumber: true,
                drugLicenseNumber: true,
                drugLicenseNumber2: true,
                drugLicenseExpiry: true,
                drugLicenseExpiry2: true,
                address: true,
                city: true,
                state: true,
                pincode: true,
                drugLicenseUrl: true,
                drugLicenseUrl2: true,
                cancelCheck: true,
                document: true,
              }
            },


          },
        },
        items: {
          include: {
            product: { select: { id: true, name: true, manufacturer: true, mrp: true } },
            seller: { select: { id: true, companyName: true } },
          },
        },
        address: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            amount: true,
            method: true,
            referenceNumber: true,
            proofUrl: true,
            verificationStatus: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async adminUpdateOrderStatus(orderId: string, dto: AdminUpdateOrderStatusDto) {
    const order = await this.prisma.order.findUnique({ 
      where: { id: orderId },
      include: { items: true }
    });
    if (!order) throw new NotFoundException('Order not found');

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: dto.status },
      include: {
        buyer: { select: { phone: true, buyerProfile: { select: { legalName: true } } } },
        items: {
          include: {
            product: { select: { name: true } },
            seller: { select: { companyName: true } },
          },
        },
      },
    });

    // Create settlements if status is DELIVERED and payment is successful
    if (updated.orderStatus === OrderStatus.DELIVERED && updated.paymentStatus === PaymentStatus.SUCCESS) {
      for (const item of updated.items) {
        const existing = await this.prisma.sellerSettlement.findUnique({
          where: { orderItemId: item.id },
        });
        if (!existing) {
          const commission = +(item.totalPrice * 0.05).toFixed(2);
          await this.prisma.sellerSettlement.create({
            data: {
              sellerId: item.sellerId,
              orderItemId: item.id,
              amount: +(item.totalPrice - commission).toFixed(2),
              commission,
              payoutStatus: 'PENDING',
            },
          });
        }
      }
    }

    this.logger.log(`Order ${orderId} status overridden to ${dto.status} by admin`);
    return updated;
  }

  // ════════════════════════════════════════════════════════
  // PAYMENT MANAGEMENT
  // ════════════════════════════════════════════════════════

  async getAllPayments(query: AdminQueryPaymentsDto) {
    const { verificationStatus, orderId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {};
    if (verificationStatus) where.verificationStatus = verificationStatus;
    if (orderId) where.orderId = orderId;

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        select: {
          id: true,
          orderId: true,
          amount: true,
          method: true,
          referenceNumber: true,
          proofUrl: true,
          verificationStatus: true,
          createdAt: true,
          updatedAt: true,
          order: {
            select: {
              id: true,
              totalAmount: true,
              orderStatus: true,
              buyer: { select: { id: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async adminConfirmPayment(paymentId: string) {
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

    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.verificationStatus === PaymentVerificationStatus.CONFIRMED) {
      throw new BadRequestException('Payment is already confirmed');
    }
    if (payment.verificationStatus === PaymentVerificationStatus.REJECTED) {
      throw new BadRequestException('Cannot confirm a rejected payment');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const confirmed = await tx.payment.update({
        where: { id: paymentId },
        data: { verificationStatus: PaymentVerificationStatus.CONFIRMED },
      });

      // Recalculate order payment status
      const confirmedPayments = await tx.payment.findMany({
        where: {
          orderId: payment.orderId,
          verificationStatus: PaymentVerificationStatus.CONFIRMED,
        },
      });

      const totalPaid = confirmedPayments.reduce((sum, p) => sum + p.amount, 0);
      const newStatus =
        totalPaid >= payment.order.totalAmount
          ? PaymentStatus.SUCCESS
          : totalPaid > 0
            ? PaymentStatus.PARTIAL
            : PaymentStatus.PENDING;

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

      // If fully paid AND delivered → create seller settlements
      if (
        newStatus === PaymentStatus.SUCCESS &&
        payment.order.orderStatus === OrderStatus.DELIVERED
      ) {
        for (const item of payment.order.items) {
          const existing = await tx.sellerSettlement.findUnique({
            where: { orderItemId: item.id },
          });
          if (!existing) {
            const commission = +(item.totalPrice * 0.05).toFixed(2);
            await tx.sellerSettlement.create({
              data: {
                sellerId: item.sellerId,
                orderItemId: item.id,
                amount: +(item.totalPrice - commission).toFixed(2),
                commission,
                payoutStatus: 'PENDING',
              },
            });
          }
        }
      }

      return { confirmed, totalPaid, newStatus };
    });

    this.logger.log(`Payment ${paymentId} confirmed by admin`);
    return {
      payment: result.confirmed,
      orderPaymentStatus: result.newStatus,
      totalPaid: result.totalPaid,
      totalAmount: payment.order.totalAmount,
    };
  }

  async adminRejectPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
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

    this.logger.log(`Payment ${paymentId} rejected by admin`);
    return rejected;
  }

  // ════════════════════════════════════════════════════════
  // MARKETING MANAGEMENT
  // ════════════════════════════════════════════════════════

  async getMarketingProducts(slot?: any) {
    return this.prisma.marketingProduct.findMany({
      where: slot ? { slot } : {},
      include: {
        product: {
          include: {
            images: { take: 1 },
            seller: { select: { companyName: true } },
          },
        },
      },
      orderBy: { priority: 'desc' },
    });
  }

  async addMarketingProduct(dto: any) {
    const existing = await this.prisma.marketingProduct.findFirst({
      where: { productId: dto.productId, slot: dto.slot },
    });

    if (existing) {
      return this.prisma.marketingProduct.update({
        where: { id: existing.id },
        data: { priority: dto.priority ?? 0 },
      });
    }

    return this.prisma.marketingProduct.create({
      data: {
        productId: dto.productId,
        slot: dto.slot,
        priority: dto.priority ?? 0,
      },
    });
  }

  async removeMarketingProduct(id: string) {
    return this.prisma.marketingProduct.delete({
      where: { id },
    });
  }
  async getAllSettlements(query: AdminQuerySettlementsDto) {
    const { status, sellerId, orderItemId, dateFrom, dateTo, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SellerSettlementWhereInput = {};
    if (status) where.payoutStatus = status;
    if (sellerId) where.sellerId = sellerId;
    if (orderItemId) where.orderItemId = orderItemId;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as any).gte = new Date(dateFrom);
      if (dateTo) (where.createdAt as any).lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.sellerSettlement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          seller: { select: { id: true, companyName: true, userId: true } },
          orderItem: {
            select: {
              id: true,
              orderId: true,
              totalPrice: true,
              product: { select: { id: true, name: true } },
            },
          },
        },
        skip,
        take: limit,
      }),
      this.prisma.sellerSettlement.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async markSettlementPaid(settlementId: string, payoutReference: string, paymentProofUrl?: string) {
    const settlement = await this.prisma.sellerSettlement.findUnique({
      where: { id: settlementId },
    });

    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.payoutStatus === 'PAID') {
      throw new BadRequestException('Settlement is already paid');
    }

    const updated = await this.prisma.sellerSettlement.update({
      where: { id: settlementId },
      data: {
        payoutStatus: 'PAID',
        payoutReference,
        paymentProofUrl,
        payoutDate: new Date(),
      } as any,
      include: { seller: { select: { id: true, companyName: true } } },
    });

    this.logger.log(`Settlement ${settlementId} marked as paid by admin`);
    return updated;
  }

  async syncSettlements() {
    const orders = await this.prisma.order.findMany({
      where: {
        orderStatus: OrderStatus.DELIVERED,
      },
      include: { items: true },
    });

    let createdCount = 0;
    for (const order of orders) {
      for (const item of order.items) {
        const existing = await this.prisma.sellerSettlement.findUnique({
          where: { orderItemId: item.id },
        });

        if (!existing) {
          const commission = 0;
          await this.prisma.sellerSettlement.create({
            data: {
              sellerId: item.sellerId,
              orderItemId: item.id,
              amount: item.totalPrice,
              commission,
              payoutStatus: 'PENDING',
            },
          });
          createdCount++;
        }
      }
    }

    const allItemIds = orders.flatMap(o => o.items.map(i => i.id));
    this.logger.log(`Sync settlements completed: ${createdCount} new records created.`);
    const syncedSettlements = await this.prisma.sellerSettlement.findMany({
      where: { orderItemId: { in: allItemIds } },
      include: {
        seller: { select: { id: true, companyName: true, userId: true } },
        orderItem: {
          select: {
            id: true,
            orderId: true,
            totalPrice: true,
            product: { select: { id: true, name: true } },
          },
        },
      },
    });

    return syncedSettlements;
  }

  // ════════════════════════════════════════════════════════
  // TICKET MANAGEMENT
  // ════════════════════════════════════════════════════════

  async getAllTickets(query: AdminQueryTicketsDto) {
    const { status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.TicketWhereInput = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          subject: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, phone: true, role: true } },
          _count: { select: { messages: true } },
        },
        skip,
        take: limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTicketById(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { id: true, phone: true, email: true, role: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderId: true,
            message: true,
            createdAt: true,
            sender: { select: { id: true, phone: true, role: true } },
          },
        },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async adminReplyTicket(adminUserId: string, ticketId: string, dto: AdminReplyTicketDto) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          ticketId,
          senderId: adminUserId,
          message: dto.message,
        },
        select: { id: true, senderId: true, message: true, createdAt: true },
      }),
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.IN_PROGRESS },
      }),
    ]);

    this.logger.log(`Admin replied to ticket ${ticketId}`);
    return message;
  }

  async adminUpdateTicketStatus(ticketId: string, dto: AdminUpdateTicketStatusDto) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: dto.status },
      select: { id: true, subject: true, status: true, createdAt: true, updatedAt: true },
    });

    this.logger.log(`Ticket ${ticketId} status changed to ${dto.status} by admin`);
    return updated;
  }

  // ════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ════════════════════════════════════════════════════════

  async adminBroadcastNotification(adminUserId: string, dto: import('./dto/admin-broadcast-notification.dto').AdminBroadcastNotificationDto) {
    const { target, message } = dto;
    let whereClause: Prisma.UserWhereInput = { status: 'APPROVED' };

    if (target === 'BUYER') {
      whereClause.role = 'BUYER';
    } else if (target === 'SELLER') {
      whereClause.role = 'SELLER';
    }

    // Fetch matching users
    const users = await this.prisma.user.findMany({
      where: whereClause,
      select: { id: true, email: true, phone: true }
    });

    if (users.length === 0) {
      throw new BadRequestException('No active users found for the selected target audience.');
    }

    // Create notifications in bulk
    const notificationsData = users.map(user => ({
      userId: user.id,
      message,
    }));

    await this.prisma.notification.createMany({
      data: notificationsData,
    });

    // Save broadcast history
    await this.prisma.notificationBroadcast.create({
      data: {
        adminId: adminUserId,
        message,
        target,
        deliveredCount: users.length,
      },
    });

    // Simulate email/SMS triggers
    this.logger.log(`Broadcast Notification: Sent to ${users.length} users (Target: ${target}).`);
    users.forEach(u => {
      if (u.email) {
        // In a real app, this would push to an email queue (SQS, RabbitMQ, Bull)
        this.logger.debug(`[MOCK EMAIL] Sending notification to ${u.email}: ${message}`);
      }
    });

    return {
      success: true,
      deliveredCount: users.length,
      target
    };
  }

  /**
   * Get history of broadcasted notifications.
   */
  async getBroadcastHistory() {
    return this.prisma.notificationBroadcast.findMany({
      include: {
        admin: {
          select: {
            id: true,
            adminProfile: { select: { displayName: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get history of broadcasted notifications sent by the current admin.
   */
  async getMyBroadcastHistory(adminId: string) {
    return this.prisma.notificationBroadcast.findMany({
      where: { adminId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ════════════════════════════════════════════════════════
  // ADMIN MANAGEMENT (Role-Based Access)
  // ════════════════════════════════════════════════════════

  /**
   * Get all admins with their profiles and permissions
   */
  async getAdmins() {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: {
        id: true,
        phone: true,
        email: true,
        status: true,
        createdAt: true,
        adminProfile: {
          select: {
            id: true,
            displayName: true,
            department: true,
            permissions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return admins.map(admin => ({
      id: admin.id,
      phone: admin.phone,
      email: admin.email,
      status: admin.status,
      name: admin.adminProfile?.displayName || 'Unknown',
      department: admin.adminProfile?.department,
      permissions: admin.adminProfile?.permissions || '',
      createdAt: admin.createdAt,
    }));
  }

  /**
   * Get admin by ID with profile
   */
  async getAdminById(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        phone: true,
        email: true,
        status: true,
        createdAt: true,
        adminProfile: {
          select: {
            id: true,
            displayName: true,
            department: true,
            permissions: true,
          },
        },
      },
    });

    if (!admin || admin.id === null) {
      throw new NotFoundException('Admin not found');
    }

    return {
      id: admin.id,
      phone: admin.phone,
      email: admin.email,
      status: admin.status,
      name: admin.adminProfile?.displayName || 'Unknown',
      department: admin.adminProfile?.department,
      permissions: admin.adminProfile?.permissions || '',
      createdAt: admin.createdAt,
    };
  }

  /**
   * Create a new admin with role-based permissions
   */
  async createAdmin(createAdminDto: any) {
    const { phone, name, department, permissions } = createAdminDto;

    // Check if admin already exists
    const existingAdmin = await this.prisma.user.findFirst({
      where: { phone, role: 'ADMIN' },
    });

    if (existingAdmin) {
      throw new BadRequestException('Admin with this phone already exists');
    }

    // Create admin user
    const adminUser = await this.prisma.user.create({
      data: {
        phone,
        email: `admin+${phone}@pharmabag.in`,
        password: '', // Will be set on first login via OTP
        role: 'ADMIN',
        status: 'PENDING',
        adminProfile: {
          create: {
            displayName: name,
            department: department || '',
            permissions: permissions || '',
          },
        },
      },
      include: { adminProfile: true },
    });

    return {
      id: adminUser.id,
      phone: adminUser.phone,
      email: adminUser.email,
      name: adminUser.adminProfile?.displayName,
      department: adminUser.adminProfile?.department,
      permissions: adminUser.adminProfile?.permissions || '',
      createdAt: adminUser.createdAt,
    };
  }

  /**
   * Update admin profile and permissions
   */
  async updateAdmin(adminId: string, updateAdminDto: any) {
    const { name, department, permissions } = updateAdminDto;

    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      include: { adminProfile: true },
    });

    if (!admin || admin.role !== 'ADMIN') {
      throw new NotFoundException('Admin not found');
    }

    // Update or create admin profile (using upsert to avoid 500 if profile is missing)
    const updatedAdmin = await this.prisma.adminProfile.upsert({
      where: { userId: adminId },
      create: {
        userId: adminId,
        displayName: name || admin.phone,
        department: department || '',
        permissions: permissions || '',
      },
      update: {
        ...(name && { displayName: name }),
        ...(department !== undefined && { department }),
        ...(permissions !== undefined && { permissions }),
      },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
            email: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      id: updatedAdmin.userId,
      phone: updatedAdmin.user.phone,
      email: updatedAdmin.user.email,
      name: updatedAdmin.displayName,
      department: updatedAdmin.department,
      permissions: updatedAdmin.permissions || '',
      createdAt: updatedAdmin.user.createdAt,
    };
  }

  /**
   * Delete admin (soft delete by status + remove from admin role)
   */
  async deleteAdmin(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });

    if (!admin || admin.role !== 'ADMIN') {
      throw new NotFoundException('Admin not found');
    }

    // Delete admin profile
    await this.prisma.adminProfile.delete({
      where: { userId: adminId },
    });

    // Remove admin user or just mark as blocked
    await this.prisma.user.update({
      where: { id: adminId },
      data: { status: 'BLOCKED' },
    });

    return { success: true, message: 'Admin deleted successfully' };
  }

  // ════════════════════════════════════════════════════════
  // ANALYTICS
  // ════════════════════════════════════════════════════════

  async getRevenueChart(period: string = '30d') {
    return [
      { name: 'W1', revenue: 0 },
      { name: 'W2', revenue: 0 },
      { name: 'W3', revenue: 0 },
      { name: 'W4', revenue: 0 },
    ];
  }

  async getOrdersChart(period: string = '30d') {
    return [
      { name: 'W1', orders: 0 },
      { name: 'W2', orders: 0 },
      { name: 'W3', orders: 0 },
      { name: 'W4', orders: 0 },
    ];
  }

  async getTopProducts(limit: number = 10) {
    return this.prisma.product.findMany({
      take: Number(limit) || 10,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, mrp: true }
    });
  }

  async getTopSellers(limit: number = 10) {
    return this.prisma.sellerProfile.findMany({
      take: Number(limit) || 10,
      orderBy: { createdAt: 'desc' },
      select: { id: true, companyName: true, rating: true, user: { select: { phone: true } } }
    });
  }

  // ═══════════════════════════════════════════════════
  // GST/PAN VERIFICATION STATUS (Admin Override)
  // ═══════════════════════════════════════════════════

  async updateBuyerGstPanStatus(
    buyerId: string,
    dto: { verified: boolean; creditTier?: import('@prisma/client').CreditTier },
  ) {
    const buyer = await this.prisma.buyerProfile.findUnique({
      where: { id: buyerId },
    });

    if (!buyer) {
      throw new NotFoundException('Buyer profile not found');
    }

    const profile = await this.prisma.buyerProfile.update({
      where: { id: buyerId },
      data: {
        verificationStatus: dto.verified ? 'VERIFIED' : 'REJECTED',
        creditTier: dto.verified ? (dto.creditTier ?? null) : null,
      },
    });

    // Also update user status based on verification decision
    await this.prisma.user.update({
      where: { id: buyer.userId },
      data: {
        status: dto.verified ? UserStatus.APPROVED : UserStatus.REJECTED,
      },
    });

    this.logger.log(
      `Buyer ${buyerId} ${dto.verified ? 'approved' : 'rejected'} — creditTier: ${dto.creditTier ?? 'none'}`,
    );

    if (dto.verified) {
      await this.notificationsService.notifyUserVerified(buyer.userId, 'BUYER');
    } else {
      await this.notificationsService.notifyUserRejected(buyer.userId, 'BUYER');
    }

    return profile;
  }

  async updateSellerGstPanStatus(
    sellerId: string,
    dto: { verified: boolean; creditTier?: import('@prisma/client').CreditTier },
  ) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { id: sellerId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    const updated = await this.prisma.sellerProfile.update({
      where: { id: sellerId },
      data: {
        verificationStatus: dto.verified ? 'VERIFIED' : 'REJECTED',
        creditTier: dto.verified ? (dto.creditTier ?? null) : null,
      },
    });

    if (dto.verified) {
      await this.notificationsService.notifyUserVerified(seller.userId, 'SELLER');
    } else {
      await this.notificationsService.notifyUserRejected(seller.userId, 'SELLER');
    }

    return updated;

  }

  // ═══════════════════════════════════════════════════
  // SUGGESTIONS (MASTER PRODUCTS)
  // ═══════════════════════════════════════════════════

  async getSuggestions(query: AdminQuerySuggestionsDto) {
    const { search, categoryId, subCategoryId, page = 1, limit = 20, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MasterProductWhereInput = { deletedAt: null };
    if (categoryId) where.categoryId = categoryId;
    if (subCategoryId) where.subCategoryId = subCategoryId;
    if (isActive === 'true') where.isActive = true;
    if (isActive === 'false') where.isActive = false;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { manufacturer: { contains: search, mode: 'insensitive' } },
        { chemicalComposition: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.masterProduct.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          subCategory: { select: { id: true, name: true } },
          images: { select: { id: true, url: true }, take: 1 },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.masterProduct.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getSuggestionById(id: string) {
    const suggestion = await this.prisma.masterProduct.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        subCategory: { select: { id: true, name: true } },
        images: { select: { id: true, url: true } },
        products: {
          select: { id: true, seller: { select: { companyName: true } }, mrp: true },
          take: 10,
        },
      },
    });

    if (!suggestion) throw new NotFoundException('Suggestion not found');
    return suggestion;
  }

  async createSuggestion(dto: import('./dto/update-suggestion.dto').UpdateSuggestionDto) {
    const slug = slugify(`${dto.name}-${dto.manufacturer}`, { lower: true, strict: true });
    
    return this.prisma.masterProduct.create({
      data: {
        name: dto.name || '',
        manufacturer: dto.manufacturer || '',
        chemicalComposition: dto.chemicalComposition || '',
        description: dto.description || '',
        mrp: dto.mrp,
        gstPercent: dto.gstPercent,
        categoryId: dto.categoryId || '',
        subCategoryId: dto.subCategoryId || '',
        slug,
        isActive: dto.isActive ?? true,
      },
      include: {
        category: { select: { id: true, name: true } },
        subCategory: { select: { id: true, name: true } },
      },
    });
  }

  async updateSuggestion(id: string, dto: import('./dto/update-suggestion.dto').UpdateSuggestionDto) {
    const suggestion = await this.prisma.masterProduct.findUnique({ where: { id } });
    if (!suggestion) throw new NotFoundException('Suggestion not found');

    const updated = await this.prisma.masterProduct.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.manufacturer && { manufacturer: dto.manufacturer }),
        ...(dto.chemicalComposition && { chemicalComposition: dto.chemicalComposition }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.mrp !== undefined && { mrp: dto.mrp }),
        ...(dto.gstPercent !== undefined && { gstPercent: dto.gstPercent }),
        ...(dto.categoryId && { categoryId: dto.categoryId }),
        ...(dto.subCategoryId && { subCategoryId: dto.subCategoryId }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        category: { select: { id: true, name: true } },
        subCategory: { select: { id: true, name: true } },
      },
    });

    return updated;
  }


  async deleteSuggestion(id: string) {
    const suggestion = await this.prisma.masterProduct.findUnique({ where: { id } });
    if (!suggestion) throw new NotFoundException('Suggestion not found');

    return this.prisma.masterProduct.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async importSuggestions(buffer: Buffer): Promise<{ success: boolean; recordsProcessed: number; errors: string[] }> {
    const rawRecords: any[] = [];
    const errors: string[] = [];
    let count = 0;

    return new Promise((resolve) => {
      const stream = Readable.from(buffer);

      stream
        .pipe(csv())
        .on('data', (data) => rawRecords.push(data))
        .on('error', (err) => {
          this.logger.error(`CSV Parsing Error: ${err.message}`);
          resolve({ success: false, recordsProcessed: 0, errors: [`Parsing error: ${err.message}`] });
        })
        .on('end', async () => {
          try {
            this.logger.log(`Starting CSV import: ${rawRecords.length} records found`);

            // 1. Filter out empty/invalid rows early
            const records = rawRecords.filter(r => (r['name'] || r['PRODUCT NAME'])?.trim());
            if (records.length === 0) {
              return resolve({ success: true, recordsProcessed: 0, errors: ['No valid products found in CSV'] });
            }

            // 2. Pre-resolve all Categories
            const uniqueCategoryNames = [...new Set(records.map(r => (r['category'] || r['Category'])?.trim()).filter(Boolean))] as string[];
            const catCache = new Map<string, string>();
            
            // Load existing
            const existingCats = await this.prisma.category.findMany({
              where: { name: { in: uniqueCategoryNames } }
            });
            existingCats.forEach(c => catCache.set(c.name, c.id));

            // Create missing
            for (const name of uniqueCategoryNames) {
              if (!catCache.has(name)) {
                const cat = await this.prisma.category.create({
                  data: { name, slug: slugify(name, { lower: true, strict: true }) || name.toLowerCase() }
                });
                catCache.set(name, cat.id);
              }
            }

            // Default category
            const defaultCatId = await this.resolveDefaultCategory(catCache);

            // 3. Pre-resolve all Subcategories
            const subCatPairs = new Set<string>(); // "catName|subName"
            records.forEach(r => {
              const c = (r['category'] || r['Category'])?.trim() || 'Uncategorized';
              const s = (r['subCategory'] || r['Sub category'])?.trim();
              if (s) subCatPairs.add(`${c}|${s}`);
            });

            const subCatCache = new Map<string, string>(); // "catName|subName" -> id
            
            for (const pair of subCatPairs) {
              const [catName, subName] = pair.split('|');
              const categoryId = catCache.get(catName) || defaultCatId;
              
              let subCat = await this.prisma.subCategory.findFirst({
                where: { name: subName, categoryId }
              });
              
              if (!subCat) {
                subCat = await this.prisma.subCategory.create({
                  data: { 
                    name: subName, 
                    slug: slugify(subName, { lower: true, strict: true }) || subName.toLowerCase(),
                    categoryId 
                  }
                });
              }
              subCatCache.set(pair, subCat.id);
            }

            // Default subcategory per category used
            const defaultSubCatCache = new Map<string, string>(); // catId -> subId

            // 4. Process Products in Chunks
            const CHUNK_SIZE = 50;
            for (let i = 0; i < records.length; i += CHUNK_SIZE) {
              const chunk = records.slice(i, i + CHUNK_SIZE);
              
              await Promise.all(chunk.map(async (row) => {
                try {
                  const productName = (row['name'] || row['PRODUCT NAME'])?.trim();
                  const manufacturer = (row['manufacturer'] || row['COMPANY NAME'])?.trim() || 'UNKNOWN';
                  const chemicalComposition = (row['chemicalComposition'] || row['CHEMICAL COMBINATION'])?.trim() || 'N/A';
                  const categoryName = (row['category'] || row['Category'])?.trim();
                  const subCategoryName = (row['subCategory'] || row['Sub category'])?.trim();
                  const gstStr = String(row['gstPercent'] || row['GST'] || '0').trim();
                  const mrpStr = String(row['mrp'] || '0').trim();
                  const description = row['description']?.trim() || '';
                  const imageUrl = (row['imageUrl'] || row['IMAGE URL'])?.trim();

                  const gstPercent = parseFloat(gstStr.replace('%', '')) || 0;
                  const mrp = parseFloat(mrpStr) || 0;
                  const categoryId = (categoryName && catCache.get(categoryName)) || defaultCatId;
                  
                  let subCategoryId: string;
                  const subCatLookupKey = `${categoryName || 'Uncategorized'}|${subCategoryName}`;
                  if (subCategoryName && subCatCache.has(subCatLookupKey)) {
                    subCategoryId = subCatCache.get(subCatLookupKey)!;
                  } else {
                    const cachedDefault = defaultSubCatCache.get(categoryId);
                    if (cachedDefault) {
                      subCategoryId = cachedDefault;
                    } else {
                      subCategoryId = await this.resolveDefaultSubCategory(categoryId, defaultSubCatCache);
                      defaultSubCatCache.set(categoryId, subCategoryId);
                    }
                  }

                  const slug = slugify(`${productName}-${manufacturer}`, { lower: true, strict: true }) || `p-${Date.now()}-${Math.random()}`;

                  const masterProduct = await this.prisma.masterProduct.upsert({
                    where: { externalId: (row.id as string) || slug },
                    update: {
                      name: productName,
                      manufacturer,
                      chemicalComposition,
                      mrp,
                      description,
                      gstPercent,
                      categoryId,
                      subCategoryId,
                      updatedAt: new Date(),
                    },
                    create: {
                      name: productName,
                      slug,
                      externalId: row.id || slug,
                      manufacturer,
                      chemicalComposition,
                      mrp,
                      description,
                      gstPercent,
                      categoryId,
                      subCategoryId,
                      isActive: true,
                    },
                  });

                  if (imageUrl) {
                    await this.prisma.masterProductImage.upsert({
                      where: { id: `img-${masterProduct.id}` },
                      update: { url: imageUrl },
                      create: {
                        id: `img-${masterProduct.id}`,
                        masterProductId: masterProduct.id,
                        url: imageUrl,
                      },
                    });
                  }

                  count++;
                } catch (err) {
                  errors.push(`Row error (${row['PRODUCT NAME']}): ${err.message}`);
                }
              }));
              
              if (i % 500 === 0) {
                this.logger.log(`Import progress: ${i}/${records.length} processed`);
              }
            }

            this.logger.log(`Import finished: ${count} records processed, ${errors.length} errors`);
            resolve({ success: true, recordsProcessed: count, errors: errors.slice(0, 100) }); // Cap error log
          } catch (err) {
            this.logger.error(`Critical CSV Import Error: ${err.message}`);
            resolve({ success: false, recordsProcessed: count, errors: [`Global error: ${err.message}`] });
          }
        });
    });
  }

  private async resolveDefaultCategory(cache: Map<string, string>): Promise<string> {
    const name = 'Uncategorized';
    if (cache.has(name)) return (cache.get(name) as string);
    let cat = await this.prisma.category.findUnique({ where: { name } });
    if (!cat) {
      cat = await this.prisma.category.create({
        data: { name, slug: 'uncategorized' },
      });
    }
    cache.set(name, cat.id);
    return cat.id;
  }

  private async resolveDefaultSubCategory(categoryId: string, cache: Map<string, string>): Promise<string> {
    const name = 'General';
    const key = `DEFAULT:${categoryId}`;
    if (cache.has(key)) return (cache.get(key) as string);
    let subCat = await this.prisma.subCategory.findFirst({
      where: { name, categoryId },
    });
    if (!subCat) {
      subCat = await this.prisma.subCategory.create({
        data: { name, slug: 'general', categoryId },
      });
    }
    cache.set(key, subCat.id);
    return subCat.id;
  }

  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        sellerProfile: true,
        buyerProfile: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    this.logger.log(`Starting hard delete for user ${userId} (Role: ${user.role})`);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Handle Seller-specific blocks
        if (user.sellerProfile) {
          // Delete settlements where this seller is the recipient
          await tx.sellerSettlement.deleteMany({
            where: { sellerId: user.sellerProfile.id },
          });

          // Delete order items where this seller is involved (prevents blocking SellerProfile/Product deletion)
          // Note: This might leave orders "empty" or with incorrect totals, but hard delete is requested.
          await tx.orderItem.deleteMany({
            where: { sellerId: user.sellerProfile.id },
          });
        }

        // 2. Handle Buyer-specific blocks
        if (user.buyerProfile) {
          // Delete custom orders
          await tx.customOrder.deleteMany({
            where: { buyerId: user.buyerProfile.id },
          });

          // Disconnect referral codes (set buyerId to null)
          await tx.referralCode.updateMany({
            where: { buyerId: user.buyerProfile.id },
            data: { buyerId: null },
          });

          // Handle settlements blocked by buyer's orders
          // When User is deleted, Order is deleted (Cascade), which deletes OrderItem (Cascade).
          // But OrderItem is referenced by SellerSettlement without cascade.
          const buyerOrders = await tx.order.findMany({
            where: { buyerId: userId },
            include: { items: true },
          });
          const orderItemIds = buyerOrders.flatMap((o) => o.items.map((i) => i.id));
          if (orderItemIds.length > 0) {
            await tx.sellerSettlement.deleteMany({
              where: { orderItemId: { in: orderItemIds } },
            });
          }
        }

        // 3. Handle Admin-specific blocks
        if (user.role === 'ADMIN') {
          await tx.notificationBroadcast.deleteMany({
            where: { adminId: userId },
          });
        }

        // 4. Finally, delete the user (this will cascade to profiles, orders, etc.)
        const deleted = await tx.user.delete({
          where: { id: userId },
        });

        this.logger.log(`User ${userId} and all related data hard-deleted successfully`);
        return deleted;
      }, {
        timeout: 15000 // Increase timeout for large deletions
      });
    } catch (error) {
      this.logger.error(`Failed to delete user ${userId}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
