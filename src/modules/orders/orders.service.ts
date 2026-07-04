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
import { UpdateShippingDetailsDto } from './dto/update-shipping-details.dto';
import { OrderStatus, Role, PaymentStatus } from '@prisma/client';
import { ShiprocketService } from './shiprocket.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shiprocketService: ShiprocketService,
  ) {}

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
            sellerOffer: {
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
      throw new BadRequestException(
        'Cart is empty. Add products before checkout.',
      );
    }

    // 1b. Fetch buyer profile for referral code (KYC checks removed)
    const buyerProfile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
      select: { referralCodeId: true },
    });

    // 2. Validate every cart item
    for (const item of cart.items) {
      const { sellerOffer: product } = item;

      if (!product.isActive || product.deletedAt) {
        throw new BadRequestException(
          `Product "${product.name}" is no longer available. Please remove it from your cart.`,
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
          referralCodeId: buyerProfile?.referralCodeId || null,
        },
      });

      // 4b. Create OrderItems
      const orderItemsData = cart.items.map((item) => ({
        orderId: newOrder.id,
        sellerOfferId: item.sellerOfferId,
        sellerId: item.sellerOffer.seller.id,
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

        for (const batch of item.sellerOffer.batches) {
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
            sellerOffer: {
              select: {
                id: true,
                name: true,
                manufacturer: true,
                mrp: true,
                variant: {
                  select: {
                    catalogProduct: {
                      select: {
                        images: {
                          select: { url: true },
                        },
                      },
                    },
                  },
                },
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

    if (fullOrder) {
      for (const item of fullOrder.items) {
        if (item.sellerOffer && !item.sellerOffer.variant) {
          const cleanName = item.sellerOffer.name.replace(/\.\.\./g, '').trim();
          const catalogProduct = await this.prisma.catalogProduct.findFirst({
            where: {
              name: {
                startsWith: cleanName,
                mode: 'insensitive',
              },
              deletedAt: null,
            },
            include: {
              images: {
                select: { url: true },
              },
            },
          });
          if (catalogProduct && catalogProduct.images.length > 0) {
            (item.sellerOffer as any).variant = {
              catalogProduct: {
                images: catalogProduct.images,
              },
            };
          }
        }
      }
    }

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
            sellerOffer: {
              select: {
                id: true,
                name: true,
                manufacturer: true,
                mrp: true,
                variant: {
                  select: {
                    catalogProduct: {
                      select: {
                        images: {
                          select: { url: true },
                        },
                      },
                    },
                  },
                },
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

    // Fallback: Populate images if variant is null (e.g. unlinked custom/temporary offers)
    for (const order of orders) {
      for (const item of order.items) {
        if (item.sellerOffer && !(item.sellerOffer as any).variant) {
          const cleanName = (item.sellerOffer as any).name
            .replace(/\.\.\./g, '')
            .trim();
          const catalogProduct = await this.prisma.catalogProduct.findFirst({
            where: {
              name: {
                startsWith: cleanName,
                mode: 'insensitive',
              },
              deletedAt: null,
            },
            include: {
              images: {
                select: { url: true },
              },
            },
          });
          if (catalogProduct && catalogProduct.images.length > 0) {
            (item.sellerOffer as any).variant = {
              catalogProduct: {
                images: catalogProduct.images,
              },
            };
          }
        }
      }
    }

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
            sellerOffer: {
              select: {
                id: true,
                name: true,
                manufacturer: true,
                mrp: true,
                gstPercent: true,
                shippingCharges: true,
                variant: {
                  select: {
                    name: true,
                    sku: true,
                    catalogProduct: {
                      select: {
                        images: {
                          select: { url: true },
                        },
                      },
                    },
                  },
                },
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

    // Fallback: Populate images if variant is null
    for (const item of order.items) {
      if (item.sellerOffer && !item.sellerOffer.variant) {
        const cleanName = item.sellerOffer.name.replace(/\.\.\./g, '').trim();
        const catalogProduct = await this.prisma.catalogProduct.findFirst({
          where: {
            name: {
              startsWith: cleanName,
              mode: 'insensitive',
            },
            deletedAt: null,
          },
          include: {
            images: {
              select: { url: true },
            },
          },
        });
        if (catalogProduct && catalogProduct.images.length > 0) {
          (item.sellerOffer as any).variant = {
            catalogProduct: {
              images: catalogProduct.images,
            },
          };
        }
      }
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
        createdAt: {},
      };
      if (dateFrom) where.order.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.order.createdAt.lte = new Date(dateTo);
    }

    // Fetch order items belonging to this seller, grouped by order
    const orderItems = await this.prisma.orderItem.findMany({
      where,
      include: {
        sellerOffer: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            mrp: true,
            variant: {
              select: {
                catalogProduct: {
                  select: {
                    images: {
                      select: { url: true },
                    },
                  },
                },
              },
            },
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
        product: item.sellerOffer,
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
      throw new ForbiddenException('You do not have any items in this order');
    }

    // 3. Fetch current order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        buyer: {
          select: {
            phone: true,
            email: true,
            buyerProfile: { select: { legalName: true } },
          },
        },
        address: true,
        items: {
          include: { sellerOffer: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // 4. Validate status transition
    const validTransitions: Record<string, string[]> = {
      PLACED: ['ACCEPTED', 'CANCELLED'],
      ACCEPTED: ['PAYMENT_RECEIVED', 'READY_TO_SHIP', 'CANCELLED'],
      PAYMENT_RECEIVED: [
        'READY_TO_SHIP',
        'DISPATCHED_FROM_SELLER',
        'CANCELLED',
      ],
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

    const updateData: any = { orderStatus: dto.status as OrderStatus };

    // Push to Shiprocket if status is READY_TO_SHIP and it hasn't been pushed yet
    if (dto.status === OrderStatus.READY_TO_SHIP && !order.shiprocketOrderId) {
      try {
        const payload = {
          order_id: order.id,
          order_date: order.createdAt
            .toISOString()
            .replace('T', ' ')
            .substring(0, 16),
          pickup_location: 'Primary',
          billing_customer_name:
            order.address?.name ||
            order.buyer.buyerProfile?.legalName ||
            'Buyer',
          billing_last_name: '',
          billing_address: order.address?.address || 'Address',
          billing_city: order.address?.city || 'City',
          billing_pincode: order.address?.pincode || '110001',
          billing_state: order.address?.state || 'State',
          billing_country: 'India',
          billing_email: order.buyer.email || 'no-reply@yukizi.com',
          billing_phone:
            order.buyer.phone || order.address?.phone || '9999999999',
          shipping_is_billing: true,
          order_items: order.items.map((item) => ({
            name: item.sellerOffer.name,
            sku: item.sellerOffer.id.substring(0, 8), // placeholder sku
            units: item.quantity,
            selling_price: item.unitPrice,
            discount: 0,
            tax: 0,
            hsn: null,
          })),
          payment_method: order.paymentStatus === 'SUCCESS' ? 'Prepaid' : 'COD',
          sub_total: order.totalAmount,
          length: 10, // Defaults, should be mapped from product in real scenario
          breadth: 10,
          height: 10,
          weight: 1, // 1 kg default
        };

        const shiprocketData =
          await this.shiprocketService.createOrder(payload);

        // Update data with Shiprocket fields
        updateData.shiprocketOrderId = shiprocketData.order_id?.toString();
        updateData.shipmentId = shiprocketData.shipment_id?.toString();
        updateData.awbCode = shiprocketData.awb_code?.toString();
        updateData.courierName = shiprocketData.courier_name?.toString();

        this.logger.log(
          `Order ${orderId} pushed to Shiprocket: ${shiprocketData.shipment_id}`,
        );
      } catch (error: any) {
        this.logger.error(
          `Failed to push order to Shiprocket: ${error.message}`,
        );
        // Not failing the transition if Shiprocket fails, or we could throw error.
        // For robustness we allow transition but log error.
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: updateData,
      include: {
        items: {
          include: {
            sellerOffer: {
              select: { 
                id: true, 
                name: true, 
                category: true,
                variant: {
                  include: {
                    catalogProduct: true,
                  },
                },
              },
            },
          },
        },
        address: true,
      },
    });

    // Create settlements if status is DELIVERED and payment is successful
    if (
      updated.orderStatus === OrderStatus.DELIVERED &&
      updated.paymentStatus === PaymentStatus.SUCCESS
    ) {
        for (const item of updated.items) {
          const existing = await this.prisma.sellerSettlement.findUnique({
            where: { orderItemId: item.id },
          });
            if (!existing) {
              const catalogProduct = (item.sellerOffer as any)?.variant?.catalogProduct;
              
              const commissionPercent = catalogProduct?.commissionPercent ?? 0;
              const fixedFee = catalogProduct?.fixedFee ?? 0;
              const commissionGstPercent = catalogProduct?.commissionGstPercent ?? 18;
              const fixedFeeGstPercent = catalogProduct?.fixedFeeGstPercent ?? 18;

            const commissionAmount = +(item.totalPrice * (commissionPercent / 100)).toFixed(2);
            const commissionGst = +(commissionAmount * (commissionGstPercent / 100)).toFixed(2);
            const fixedFeeGst = +(fixedFee * (fixedFeeGstPercent / 100)).toFixed(2);

            const totalPlatformFees = commissionAmount + commissionGst + fixedFee + fixedFeeGst;
            const sellerPayout = +(item.totalPrice - totalPlatformFees).toFixed(2);

            await this.prisma.sellerSettlement.create({
              data: {
                sellerId: item.sellerId,
                orderItemId: item.id,
                amount: sellerPayout,
                commission: commissionAmount,
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
  // UPDATE SHIPPING DETAILS (Seller)
  // ──────────────────────────────────────────────

  async updateShippingDetails(
    userId: string,
    orderId: string,
    dto: UpdateShippingDetailsDto,
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
      throw new ForbiddenException('You do not have any items in this order');
    }

    // 3. Fetch current order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // 4. Update the order with shipping details
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: dto,
    });

    this.logger.log(
      `Order ${orderId} shipping details updated by seller ${seller.id}`,
    );

    return updated;
  }

  // ──────────────────────────────────────────────
  // UPDATE ADMIN SHIPPING DOCS (Admin)
  // ──────────────────────────────────────────────
  async updateAdminShippingDocs(
    orderId: string,
    dto: { adminShippingLabelUrl?: string; adminInvoiceUrl?: string },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!order.packageLength) {
      throw new BadRequestException('Seller has not provided package details yet');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: dto,
    });

    this.logger.log(`Order ${orderId} admin shipping docs updated`);
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
            sellerOffer: {
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
      throw new ForbiddenException(
        'You do not have permission to cancel this order',
      );
    }

    // 3. Status validation
    const uncancelable: OrderStatus[] = [
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
      OrderStatus.RETURNED,
      OrderStatus.CANCELLED,
    ];
    if (uncancelable.includes(order.orderStatus)) {
      throw new BadRequestException(
        `Cannot cancel order in ${order.orderStatus} status`,
      );
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
        if (item.sellerOffer.batches.length > 0) {
          await tx.productBatch.update({
            where: { id: item.sellerOffer.batches[0].id },
            data: { stock: { increment: item.quantity } },
          });

          // Check if there are waitlisted users to notify
          const offerWithVariant = await tx.sellerOffer.findUnique({
            where: { id: item.sellerOffer.id },
            include: { variant: true },
          });
          const catalogProductId = offerWithVariant?.variant?.catalogProductId;

          if (catalogProductId) {
            const waitlisted = await tx.productWaitlist.findMany({
              where: { catalogProductId, isNotified: false },
              include: { catalogProduct: true },
            });

            if (waitlisted.length > 0) {
              const notifications = waitlisted.map((w) => ({
                userId: w.userId,
                message: `The product ${w.catalogProduct.name} you were waiting for is now back in stock!`,
              }));

              await tx.notification.createMany({ data: notifications });

              await tx.productWaitlist.updateMany({
                where: { id: { in: waitlisted.map((w) => w.id) } },
                data: { isNotified: true },
              });
            }
          }
        }
      }

      return cancelled;
    });

    this.logger.log(`Order ${orderId} was cancelled by ${role} ${userId}`);
    return updated;
  }
}
