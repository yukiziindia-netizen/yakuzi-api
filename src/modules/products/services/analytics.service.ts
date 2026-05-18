import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Internal product analytics service.
 * Tracks views, orders, and timestamps for trending/recommendation logic.
 * NOT exposed as public API — called internally by ProductsService.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Initialise an analytics entry when a product is created.
   */
  async initialise(productId: string) {
    try {
      await this.prisma.productAnalytics.create({
        data: { productId },
      });
      this.logger.debug(`Analytics initialised for product ${productId}`);
    } catch (error) {
      this.logger.error(
        `Failed to initialise analytics for product ${productId}: ${error}`,
      );
    }
  }

  /**
   * Record a product view. Called when product detail is fetched.
   * Fire-and-forget — failures are logged but don't propagate.
   */
  async recordView(productId: string) {
    try {
      await this.prisma.productAnalytics.upsert({
        where: { productId },
        create: {
          productId,
          views: 1,
          lastViewed: new Date(),
        },
        update: {
          views: { increment: 1 },
          lastViewed: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record view for product ${productId}: ${error}`,
      );
    }
  }

  /**
   * Record a product order (called from order flow in Phase-2+).
   */
  async recordOrder(productId: string) {
    try {
      await this.prisma.productAnalytics.upsert({
        where: { productId },
        create: {
          productId,
          orders: 1,
          lastOrdered: new Date(),
        },
        update: {
          orders: { increment: 1 },
          lastOrdered: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record order for product ${productId}: ${error}`,
      );
    }
  }

  /**
   * Remove analytics entry when a product is deleted.
   */
  async remove(productId: string) {
    try {
      await this.prisma.productAnalytics.delete({
        where: { productId },
      });
    } catch (error) {
      this.logger.error(
        `Failed to remove analytics for product ${productId}: ${error}`,
      );
    }
  }
}
