import { Injectable, Logger } from '@nestjs/common';
import {
  IntegrationProvider,
  IntegrationStatus,
  InventoryEventStatus,
  InventoryEventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from './encryption.service';
import { ShopifyProvider } from './providers/shopify.provider';
import { WooCommerceProvider } from './providers/woocommerce.provider';

/**
 * Inbound channel events.
 *
 * Two invariants everything here exists to protect:
 *
 *  1. IDEMPOTENCY — a provider that redelivers the same webhook (they all do)
 *     must not move inventory twice. Enforced by a UNIQUE index on
 *     (sourcePlatform, sourceEventId), so the guarantee survives concurrent
 *     deliveries hitting two app instances at once. Application-level "check
 *     then insert" would not.
 *
 *  2. LOOP PREVENTION — when Yukizi sets Shopify to 4, Shopify sends back
 *     "inventory is now 4". That is confirmation, not news. Applying it would
 *     start Yukizi -> Woo -> Amazon -> Shopify all over again. An event whose
 *     quantity already equals what Yukizi believes is recorded and SKIPPED.
 *
 * Both are decided here, at the edge, before anything touches stock.
 */
@Injectable()
export class IntegrationWebhooksService {
  private readonly logger = new Logger(IntegrationWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly shopify: ShopifyProvider,
    private readonly woocommerce: WooCommerceProvider,
  ) {}

  // ── Shopify ───────────────────────────────────────────────────────────────

  async handleShopifyWebhook(input: {
    rawBody?: Buffer;
    hmac?: string;
    shopDomain?: string;
    topic?: string;
    webhookId?: string;
  }): Promise<{ ok: boolean; handled: boolean }> {
    // The signature is the only proof this came from Shopify. Reject before
    // parsing anything.
    if (!this.shopify.verifyWebhookHmac(input.rawBody, input.hmac)) {
      this.logger.warn('Rejected a Shopify webhook with an invalid signature');
      // 200 with handled:false — retrying an unsigned payload will not help,
      // and a 4xx would have Shopify retry it for hours.
      return { ok: false, handled: false };
    }

    const integration = await this.prisma.sellerIntegration.findFirst({
      where: {
        provider: IntegrationProvider.SHOPIFY,
        externalAccountId: input.shopDomain ?? '',
        status: { not: IntegrationStatus.DISCONNECTED },
      },
    });
    if (!integration) return { ok: true, handled: false };

    // app/uninstalled is the one topic that matters before phase 3: it means
    // the access token is dead and the seller must be told, not left with a
    // connection that silently never syncs.
    if (input.topic === 'app/uninstalled') {
      await this.prisma.sellerIntegration.update({
        where: { id: integration.id },
        data: {
          status: IntegrationStatus.EXPIRED,
          encryptedCredentials: null,
          syncEnabled: false,
          lastError:
            'The Yukizi app was removed from this Shopify store. Reconnect to resume syncing.',
          lastErrorAt: new Date(),
        },
      });
      return { ok: true, handled: true };
    }

    const payload = this.parseBody(input.rawBody);
    if (!payload) return { ok: true, handled: false };

    return this.recordInventoryEvent({
      integrationId: integration.id,
      sellerId: integration.sellerId,
      sourcePlatform: IntegrationProvider.SHOPIFY,
      // Shopify's own delivery id. Unique per event, repeated across retries —
      // exactly what idempotency needs.
      sourceEventId: input.webhookId ?? null,
      externalProductId: String(
        payload.inventory_item_id ?? payload.product_id ?? '',
      ),
      externalVariantId: payload.variant_id ? String(payload.variant_id) : null,
      newQuantity:
        typeof payload.available === 'number' ? payload.available : null,
    });
  }

  // ── WooCommerce ───────────────────────────────────────────────────────────

  async handleWooCommerceWebhook(input: {
    rawBody?: Buffer;
    signature?: string;
    source?: string;
    topic?: string;
    webhookId?: string;
    deliveryId?: string;
  }): Promise<{ ok: boolean; handled: boolean }> {
    if (!input.webhookId) return { ok: false, handled: false };

    // Identify the subscription first — the signing secret is per-webhook.
    const subscription = await this.prisma.integrationWebhook.findFirst({
      where: { externalId: String(input.webhookId) },
      include: { integration: true },
    });
    if (!subscription?.integration) return { ok: true, handled: false };
    if (subscription.integration.status === IntegrationStatus.DISCONNECTED) {
      return { ok: true, handled: false };
    }

    const secret = this.encryption.decrypt<{ secret: string }>(
      subscription.encryptedSecret,
    )?.secret;
    if (
      !secret ||
      !this.woocommerce.verifyWebhookSignature(
        input.rawBody,
        input.signature,
        secret,
      )
    ) {
      this.logger.warn(
        'Rejected a WooCommerce webhook with an invalid signature',
      );
      return { ok: false, handled: false };
    }

    const payload = this.parseBody(input.rawBody);
    if (!payload) return { ok: true, handled: false };

    return this.recordInventoryEvent({
      integrationId: subscription.integration.id,
      sellerId: subscription.integration.sellerId,
      sourcePlatform: IntegrationProvider.WOOCOMMERCE,
      // Woo's delivery id changes per attempt, so prefer a stable composite of
      // the webhook and the resource it describes.
      sourceEventId: input.deliveryId
        ? `${input.webhookId}:${input.deliveryId}`
        : null,
      externalProductId: String(payload.id ?? ''),
      externalVariantId: payload.parent_id
        ? String(payload.parent_id)
        : null,
      newQuantity:
        typeof payload.stock_quantity === 'number'
          ? payload.stock_quantity
          : null,
    });
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  private parseBody(rawBody?: Buffer): Record<string, any> | null {
    if (!rawBody?.length) return null;
    try {
      return JSON.parse(rawBody.toString('utf8')) as Record<string, any>;
    } catch {
      this.logger.warn('Webhook body was not valid JSON');
      return null;
    }
  }

  /**
   * Normalises a channel event into the Yukizi ledger.
   *
   * Nothing here mutates stock: it writes the event and lets the phase-3
   * processor act on it. Recording first is what makes the whole system
   * replayable and auditable — and what lets an unmapped listing produce a
   * visible "needs attention" row instead of a silently dropped update.
   */
  private async recordInventoryEvent(input: {
    integrationId: string;
    sellerId: string;
    sourcePlatform: IntegrationProvider;
    sourceEventId: string | null;
    externalProductId: string;
    externalVariantId: string | null;
    newQuantity: number | null;
  }): Promise<{ ok: boolean; handled: boolean }> {
    if (!input.externalProductId || input.newQuantity === null) {
      return { ok: true, handled: false };
    }

    const mapping = await this.prisma.integrationProductMapping.findFirst({
      where: {
        integrationId: input.integrationId,
        externalProductId: input.externalProductId,
        ...(input.externalVariantId
          ? { externalVariantId: input.externalVariantId }
          : {}),
      },
    });

    // LOOP BREAKER: an event that reports the quantity Yukizi last wrote is
    // the echo of our own update. Record it (so the trail is complete) but
    // mark it skipped so no outbound sync is triggered.
    const isEcho = await this.isEchoOfOurWrite(
      mapping?.id,
      input.newQuantity,
    );

    const status = isEcho
      ? InventoryEventStatus.SKIPPED
      : mapping
        ? InventoryEventStatus.PENDING
        : InventoryEventStatus.SKIPPED;

    const skipReason = isEcho
      ? 'ECHO_OF_OUR_WRITE'
      : mapping
        ? null
        : 'NO_MAPPING';

    const data: Prisma.InventoryEventUncheckedCreateInput = {
      sellerId: input.sellerId,
      integrationId: input.integrationId,
      mappingId: mapping?.id ?? null,
      sellerOfferId: mapping?.sellerOfferId ?? null,
      sourcePlatform: input.sourcePlatform,
      sourceEventId: input.sourceEventId,
      eventType: InventoryEventType.EXTERNAL_INVENTORY_CHANGE,
      status,
      skipReason,
      newQuantity: input.newQuantity,
      processedAt: status === InventoryEventStatus.SKIPPED ? new Date() : null,
    };

    try {
      await this.prisma.inventoryEvent.create({ data });
      return { ok: true, handled: status !== InventoryEventStatus.SKIPPED };
    } catch (error) {
      // P2002 = the unique index rejected a duplicate (sourcePlatform,
      // sourceEventId). That is a redelivery, and the correct response is a
      // calm 200: the event is already recorded exactly once.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { ok: true, handled: false };
      }
      throw error;
    }
  }

  /**
   * True when the incoming quantity equals the one Yukizi most recently pushed
   * to this channel for this listing.
   *
   * Only the latest outbound write is considered: an older matching value is
   * coincidence, not an echo.
   */
  private async isEchoOfOurWrite(
    mappingId: string | undefined,
    incomingQuantity: number,
  ): Promise<boolean> {
    if (!mappingId) return false;

    const lastOutbound = await this.prisma.inventoryEvent.findFirst({
      where: {
        mappingId,
        sourcePlatform: 'YUKIZI',
        idempotencyKey: { not: null },
      },
      orderBy: { receivedAt: 'desc' },
      select: { newQuantity: true },
    });

    return (
      lastOutbound !== null && lastOutbound.newQuantity === incomingQuantity
    );
  }
}
