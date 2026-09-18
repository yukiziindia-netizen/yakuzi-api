import { Controller, Get, Param, Query, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../../database/prisma.service';
import { verifyCartRestore } from './cart-restore.token';
import { storefrontUrl } from '../mail/templates/email-theme';

/**
 * The one-tap "put these back in my cart" link from the payment-recovery
 * email.
 *
 * Deliberately its own controller, with no guards: it is opened from an email
 * client, where the reader very often has no session. The signed token in the
 * query string stands in for one — see cart-restore.token.ts for why that is
 * a safe trade here.
 *
 * Always redirects, never renders. Whatever happens — bad token, deleted
 * order, items long gone — the buyer lands somewhere useful on the storefront
 * rather than looking at an API error, and a failed link tells an outsider
 * nothing about whether the order existed.
 */
@ApiExcludeController()
@Controller('orders')
export class CartRecoveryController {
  private readonly logger = new Logger(CartRecoveryController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get(':orderId/restore-cart')
  // Generous enough for a reader clicking twice, tight enough that the link is
  // not a lever for anything.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async restoreCart(
    @Param('orderId') orderId: string,
    @Query('t') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const home = storefrontUrl();

    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          buyerId: true,
          items: {
            select: {
              quantity: true,
              unitPrice: true,
              sellerOfferId: true,
              sellerOffer: {
                select: { id: true, isActive: true, deletedAt: true },
              },
            },
          },
        },
      });

      if (!order || !verifyCartRestore(order.id, order.buyerId, token)) {
        res.redirect(302, home);
        return;
      }

      // A listing that has since been taken down or deleted is silently left
      // out rather than failing the whole restore — getting three of four
      // items back is better than getting none.
      const restorable = order.items.filter(
        (item) => item.sellerOffer && item.sellerOffer.isActive && !item.sellerOffer.deletedAt,
      );

      if (restorable.length > 0) {
        const cart = await this.prisma.cart.upsert({
          where: { userId: order.buyerId },
          update: {},
          create: { userId: order.buyerId },
          select: { id: true },
        });

        // Set rather than add: clicking the link twice leaves the same cart,
        // not double the quantity.
        for (const item of restorable) {
          await this.prisma.cartItem.upsert({
            where: {
              cartId_sellerOfferId: {
                cartId: cart.id,
                sellerOfferId: item.sellerOfferId,
              },
            },
            update: { quantity: item.quantity, unitPrice: item.unitPrice },
            create: {
              cartId: cart.id,
              sellerOfferId: item.sellerOfferId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            },
          });
        }

        this.logger.log(
          `Restored ${restorable.length}/${order.items.length} item(s) to the cart of buyer ${order.buyerId} from order ${order.id}`,
        );
      }

      res.redirect(302, `${home}/checkout`);
    } catch (error: any) {
      this.logger.warn(
        `Cart restore failed for order ${orderId}: ${error?.message ?? error}`,
      );
      res.redirect(302, home);
    }
  }
}
