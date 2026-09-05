import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  IntegrationLogStatus,
  IntegrationProvider,
  IntegrationStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from './encryption.service';
import { IntegrationsService } from './integrations.service';
import { IntegrationOAuthService } from './integration-oauth.service';
import { ShopifyProvider } from './providers/shopify.provider';
import { WooCommerceProvider } from './providers/woocommerce.provider';
import { AmazonProvider } from './providers/amazon.provider';

/**
 * Periodic connection health check.
 *
 * The failure this prevents: a seller revokes the app on Shopify, or an Amazon
 * refresh token is invalidated, and Yukizi keeps showing "Connected" while
 * silently syncing nothing. Sellers should be told to reconnect, not left to
 * discover it from stale stock.
 *
 * Follows the repo's existing background-work pattern (@Cron on an injectable
 * service, same as CheckoutAbandonmentSweepService) rather than introducing a
 * queue runtime that nothing else here uses.
 */
@Injectable()
export class IntegrationHealthService {
  private readonly logger = new Logger(IntegrationHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly integrations: IntegrationsService,
    private readonly oauthService: IntegrationOAuthService,
    private readonly shopify: ShopifyProvider,
    private readonly woocommerce: WooCommerceProvider,
    private readonly amazon: AmazonProvider,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.checkConnections();
    const pruned = await this.oauthService.pruneExpiredStates();
    if (pruned > 0) {
      this.logger.log(`Pruned ${pruned} expired integration OAuth states`);
    }
  }

  /**
   * Probes every live connection. Public so it can be called directly from
   * tests and from an admin trigger later, matching the cron convention used
   * elsewhere in this codebase.
   */
  async checkConnections(): Promise<{ checked: number; degraded: number }> {
    if (!this.encryption.isConfigured()) {
      // Without the key we cannot decrypt anything to test it. Say so once
      // rather than marking every connection broken.
      this.logger.warn(
        'Skipping integration health checks: INTEGRATIONS_ENCRYPTION_KEY is not configured',
      );
      return { checked: 0, degraded: 0 };
    }

    const integrations = await this.prisma.sellerIntegration.findMany({
      where: {
        status: { in: [IntegrationStatus.CONNECTED, IntegrationStatus.PAUSED] },
        encryptedCredentials: { not: null },
      },
    });

    let degraded = 0;
    for (const integration of integrations) {
      try {
        const healthy = await this.probe(integration);
        if (healthy === false) {
          degraded += 1;
          await this.integrations.markActionRequired(
            integration.id,
            IntegrationStatus.EXPIRED,
            this.reauthorizeMessage(integration.provider),
          );
          await this.integrations.log(integration.sellerId, integration.id, {
            action: 'CREDENTIALS_REJECTED',
            status: IntegrationLogStatus.FAILURE,
            message: this.reauthorizeMessage(integration.provider),
          });
        } else if (healthy === true && integration.lastError) {
          // Recovered on its own (transient outage): clear the warning.
          await this.prisma.sellerIntegration.update({
            where: { id: integration.id },
            data: { lastError: null, lastErrorAt: null },
          });
        }
      } catch (error) {
        // A provider outage is not a dead credential — leave the connection
        // alone and try again next hour.
        this.logger.warn(
          `Health check for integration ${integration.id} could not complete: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    return { checked: integrations.length, degraded };
  }

  /**
   * Returns true (healthy), false (credential rejected — needs reconnect), or
   * throws when the provider itself is unreachable.
   */
  private async probe(integration: {
    id: string;
    provider: IntegrationProvider;
    externalAccountId: string;
    externalStoreUrl: string | null;
    marketplaceId: string | null;
    region: string | null;
    encryptedCredentials: string | null;
  }): Promise<boolean | null> {
    const credentials = this.encryption.decrypt<Record<string, string>>(
      integration.encryptedCredentials,
    );
    // Undecryptable means the key rolled or the row was tampered with; either
    // way the seller must reconnect.
    if (!credentials) return false;

    switch (integration.provider) {
      case IntegrationProvider.SHOPIFY:
        return this.shopify.verifyCredentials(
          integration.externalAccountId,
          credentials.accessToken,
        );

      case IntegrationProvider.WOOCOMMERCE:
        if (!integration.externalStoreUrl) return false;
        return this.woocommerce.verifyCredentials(
          integration.externalStoreUrl,
          credentials.consumerKey,
          credentials.consumerSecret,
        );

      case IntegrationProvider.AMAZON:
        return this.amazon.verifyCredentials({
          refreshToken: credentials.refreshToken,
          sellingPartnerId: credentials.sellingPartnerId ?? '',
          marketplaceId: integration.marketplaceId ?? '',
          region: integration.region ?? 'na',
        });

      default:
        return null;
    }
  }

  private reauthorizeMessage(provider: IntegrationProvider): string {
    switch (provider) {
      case IntegrationProvider.SHOPIFY:
        return 'Your Shopify connection needs to be reauthorized. Reconnect the store to resume syncing.';
      case IntegrationProvider.WOOCOMMERCE:
        return 'Your WooCommerce API keys are no longer valid. Reconnect the store to resume syncing.';
      case IntegrationProvider.AMAZON:
        return 'Your Amazon connection needs to be reauthorized.';
      default:
        return 'This connection needs to be reauthorized.';
    }
  }
}
