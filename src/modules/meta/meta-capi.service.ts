import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../database/prisma.service';
import { MetaConfigService } from './meta.config';
import { buildPurchaseEvent, buildRequestBody } from './meta-capi.payload';

const GRAPH_VERSION = 'v21.0';

/**
 * Sends events to Meta's Conversions API — the server-side half of the Pixel.
 *
 * It matters most for Purchase: the browser Pixel misses a large and growing
 * share of conversions to ad-blockers and iOS/Safari privacy, and Purchase is
 * the event Meta's ad optimisation runs on. This fires from the payment
 * confirmation on the server, so it lands even when the browser Pixel did not.
 * The same event_id (the order id) is sent from both sides so Meta counts the
 * conversion once.
 *
 * Fire-and-forget by contract: confirming a payment must never be slowed,
 * failed or rolled back because an ad event did not send.
 */
@Injectable()
export class MetaCapiService {
  private readonly logger = new Logger(MetaCapiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MetaConfigService,
  ) {}

  trackPurchase(input: { orderId: string; userId: string; amount: number; currency?: string }): void {
    void this.sendPurchase(input).catch((e) =>
      this.logger.error(`meta purchase send failed: ${(e as Error).message}`),
    );
  }

  private async sendPurchase(input: {
    orderId: string;
    userId: string;
    amount: number;
    currency?: string;
  }): Promise<void> {
    const cfg = await this.config.load();
    if (!this.config.canSendServerEvents(cfg)) return;

    // Look up the identifiers Meta matches on. Best-effort — a missing buyer
    // just lowers match quality, it does not stop the event.
    const user = await this.prisma.user
      .findUnique({ where: { id: input.userId }, select: { email: true, phone: true } })
      .catch(() => null);

    const event = buildPurchaseEvent({
      eventId: input.orderId,
      eventTimeSeconds: Math.floor(Date.now() / 1000),
      email: user?.email ?? null,
      phone: user?.phone ?? null,
      userId: input.userId,
      value: input.amount,
      currency: input.currency ?? 'INR',
      sourceUrl: `${cfg.siteUrl}/orders`,
    });

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.accessToken)}`;
    const body = buildRequestBody([event], cfg.testEventCode || null);

    try {
      await axios.post(url, body, { timeout: 15000 });
      this.logger.log(`meta CAPI Purchase sent for order ${input.orderId}`);
    } catch (e) {
      const data = (e as { response?: { data?: { error?: { message?: string } } } }).response?.data;
      throw new Error(data?.error?.message || (e as Error).message);
    }
  }
}
