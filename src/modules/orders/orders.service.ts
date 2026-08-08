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
import { calculateSellerPayout, buildPayoutInputFromOrderItem } from '../settlements/payout-calculator';

/**
 * Fields a seller may still write once the admin has locked shipping.
 *
 * The lock freezes the package dimensions and their proof images so the admin
 * can generate the shipping label against figures that cannot change. The final
 * manifest and the packed-box picture are produced after that, so they stay
 * writable - otherwise the seller can never provide them.
 */
const SELLER_FINAL_DOCUMENT_FIELDS: string[] = [
  'manifestUrl',
  'packedPictureUrl',
];

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shiprocketService: ShiprocketService,
  ) {}

  // ──────────────────────────────────────────────
  // SHIPROCKET PUSH — shared by the seller and admin
  // status-update paths so both actually create the
  // Shiprocket shipment on the READY_TO_SHIP transition.
  // ──────────────────────────────────────────────

  /**
   * Idempotent: no-ops (returns {}) if the order already has a
   * shiprocketOrderId, or if the Shiprocket API call fails — a failed push
   * must never block the order status transition itself.
   */
  async pushOrderToShiprocketIfNeeded(order: {
    id: string;
    createdAt: Date;
    totalAmount: unknown;
    paymentStatus: PaymentStatus;
    shiprocketOrderId: string | null;
    packageLength?: number | null;
    packageBreadth?: number | null;
    packageHeight?: number | null;
    packageWeight?: number | null;
    address: {
      name?: string | null;
      address?: string | null;
      city?: string | null;
      pincode?: string | null;
      state?: string | null;
      phone?: string | null;
    } | null;
    buyer: {
      email?: string | null;
      phone?: string | null;
      buyerProfile?: { legalName?: string | null } | null;
    };
    items: Array<{
      quantity: number;
      unitPrice: unknown;
      sellerOffer: { id: string; name: string };
    }>;
  }): Promise<{
    shiprocketOrderId?: string;
    shipmentId?: string;
    awbCode?: string;
    courierName?: string;
  }> {
    if (order.shiprocketOrderId) {
      return {};
    }

    // Real package dimensions come from the seller's own submission
    // (updateShippingDetails). Fall back to placeholder measurements only
    // if the seller hasn't submitted any yet, so admin is never blocked
    // from pushing an order — but log it, since the resulting label will
    // under/over-charge the actual courier cost.
    const hasRealDimensions =
      order.packageLength != null &&
      order.packageBreadth != null &&
      order.packageHeight != null &&
      order.packageWeight != null;

    if (!hasRealDimensions) {
      this.logger.warn(
        `Order ${order.id} pushed to Shiprocket without seller-submitted dimensions — using placeholder 10x10x10cm/1kg`,
      );
    }

    try {
      // The pickup-address nickname isn't configurable in code — Shiprocket's
      // UI only offers a fixed set of tags (Home/Work/Warehouse/Other), so a
      // hardcoded "Primary" silently matches nothing. Resolve whatever is
      // actually configured on the account instead.
      const pickupLocation =
        await this.shiprocketService.getPrimaryPickupLocation();

      const payload = {
        order_id: order.id,
        order_date: order.createdAt
          .toISOString()
          .replace('T', ' ')
          .substring(0, 16),
        pickup_location: pickupLocation,
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
        length: order.packageLength ?? 10,
        breadth: order.packageBreadth ?? 10,
        height: order.packageHeight ?? 10,
        weight: order.packageWeight ?? 1,
      };

      const shiprocketData = await this.shiprocketService.createOrder(
        payload,
      );

      this.logger.log(
        `Order ${order.id} pushed to Shiprocket: ${shiprocketData.shipment_id}`,
      );

      return {
        shiprocketOrderId: shiprocketData.order_id?.toString(),
        shipmentId: shiprocketData.shipment_id?.toString(),
        awbCode: shiprocketData.awb_code?.toString(),
        courierName: shiprocketData.courier_name?.toString(),
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to push order ${order.id} to Shiprocket: ${error.message}`,
      );
      // Not failing the status transition if Shiprocket fails; admin can
      // retry by re-triggering the transition (pushOrderToShiprocketIfNeeded
      // is idempotent on shiprocketOrderId being unset).
      return {};
    }
  }

  /**
   * Writes back AWB/courier from a live Shiprocket tracking response.
   * Called on every GET .../tracking poll so the values the admin sees stay
   * current even though Shiprocket only assigns them once a human manually
   * books the shipment and generates the AWB inside the Shiprocket dashboard
   * — there is no webhook wired up to push that assignment to us.
   */
  async syncTrackingFields(
    orderId: string,
    tracking: { awb_code?: string | null; courier?: string | null },
  ): Promise<void> {
    const data: { awbCode?: string; courierName?: string } = {};
    if (tracking.awb_code) data.awbCode = tracking.awb_code;
    if (tracking.courier) data.courierName = tracking.courier;
    if (Object.keys(data).length === 0) return;

    try {
      await this.prisma.order.update({ where: { id: orderId }, data });
    } catch (error: any) {
      this.logger.warn(
        `Failed to sync tracking fields for order ${orderId}: ${error.message}`,
      );
    }
  }

  // ──────────────────────────────────────────────
  // CHECKOUT  — Create Order from Cart
  // ──────────────────────────────────────────────

  /**
   * Fill in the buyer's phone and address from what they entered at checkout.
   *
   * Only fills blanks — anything the buyer has already saved is left alone, so
   * placing an order can never quietly rewrite their saved details.
   */
  private async syncBuyerContactDetails(userId: string, dto: CreateOrderDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        phone: true,
        email: true,
        buyerProfile: {
          select: {
            id: true,
            address: true,
            city: true,
            state: true,
            pincode: true,
          },
        },
      },
    });
    if (!user) return;

    const phone = dto.phone?.trim();
    if (!user.phone?.trim() && phone) {
      // User.phone is unique and doubles as a login identifier, so only claim
      // it when no other account holds it. Racing here would surface as P2002
      // and is swallowed by the caller.
      const takenBySomeoneElse = await this.prisma.user.findFirst({
        where: { phone, NOT: { id: userId } },
        select: { id: true },
      });
      if (!takenBySomeoneElse) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { phone },
        });
      }
    }

    const email = dto.email?.trim().toLowerCase();
    if (!user.email?.trim() && email) {
      // User.email is unique and is a login identifier, so only claim it when no
      // other account holds it — the same rule the phone above follows. An
      // existing address is never overwritten: it is a credential, not a
      // preference. Racing here surfaces as P2002 and is swallowed by the caller.
      const takenBySomeoneElse = await this.prisma.user.findFirst({
        where: { email, NOT: { id: userId } },
        select: { id: true },
      });
      if (!takenBySomeoneElse) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { email },
        });
      }
    }

    const profile = user.buyerProfile;
    if (!profile) return;

    const existingAddress =
      profile.address && typeof profile.address === 'object'
        ? (profile.address as Record<string, unknown>)
        : {};
    const hasStreet =
      typeof existingAddress.street1 === 'string' &&
      existingAddress.street1.trim().length > 0;

    const data: Record<string, unknown> = {};

    const street = dto.address?.trim();
    if (!hasStreet && street) {
      // Shape matches what the profile screen reads: { street1, city, state, pincode }
      data.address = {
        ...existingAddress,
        street1: street,
        city: dto.city?.trim() ?? '',
        state: dto.state?.trim() ?? '',
        pincode: dto.pincode?.trim() ?? '',
      };
    }
    if (!profile.city?.trim() && dto.city?.trim()) data.city = dto.city.trim();
    if (!profile.state?.trim() && dto.state?.trim())
      data.state = dto.state.trim();
    if (!profile.pincode?.trim() && dto.pincode?.trim())
      data.pincode = dto.pincode.trim();

    if (Object.keys(data).length === 0) return;

    await this.prisma.buyerProfile.update({
      where: { id: profile.id },
      data,
    });
  }

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

    // 3. Group cart items by seller
    const itemsBySeller = new Map<string, typeof cart.items>();
    for (const item of cart.items) {
      const sellerId = item.sellerOffer.seller.id;
      if (!itemsBySeller.has(sellerId)) {
        itemsBySeller.set(sellerId, []);
      }
      itemsBySeller.get(sellerId)!.push(item);
    }

    // Calculate total amount for all items in cart (for logging/summary)
    const totalAmount = cart.items.reduce(
      (sum, item) => sum + (item.quantity * Number(item.unitPrice)),
      0,
    );

    // 4. Execute transactional checkout (split by seller)
    const order = await this.prisma.$transaction(async (tx) => {
      const createdOrders: any[] = [];

      for (const [sellerId, sellerItems] of itemsBySeller.entries()) {
        const sellerTotalAmount = sellerItems.reduce(
          (sum, item) => sum + (item.quantity * Number(item.unitPrice)),
          0,
        );

        // 4a. Create Order
        const newOrder = await tx.order.create({
          data: {
            buyerId: userId,
            totalAmount: sellerTotalAmount,
            orderStatus: OrderStatus.PLACED,
            referralCodeId: buyerProfile?.referralCodeId || null,
          },
        });

        // 4b. Create OrderItems
        const orderItemsData = sellerItems.map((item) => ({
          orderId: newOrder.id,
          sellerOfferId: item.sellerOfferId,
          sellerId: sellerId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.quantity * Number(item.unitPrice),
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
        for (const item of sellerItems) {
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

        createdOrders.push(newOrder);
      }

      // 4e. Clear buyer cart
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return createdOrders[0];
    });

    // 4f. Carry the checkout details onto the buyer's profile.
    // The buyer types a phone number and address at checkout, but nothing ever
    // copied them anywhere, so "Edit profile" kept offering "Add your phone"
    // and "Add your address" no matter how many orders they had placed.
    // Deliberately outside the transaction and never rethrown: this is a
    // convenience, and it must not be able to roll back an order that the
    // buyer has already paid for and seen confirmed.
    await this.syncBuyerContactDetails(userId, dto).catch((err) => {
      this.logger.warn(
        `Could not copy checkout details to the buyer profile for user ${userId}: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      );
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
                finalShippingPrice: true,
                discountType: true,
                discountMeta: true,
                isTaxIncluded: true,
                catalogProduct: {
                  select: {
                    commissionPercent: true,
                    commissionGstPercent: true,
                    images: {
                      select: { url: true },
                    },
                    category: {
                      select: {
                        commissionPercent: true,
                        commissionGstPercent: true,
                      },
                    },
                    subCategory: {
                      select: {
                        commissionPercent: true,
                        commissionGstPercent: true,
                      },
                    },
                  },
                },
                variant: {
                  select: {
                    name: true,
                    sku: true,
                    catalogProduct: {
                      select: {
                        commissionPercent: true,
                        commissionGstPercent: true,
                        images: {
                          select: { url: true },
                        },
                        category: {
                          select: {
                            commissionPercent: true,
                            commissionGstPercent: true,
                          },
                        },
                        subCategory: {
                          select: {
                            commissionPercent: true,
                            commissionGstPercent: true,
                          },
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
        // Multi-Seller Isolation: Filter order items so seller ONLY sees their own products
        order.items = order.items.filter((item) => item.sellerId === sellerId);

        // Dynamically copy the shipping details from the first item of this seller onto the parent order
        const firstItem = order.items[0];
        if (firstItem) {
          order.packageLength = firstItem.packageLength;
          order.packageBreadth = firstItem.packageBreadth;
          order.packageHeight = firstItem.packageHeight;
          order.packageWeight = firstItem.packageWeight;
          order.lengthImage = firstItem.lengthImage;
          order.breadthImage = firstItem.breadthImage;
          order.heightImage = firstItem.heightImage;
          order.weightImage = firstItem.weightImage;
          order.invoiceUrl = firstItem.invoiceUrl;
          order.manifestUrl = firstItem.manifestUrl;
          order.adminShippingLabelUrl = firstItem.adminShippingLabelUrl;
          order.adminInvoiceUrl = firstItem.adminInvoiceUrl;
          order.packedPictureUrl = firstItem.packedPictureUrl;
          order.isShippingLocked = firstItem.isShippingLocked;
        }
      }
    }

    if (!hasAccess) {
      throw new NotFoundException('Order not found');
    }

    const items = order.items.map((item: any) => {
      let estimatedPayout: any = null;
      if (item.settlement) {
        const comm = Number(item.settlement.commission || 0);
        const commGst = Number(item.settlement.commissionGst || 0);
        const ship = Number(item.sellerOffer?.finalShippingPrice ?? item.sellerOffer?.shippingCharges ?? 0);
        const net = Number(item.settlement.netPayout || item.settlement.amount || 0);
        const gross = Number(item.settlement.grossAmount || item.totalPrice || 0);
        const catalogProd = item.sellerOffer?.catalogProduct ?? item.sellerOffer?.variant?.catalogProduct;
        const commissionPercent = Number(
          catalogProd?.commissionPercent ??
          catalogProd?.subCategory?.commissionPercent ??
          catalogProd?.category?.commissionPercent ??
          item.sellerOffer?.commissionPercent ??
          0
        );
        const commissionGstPercent = Number(
          catalogProd?.commissionGstPercent ??
          catalogProd?.subCategory?.commissionGstPercent ??
          catalogProd?.category?.commissionGstPercent ??
          item.sellerOffer?.commissionGstPercent ??
          18
        );
        estimatedPayout = {
          grossAmount: gross,
          commission: comm,
          commissionGst: commGst,
          finalShippingPrice: ship,
          totalDeductions: comm + commGst + ship,
          netPayout: net,
          commissionPercent,
          commissionGstPercent,
          status: item.settlement.payoutStatus,
          isLedgered: true,
        };
      } else {
        const input = buildPayoutInputFromOrderItem(item);
        const breakdown = calculateSellerPayout(input);
        estimatedPayout = {
          grossAmount: breakdown.grossAmount.toNumber(),
          commission: breakdown.commission.toNumber(),
          commissionGst: breakdown.commissionGst.toNumber(),
          finalShippingPrice: breakdown.finalShippingPrice.toNumber(),
          totalDeductions: breakdown.totalDeductions.toNumber(),
          netPayout: breakdown.netPayout.toNumber(),
          commissionPercent: input.commissionPercent,
          commissionGstPercent: input.commissionGstPercent,
          status: breakdown.status,
          isLedgered: false,
        };
      }
      return {
        ...item,
        estimatedPayout,
      };
    });

    return {
      ...order,
      items,
    };
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
      entry.sellerTotal += Number(item.totalPrice);
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
    if (dto.status === OrderStatus.READY_TO_SHIP) {
      Object.assign(
        updateData,
        await this.pushOrderToShiprocketIfNeeded(order),
      );
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
                finalShippingPrice: true,
                shippingCharges: true,
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
      await this.prisma.$transaction(async (tx) => {
        for (const item of updated.items) {
          const existing = await tx.sellerSettlement.findUnique({
            where: { orderItemId: item.id },
          });
          if (!existing) {
            const sellerOffer = item.sellerOffer;
            const catalogProduct = sellerOffer?.variant?.catalogProduct;
            
            const baseSellingPrice = Number(item.unitPrice);
            const quantity = item.quantity;
            const finalShippingPrice = item.sellerOffer?.finalShippingPrice ? Number(item.sellerOffer.finalShippingPrice) : (item.sellerOffer?.shippingCharges ? Number(item.sellerOffer.shippingCharges) : 0);
            
            const commissionPercent = catalogProduct?.commissionPercent ? Number(catalogProduct.commissionPercent) : 0;
            const commissionGstPercent = catalogProduct?.commissionGstPercent ? Number(catalogProduct.commissionGstPercent) : 18;

            const breakdown = calculateSellerPayout({
              baseSellingPrice,
              quantity,
              finalShippingPrice,
              commissionPercent,
              commissionGstPercent,
            });

            await tx.sellerSettlement.create({
              data: {
                sellerId: item.sellerId,
                orderItemId: item.id,
                amount: breakdown.netPayout.toDecimalPlaces(2).toString(),
                grossAmount: breakdown.grossAmount.toString(),
                commission: breakdown.commission.toString(),
                commissionGst: breakdown.commissionGst.toString(),
                fixedFee: '0',
                fixedFeeGst: '0',
                withholdingTax: '0',
                netPayout: breakdown.netPayout.toString(),
                payoutStatus: breakdown.status,
              },
            });
          }
        }
      });
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

    // 3. Check if shipping is locked for this seller's items.
    //
    // The lock exists so the admin can freeze the package dimensions and proof
    // images before generating the shipping label. Uploading the final manifest
    // and the packed-box picture happens AFTER that point, so blocking those two
    // fields as well left the seller with no way to ever supply them: the portal
    // hides the upload controls and this endpoint rejects the write.
    //
    // Dimensions and proofs stay frozen; the final documents remain accepted.
    const isLocked = sellerItems.some((item) => item.isShippingLocked);
    if (isLocked) {
      const submittedFields = Object.keys(dto).filter(
        (key) => (dto as Record<string, unknown>)[key] !== undefined,
      );
      const frozenFields = submittedFields.filter(
        (key) => !SELLER_FINAL_DOCUMENT_FIELDS.includes(key),
      );

      if (frozenFields.length > 0) {
        throw new ForbiddenException(
          `Shipping details are locked by admin. Only ${SELLER_FINAL_DOCUMENT_FIELDS.join(
            ' and ',
          )} can still be updated (rejected: ${frozenFields.join(', ')}).`,
        );
      }
    }

    // 4. Update all order items for this seller in this order
    await this.prisma.orderItem.updateMany({
      where: { orderId, sellerId: seller.id },
      data: dto as any,
    });

    // Also update the parent order table for compatibility/fallback
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
    dto: { 
      adminShippingLabelUrl?: string; 
      adminInvoiceUrl?: string;
      manifestUrl?: string;
      invoiceUrl?: string;
      isShippingLocked?: boolean;
      sellerId?: string;
    },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const { sellerId, ...updateFields } = dto;

    if (sellerId) {
      // Update only order items for this seller
      await this.prisma.orderItem.updateMany({
        where: { orderId, sellerId },
        data: updateFields as any,
      });

      // Also update the parent order table if this is the only seller or as fallback
      const uniqueSellers = Array.from(new Set(order.items.map(i => i.sellerId)));
      if (uniqueSellers.length === 1 || uniqueSellers[0] === sellerId) {
        await this.prisma.order.update({
          where: { id: orderId },
          data: updateFields,
        });
      }
    } else {
      // Check if any seller has provided package details (or if it's only lock status changes)
      const anyPackageProvided = order.items.some(item => item.packageLength != null) || order.packageLength != null;
      if (!anyPackageProvided && Object.keys(updateFields).some(k => k !== 'isShippingLocked')) {
        throw new BadRequestException('Seller has not provided package details yet');
      }

      await this.prisma.order.update({
        where: { id: orderId },
        data: updateFields,
      });

      // Update the corresponding order items so they reflect the admin documents
      const itemsWithPackage = order.items.filter(item => item.packageLength != null);
      if (itemsWithPackage.length > 0) {
        const sellerIds = Array.from(new Set(itemsWithPackage.map(item => item.sellerId)));
        await this.prisma.orderItem.updateMany({
          where: { orderId, sellerId: { in: sellerIds } },
          data: updateFields as any,
        });
      } else {
        await this.prisma.orderItem.updateMany({
          where: { orderId },
          data: updateFields as any,
        });
      }
    }

    this.logger.log(`Order ${orderId} admin shipping docs updated`);
    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { seller: true } } }
    });
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
