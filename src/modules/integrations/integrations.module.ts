import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationCallbacksController } from './integration-callbacks.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationOAuthService } from './integration-oauth.service';
import { IntegrationWebhooksService } from './integration-webhooks.service';
import { IntegrationHealthService } from './integration-health.service';
import { EncryptionService } from './encryption.service';
import { ShopifyProvider } from './providers/shopify.provider';
import { WooCommerceProvider } from './providers/woocommerce.provider';
import { AmazonProvider } from './providers/amazon.provider';

/**
 * External sales-channel integrations.
 *
 * PrismaService and ConfigService come from the app's global modules, so
 * nothing needs importing here — same as every other feature module.
 */
@Module({
  controllers: [IntegrationsController, IntegrationCallbacksController],
  providers: [
    IntegrationsService,
    IntegrationOAuthService,
    IntegrationWebhooksService,
    IntegrationHealthService,
    EncryptionService,
    ShopifyProvider,
    WooCommerceProvider,
    AmazonProvider,
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
