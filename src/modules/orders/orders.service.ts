import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderStatus, Role, PaymentStatus } from '@prisma/client';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────
  // CHECKOUT  — Create Order from Cart
  // ──────────────────────────────────────────────

  async checkout(userId: string, dto: CreateOrderDto) {
    // 1. Fetch buyer cart with items + product + seller + batches
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              include: {
                seller: {
                  select: {
                    id: true,
                    verificationStatus: true,
                    companyName: true,
                  },
                },
                batches: {
                  where: { stock: { gt: 0 } },
                  orderBy: { expiryDate: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty. Add products before checkout.');
    }

    // 1b. Verify buyer profile is approved
    const buyerProfile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
      select: { verificationStatus: true, creditTier: true, legalName: true, referralCodeId: true },
    });

    if (!buyerProfile || !buyerProfile.legalName) {
      throw new ForbiddenException(
        'Please complete your KYC onboarding before placing orders.',
      );
    }

    if (buyerProfile.verificationStatus === 'UNVERIFIED') {
      throw new ForbiddenException(
        'Please complete your KYC onboarding before placing orders.',
      );
    }

    if (buyerProfile.verificationStatus === 'PENDING') {
      throw new ForbiddenException(
        'Your profile is under review. Please wait for admin approval before placing orders.',
      );
    }

    if (buyerProfile.verificationStatus === 'REJECTED') {
      throw new ForbiddenException(
        'Your profile verification was rejected. Please contact support.',
      );
    }

    if (!buyerProfile.creditTier) {
      throw new ForbiddenException(
        'Your account is not yet fully approved. Please wait for admin to set your credit tier.',
      );
    }

    // 2. Validate every cart item
    for (const item of cart.items) {
      const { product } = item;

      if (!product.isActive || product.deletedAt) {
        throw new BadRequestException(
          `Product "${product.name}" is no longer available. Please remove it from your cart.`,
        );
      }

      if (product.seller.verificationStatus !== 'VERIFIED') {
        throw new BadRequestException(
          `Seller for "${product.name}" is not verified. Please remove it from your cart.`,
        );
      }

      const totalStock = product.batches.reduce((sum, b) => sum + b.stock, 0);
      if (item.quantity > totalStock) {
        throw new BadRequestException(
          `Insufficient stock for "${product.name}". Only ${totalStock} units available.`,
        );
      }
    }

    // 3. Calculate total amount
    const totalAmount = cart.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );

    // 4. Execute transactional checkout
    const order = await this.prisma.$transaction(async (tx) => {
      // 4a. Create Order
      const newOrder = await tx.order.create({
        data: {
          buyerId: userId,
          totalAmount,
          orderStatus: OrderStatus.PLACED,
          referralCodeId: buyerProfile.referralCodeId,
        },
      });

      // 4b. Create OrderItems
      const orderItemsData = cart.items.map((item) => ({
        orderId: newOrder.id,
        productId: item.productId,
        sellerId: item.product.seller.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.quantity * item.unitPrice,
      }));

      await tx.orderItem.createMany({ data: orderItemsData });

      // 4c. Create OrderAddress snapshot
      await tx.orderAddress.create({
        data: {
          orderId: newOrder.id,
          name: dto.name,
          phone: dto.phone,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          pincode: dto.pincode,
        },
      });

      // 4d. Reduce ProductBatch stock (FIFO — earliest expiry first)
      for (const item of cart.items) {
        let remaining = item.quantity;

        for (const batch of item.product.batches) {
          if (remaining <= 0) break;

          const deduct = Math.min(remaining, batch.stock);
          await tx.productBatch.update({
            where: { id: batch.id },
            data: { stock: { decrement: deduct } },
          });
          remaining -= deduct;
        }
      }

      // 4e. Clear buyer cart
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return newOrder;
    });

    // 5. Fetch the created order with full details
    const fullOrder = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                manufacturer: true,
                mrp: true,
                images: { select: { url: true }, take: 1 },
              },
            },
            seller: {
              select: {
                id: true,
                companyName: true,
                city: true,
                state: true,
              },
            },
          },
        },
        address: true,
      },
    });

    this.logger.log(
      `Order ${order.id} placed by user ${userId} — total ₹${totalAmount}`,
    );

    return fullOrder;
  }

  // ──────────────────────────────────────────────
  // GET BUYER ORDERS
  // ──────────────────────────────────────────────

  async getBuyerOrders(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { buyerId: userId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                manufacturer: true,
                mrp: true,
                images: { select: { url: true }, take: 1 },
              },
            },
            seller: {
              select: { id: true, companyName: true },
            },
          },
        },
        address: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders;
  }

  // ──────────────────────────────────────────────
  // GET ORDER DETAIL (Buyer)
  // ──────────────────────────────────────────────

  async getOrderDetail(userId: string, orderId: string) {
    // 1. Identify user roles and profiles
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, sellerProfile: { select: { id: true } } },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2. Fetch the order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                manufacturer: true,
                chemicalComposition: true,
                mrp: true,
                gstPercent: true,
                images: { select: { id: true, url: true }, take: 1 },
              },
            },
            seller: {
              select: {
                id: true,
                companyName: true,
                city: true,
                state: true,
                rating: true,
              },
            },
            settlement: {
              select: {
                id: true,
                payoutStatus: true,
                payoutReference: true,
                paymentProofUrl: true,
                payoutDate: true,
              },
            },
          },
        },
        address: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // 3. Permission logic
    let hasAccess = false;

    // A. Role-based check
    if (user.role === Role.ADMIN) {
      hasAccess = true;
    } else if (user.role === Role.BUYER && order.buyerId === userId) {
      hasAccess = true;
    } else if (user.role === Role.SELLER && user.sellerProfile) {
      const sellerId = user.sellerProfile.id;
      // Check if this seller has ANY item in the order
      const hasSellerItem = order.items.some(
        (item) => item.sellerId === sellerId,
      );
      if (hasSellerItem) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      throw new NotFoundException('Order not found');
    }

    // 4. (Optional) Filter items if user is a seller?
    // In Phase 1, we show the full order but often it's better to show everything for tracking.
    return order;
  }

  // ──────────────────────────────────────────────
  // GET SELLER ORDERS
  // ──────────────────────────────────────────────

  async getSellerOrders(userId: string, dateFrom?: string, dateTo?: string) {
    // Find seller profile
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    const where: any = { sellerId: seller.id };

    if (dateFrom || dateTo) {
      where.order = {
        createdAt: {}
      };
      if (dateFrom) where.order.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.order.createdAt.lte = new Date(dateTo);
    }

    // Fetch order items belonging to this seller, grouped by order
    const orderItems = await this.prisma.orderItem.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            mrp: true,
            images: { select: { url: true }, take: 1 },
          },
        },
        order: {
          select: {
            id: true,
            buyerId: true,
            orderStatus: true,
            paymentStatus: true,
            createdAt: true,
            address: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group items by orderId for a cleaner response
    const ordersMap = new Map<
      string,
      {
        orderId: string;
        orderStatus: string;
        paymentStatus: string;
        createdAt: Date;
        address: any;
        items: any[];
        sellerTotal: number;
      }
    >();

    for (const item of orderItems) {
      const key = item.order.id;
      if (!ordersMap.has(key)) {
        ordersMap.set(key, {
          orderId: item.order.id,
          orderStatus: item.order.orderStatus,
          paymentStatus: item.order.paymentStatus,
          createdAt: item.order.createdAt,
          address: item.order.address,
          items: [],
          sellerTotal: 0,
        });
      }
      const entry = ordersMap.get(key)!;
      entry.items.push({
        id: item.id,
        product: item.product,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      });
      entry.sellerTotal += item.totalPrice;
    }

    return Array.from(ordersMap.values());
  }

  // ──────────────────────────────────────────────
  // UPDATE ORDER STATUS (Seller)
  // ──────────────────────────────────────────────

  async updateOrderStatus(
    userId: string,
    orderId: string,
    dto: UpdateOrderStatusDto,
  ) {
    // 1. Find seller profile
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
    });

    if (!seller) {
      throw new NotFoundException('Seller profile not found');
    }

    // 2. Verify this seller has items in the order
    const sellerItems = await this.prisma.orderItem.findMany({
      where: { orderId, sellerId: seller.id },
    });

    if (sellerItems.length === 0) {
      throw new ForbiddenException(
        'You do not have any items in this order',
      );
    }

    // 3. Fetch current order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // 4. Validate status transition
    const validTransitions: Record<string, string[]> = {
      PLACED: ['ACCEPTED', 'CANCELLED'],
      ACCEPTED: ['PAYMENT_RECEIVED', 'READY_TO_SHIP', 'CANCELLED'],
      PAYMENT_RECEIVED: ['READY_TO_SHIP', 'DISPATCHED_FROM_SELLER', 'CANCELLED'],
      READY_TO_SHIP: ['DISPATCHED_FROM_SELLER', 'CANCELLED'],
      DISPATCHED_FROM_SELLER: ['RECEIVED_AT_WAREHOUSE', 'SHIPPED', 'CANCELLED'],
      RECEIVED_AT_WAREHOUSE: ['SHIPPED', 'CANCELLED'],
      SHIPPED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
      OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
      DELIVERED: ['RETURNED', 'CANCELLED'],
    };

    const allowed = validTransitions[order.orderStatus] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${order.orderStatus} to ${dto.status}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    // 5. Update order status
    if (dto.status === OrderStatus.CANCELLED) {
      return this.cancelOrder(userId, orderId, Role.SELLER);
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: dto.status as OrderStatus },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true },
            },
          },
        },
        address: true,
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

    this.logger.log(
      `Order ${orderId} status updated to ${dto.status} by seller ${seller.id}`,
    );

    return updated;
  }

  // ──────────────────────────────────────────────
  // CANCEL ORDER — Buyer or Admin or Seller
  // ──────────────────────────────────────────────

  async cancelOrder(userId: string, orderId: string, role: string) {
    // 1. Fetch order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              include: {
                batches: {
                  where: { expiryDate: { gt: new Date() } },
                  orderBy: { expiryDate: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // 2. Permission check
    if (role === Role.BUYER && order.buyerId !== userId) {
      throw new ForbiddenException('You do not have permission to cancel this order');
    }

    // 3. Status validation
    const uncancelable: OrderStatus[] = [OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.RETURNED, OrderStatus.CANCELLED];
    if (uncancelable.includes(order.orderStatus)) {
      throw new BadRequestException(`Cannot cancel order in ${order.orderStatus} status`);
    }

    // 4. Update order and restore stock in a transaction
    const updated = await this.prisma.$transaction(async (tx) => {
      // 4a. Update status
      const cancelled = await tx.order.update({
        where: { id: orderId },
        data: { orderStatus: OrderStatus.CANCELLED },
      });

      // 4b. Restore stock (to the earliest expiry batch)
      for (const item of order.items) {
        if (item.product.batches.length > 0) {
          await tx.productBatch.update({
            where: { id: item.product.batches[0].id },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      return cancelled;
    });

    this.logger.log(`Order ${orderId} was cancelled by ${role} ${userId}`);
    return updated;
  }
}
