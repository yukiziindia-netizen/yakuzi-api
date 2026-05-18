import { Injectable, Logger } from '@nestjs/common';
import { AlertType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Internal inventory management service.
 * Handles batch-level stock, expiry intelligence, and inventory alerts.
 * NOT exposed as public API — called internally by ProductsService.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  /** Near-expiry threshold: 90 days */
  private readonly NEAR_EXPIRY_DAYS = 90;
  /** Low-stock threshold */
  private readonly LOW_STOCK_THRESHOLD = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a default batch when a product is created (Phase-1 compatibility).
   * Phase-2+ will allow multiple batches per product.
   */
  async createDefaultBatch(
    productId: string,
    stock: number,
    expiryDate: string,
  ) {
    const batch = await this.prisma.productBatch.create({
      data: {
        productId,
        batchNumber: 'DEFAULT',
        stock,
        expiryDate: new Date(expiryDate),
      },
    });

    this.logger.debug(
      `Default batch created for product ${productId}: stock=${stock}`,
    );

    // Fire-and-forget: check alerts for the new batch
    this.checkBatchAlerts(productId, batch.id, stock, new Date(expiryDate));

    return batch;
  }

  /**
   * Update the default batch stock/expiry (Phase-1 compatibility).
   */
  async updateDefaultBatch(
    productId: string,
    stock?: number,
    expiryDate?: string,
  ) {
    const existing = await this.prisma.productBatch.findFirst({
      where: { productId, batchNumber: 'DEFAULT' },
    });

    if (!existing) {
      this.logger.warn(
        `No default batch found for product ${productId}, creating one`,
      );
      return this.createDefaultBatch(
        productId,
        stock ?? 0,
        expiryDate ?? new Date(Date.now() + 365 * 86400000).toISOString(),
      );
    }

    const updateData: Record<string, unknown> = {};
    if (stock !== undefined) updateData.stock = stock;
    if (expiryDate !== undefined) updateData.expiryDate = new Date(expiryDate);

    const batch = await this.prisma.productBatch.update({
      where: { id: existing.id },
      data: updateData,
    });

    this.logger.debug(
      `Default batch updated for product ${productId}: stock=${batch.stock}`,
    );

    // Fire-and-forget: re-check alerts
    this.checkBatchAlerts(
      productId,
      batch.id,
      batch.stock,
      batch.expiryDate,
    );

    return batch;
  }

  /**
   * Get aggregated stock across all batches for a product.
   */
  async getTotalStock(productId: string): Promise<number> {
    const result = await this.prisma.productBatch.aggregate({
      where: { productId },
      _sum: { stock: true },
    });
    return result._sum.stock ?? 0;
  }

  /**
   * Get the nearest expiry date across all batches.
   */
  async getNearestExpiry(productId: string): Promise<Date | null> {
    const batch = await this.prisma.productBatch.findFirst({
      where: { productId, stock: { gt: 0 } },
      orderBy: { expiryDate: 'asc' },
      select: { expiryDate: true },
    });
    return batch?.expiryDate ?? null;
  }

  /**
   * Check batch and generate inventory alerts if thresholds are breached.
   * Runs asynchronously — failures are logged but don't propagate.
   */
  private async checkBatchAlerts(
    productId: string,
    batchId: string,
    stock: number,
    expiryDate: Date,
  ) {
    try {
      const alerts: { alertType: AlertType; message: string }[] = [];

      // Out-of-stock / low-stock check
      if (stock === 0) {
        alerts.push({
          alertType: AlertType.OUT_OF_STOCK,
          message: 'Batch is out of stock',
        });
      } else if (stock <= this.LOW_STOCK_THRESHOLD) {
        alerts.push({
          alertType: AlertType.OUT_OF_STOCK,
          message: `Low stock: only ${stock} units remaining`,
        });
      }

      // Near-expiry check
      const daysUntilExpiry = Math.floor(
        (expiryDate.getTime() - Date.now()) / 86400000,
      );
      if (daysUntilExpiry <= 0) {
        alerts.push({
          alertType: AlertType.NEAR_EXPIRY,
          message: 'Batch has expired',
        });
      } else if (daysUntilExpiry <= this.NEAR_EXPIRY_DAYS) {
        alerts.push({
          alertType: AlertType.NEAR_EXPIRY,
          message: `Batch expires in ${daysUntilExpiry} days`,
        });
      }

      if (alerts.length > 0) {
        await this.prisma.inventoryAlert.createMany({
          data: alerts.map((a) => ({
            productId,
            batchId,
            alertType: a.alertType,
            message: a.message,
          })),
        });
        this.logger.log(
          `Created ${alerts.length} inventory alert(s) for product ${productId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to check batch alerts for product ${productId}: ${error}`,
      );
    }
  }
}
