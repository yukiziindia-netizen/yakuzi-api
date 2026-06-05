import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────
  // ADD TO CART
  // ──────────────────────────────────────────────

  async addToCart(userId: string, dto: AddToCartDto) {
    const { sellerOfferId, quantity } = dto;

    // 1. Validate product exists, is active, and not soft-deleted
    const sellerOffer = await this.prisma.sellerOffer.findFirst({
      where: { id: sellerOfferId, isActive: true, deletedAt: null },
      include: {
        seller: { select: { id: true, verificationStatus: true } },
        batches: { where: { stock: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
      },
    });

    if (!sellerOffer) {
      throw new NotFoundException('Product not found or is no longer available');
    }

    // 2. Ensure seller is verified
    if (sellerOffer.seller.verificationStatus !== 'VERIFIED') {
      throw new BadRequestException('This product\'s seller is not verified');
    }

    // 3. Validate minimum order quantity
    if (quantity < sellerOffer.minimumOrderQuantity) {
      throw new BadRequestException(
        `Minimum order quantity for this product is ${sellerOffer.minimumOrderQuantity}`,
      );
    }

    // 4. Validate maximum order quantity
    if (sellerOffer.maximumOrderQuantity && quantity > sellerOffer.maximumOrderQuantity) {
      throw new BadRequestException(
        `Maximum order quantity for this product is ${sellerOffer.maximumOrderQuantity}`,
      );
    }

    // 5. Validate stock availability across all batches
    const totalStock = sellerOffer.batches.reduce((sum, b) => sum + b.stock, 0);
    if (quantity > totalStock) {
      throw new BadRequestException(
        `Insufficient stock. Only ${totalStock} units available`,
      );
    }

    // 6. Get or create cart
    let cart = await this.prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { userId },
      });
      this.logger.log(`Cart created for user ${userId}`);
    }

    // 7. Check for duplicate product in cart
    const existingItem = await this.prisma.cartItem.findUnique({
      where: { cartId_sellerOfferId: { cartId: cart.id, sellerOfferId } },
    });

    if (existingItem) {
      throw new BadRequestException(
        'Product already in cart. Use PATCH /api/cart/item/:id to update quantity.',
      );
    }

    // 8. Snapshot the unit price (MRP)
    const unitPrice = sellerOffer.mrp;

    // 9. Create cart item
    const cartItem = await this.prisma.cartItem.create({
      data: {
        cartId: cart.id,
        sellerOfferId,
        quantity,
        unitPrice,
      },
      include: {
        sellerOffer: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            mrp: true,
            minimumOrderQuantity: true,
            maximumOrderQuantity: true,
          },
        },
      },
    });

    this.logger.log(`Item added to cart: product ${sellerOfferId}, qty ${quantity}`);

    return {
      ...cartItem,
      totalPrice: cartItem.quantity * cartItem.unitPrice,
    };
  }

  // ──────────────────────────────────────────────
  // GET CART
  // ──────────────────────────────────────────────

  async getCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
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
                minimumOrderQuantity: true,
                maximumOrderQuantity: true,
                isActive: true,
                deletedAt: true,
                
                seller: {
                  select: {
                    id: true,
                    companyName: true,
                    city: true,
                    state: true,
                    rating: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      return {
        cartId: cart?.id ?? null,
        items: [],
        totalAmount: 0,
      };
    }

    const items = cart.items.map((item) => ({
      id: item.id,
      sellerOffer: item.sellerOffer,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.quantity * item.unitPrice,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    const totalAmount = items.reduce((sum, item) => sum + item.totalPrice, 0);

    return {
      cartId: cart.id,
      items,
      totalAmount,
    };
  }

  // ──────────────────────────────────────────────
  // UPDATE CART ITEM QUANTITY
  // ──────────────────────────────────────────────

  async updateCartItem(userId: string, cartItemId: string, dto: UpdateCartItemDto) {
    const { quantity } = dto;

    // 1. Find the cart item and verify ownership
    const cartItem = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: {
        cart: { select: { userId: true } },
        sellerOffer: {
          include: {
            batches: { where: { stock: { gt: 0 } } },
          },
        },
      },
    });

    if (!cartItem) {
      throw new NotFoundException('Cart item not found');
    }

    if (cartItem.cart.userId !== userId) {
      throw new NotFoundException('Cart item not found');
    }

    // 2. Validate product is still active
    if (!cartItem.sellerOffer.isActive || cartItem.sellerOffer.deletedAt) {
      throw new BadRequestException('This product is no longer available');
    }

    // 3. Validate minimum order quantity
    if (quantity < cartItem.sellerOffer.minimumOrderQuantity) {
      throw new BadRequestException(
        `Minimum order quantity for this product is ${cartItem.sellerOffer.minimumOrderQuantity}`,
      );
    }

    // 4. Validate maximum order quantity
    if (cartItem.sellerOffer.maximumOrderQuantity && quantity > cartItem.sellerOffer.maximumOrderQuantity) {
      throw new BadRequestException(
        `Maximum order quantity for this product is ${cartItem.sellerOffer.maximumOrderQuantity}`,
      );
    }

    // 5. Validate stock
    const totalStock = cartItem.sellerOffer.batches.reduce((sum, b) => sum + b.stock, 0);
    if (quantity > totalStock) {
      throw new BadRequestException(
        `Insufficient stock. Only ${totalStock} units available`,
      );
    }

    // 6. Update quantity
    const updated = await this.prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity },
      include: {
        sellerOffer: {
          select: {
            id: true,
            name: true,
            manufacturer: true,
            mrp: true,
            minimumOrderQuantity: true,
            maximumOrderQuantity: true,
          },
        },
      },
    });

    this.logger.log(`Cart item ${cartItemId} quantity updated to ${quantity}`);

    return {
      ...updated,
      totalPrice: updated.quantity * updated.unitPrice,
    };
  }

  // ──────────────────────────────────────────────
  // REMOVE SINGLE ITEM
  // ──────────────────────────────────────────────

  async removeCartItem(userId: string, cartItemId: string) {
    // Verify ownership
    const cartItem = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { cart: { select: { userId: true } } },
    });

    if (!cartItem) {
      throw new NotFoundException('Cart item not found');
    }

    if (cartItem.cart.userId !== userId) {
      throw new NotFoundException('Cart item not found');
    }

    await this.prisma.cartItem.delete({
      where: { id: cartItemId },
    });

    this.logger.log(`Cart item ${cartItemId} removed`);
    return { message: 'Item removed from cart' };
  }

  // ──────────────────────────────────────────────
  // CLEAR ENTIRE CART
  // ──────────────────────────────────────────────

  async clearCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      return { message: 'Cart is already empty' };
    }

    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    this.logger.log(`Cart cleared for user ${userId}`);
    return { message: 'Cart cleared successfully' };
  }
}
