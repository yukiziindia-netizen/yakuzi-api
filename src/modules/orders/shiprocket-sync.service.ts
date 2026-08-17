import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ShiprocketService } from './shiprocket.service';
import { OrdersService } from './orders.service';
import { mapShiprocketStatus, isForwardStatusMove } from './shiprocket-status-map';

interface PollableOrder {
  id: string;
  shiprocketOrderId: string | null;
  orderStatus: OrderStatus;
}

/**
 * Keeps Order.orderStatus in sync with Shiprocket's own tracking status for every
 * order that's been pushed to Shiprocket (shiprocketOrderId set) and isn't
 * yet in a terminal state. Runs every 30 minutes — order volume on this
 * project is low enough that polling stays well under Shiprocket's rate
 * limits without needing a webhook. See
 * docs/superpowers/specs/2026-08-17-shiprocket-status-sync-design.md.
 */
@Injectable()
export class ShiprocketSyncService {
  private readonly logger = new Logger(ShiprocketSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shiprocketService: ShiprocketService,
    private readonly ordersService: OrdersService,
  ) {}

  @Cron('*/30 * * * *')
  async handleCron(): Promise<void> {
    await this.syncInFlightOrders();
  }

  async syncInFlightOrders(): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: {
        shiprocketOrderId: { not: null },
        orderStatus: {
          notIn: [
            OrderStatus.DELIVERED,
            OrderStatus.RETURNED,
            OrderStatus.CANCELLED,
          ],
        },
      },
      select: { id: true, shiprocketOrderId: true, orderStatus: true },
    });

    // Intentionally sequential (not Promise.all) — avoids tripping
    // Shiprocket's rate limits by hammering their API with concurrent
    // requests.
    for (const order of orders) {
      await this.syncOneOrder(order);
    }
  }

  async syncOneOrder(order: PollableOrder): Promise<void> {
    if (!order.shiprocketOrderId) return;

    let tracking: Awaited<ReturnType<ShiprocketService['trackOrder']>>;
    try {
      tracking = await this.shiprocketService.trackOrder(
        order.shiprocketOrderId,
      );
    } catch (error: any) {
      this.logger.warn(
        `Shiprocket tracking failed for order ${order.id}: ${error?.message}`,
      );
      return;
    }

    const mapped = mapShiprocketStatus(tracking.current_status);
    if (!mapped) {
      if (tracking.current_status) {
        this.logger.warn(
          `Unrecognized Shiprocket status "${tracking.current_status}" for order ${order.id}`,
        );
      }
      return;
    }

    if (!isForwardStatusMove(order.orderStatus, mapped)) {
      return;
    }

    try {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { orderStatus: mapped },
      });

      await this.ordersService.syncTrackingFields(order.id, {
        awb_code: tracking.awb_code,
        courier: tracking.courier,
      });
    } catch (error: any) {
      this.logger.warn(
        `Failed to apply Shiprocket status update for order ${order.id}: ${error?.message}`,
      );
    }
  }
}
