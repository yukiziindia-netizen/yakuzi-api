import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IntegrationLogStatus,
  IntegrationProvider,
  IntegrationStatus,
  Prisma,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from './encryption.service';
import { IntegrationsService } from './integrations.service';
import { ShopifyProvider, SHOPIFY_SCOPES } from './providers/shopify.provider';
import { WooCommerceProvider } from './providers/woocommerce.provider';
import { AmazonProvider } from './providers/amazon.provider';
import { normalizeShopifyDomain, normalizeStoreUrl } from './store-url.util';

/** How long a seller has to complete an authorisation before state expires. */
const STATE_TTL_MS = 15 * 60 * 1000;

/**
 * Owns the three authorisation handshakes end to end: issuing single-use
 * state, validating what comes back, exchanging codes for credentials, and
 * persisting them encrypted.
 *
 * Nothing here ever returns a credential to a caller.
 */
@Injectable()
export class IntegrationOAuthService {
  private readonly logger = new Logger(IntegrationOAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly integrations: IntegrationsService,
    private readonly shopify: ShopifyProvider,
    private readonly woocommerce: WooCommerceProvider,
    private readonly amazon: AmazonProvider,
  ) {}

  /** Where the seller's browser is sent after a flow finishes. */
  private sellerAppUrl(): string {
    return (
      this.configService.get<string>('SELLER_APP_URL')?.trim().replace(/\/$/, '') ||
      'https://seller.yukizi.com'
    );
  }

  /** Public origin of THIS api, used to build callback URLs. */
  private apiPublicUrl(): string {
    return (
      this.configService.get<string>('API_PUBLIC_URL')?.trim().replace(/\/$/, '') ||
      'https://yukizi.com/api'
    );
  }

  /**
   * Builds the seller-app URL the browser lands on at the end of a flow.
   * `status` drives which message the Integrations page shows.
   */
  buildReturnUrl(
    provider: IntegrationProvider,
    status: 'connected' | 'cancelled' | 'error',
    reason?: string,
  ): string {
    const slug = provider.toLowerCase();
    const params = new URLSearchParams({ status });
    if (reason) params.set('reason', reason);
    return `${this.sellerAppUrl()}/integrations/${slug}?${params.toString()}`;
  }

  // ── State ─────────────────────────────────────────────────────────────────

  /**
   * Issues single-use anti-CSRF state. 32 random bytes, stored server-side
   * with the flow context so the callback cannot be told which store/seller it
   * belongs to by the caller.
   */
  private async issueState(
    sellerId: string,
    provider: IntegrationProvider,
    context: Prisma.InputJsonObject,
  ): Promise<string> {
    const state = crypto.randomBytes(32).toString('base64url');
    await this.prisma.integrationOAuthState.create({
      data: {
        state,
        sellerId,
        provider,
        context,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });
    return state;
  }

  /**
   * Validates and burns the state in one atomic step.
   *
   * `updateMany` with `consumedAt: null` in the WHERE clause means a replayed
   * callback updates zero rows and is rejected — a check-then-write would race.
   */
  private async consumeState(
    state: string | undefined,
    provider: IntegrationProvider,
  ): Promise<{ sellerId: string; context: Record<string, unknown> }> {
    if (!state) {
      throw new BadRequestException('Missing authorization state.');
    }

    const consumed = await this.prisma.integrationOAuthState.updateMany({
      where: {
        state,
        provider,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });

    if (consumed.count !== 1) {
      // Covers: unknown state, wrong provider, already used, expired.
      throw new BadRequestException(
        'This authorization link is no longer valid. Please start again.',
      );
    }

    const row = await this.prisma.integrationOAuthState.findUnique({
      where: { state },
    });
    if (!row) {
      throw new BadRequestException('This authorization link is not valid.');
    }

    return {
      sellerId: row.sellerId,
      context: (row.context as Record<string, unknown>) ?? {},
    };
  }

  /** Guard shared by all three start flows. */
  private assertCredentialStorageReady(): void {
    if (!this.encryption.isConfigured()) {
      this.logger.error(
        'INTEGRATIONS_ENCRYPTION_KEY is not set — refusing to start an authorization flow that would produce an unstorable credential.',
      );
      throw new ServiceUnavailableException(
        'Integrations are not available yet. Please contact Yukizi support.',
      );
    }
  }

  // ── Shopify ───────────────────────────────────────────────────────────────

  async startShopify(userId: string, shopDomainInput: string) {
    this.assertCredentialStorageReady();
    const sellerId = await this.integrations.resolveSellerId(userId);
    const shopDomain = normalizeShopifyDomain(shopDomainInput);

    const state = await this.issueState(sellerId, IntegrationProvider.SHOPIFY, {
      shopDomain,
    });

    return {
      authorizationUrl: this.shopify.buildAuthorizationUrl(shopDomain, state),
    };
  }

  /**
   * Shopify callback. Order matters: HMAC first (proves Shopify sent this),
   * then state (proves we started it), and only then the code exchange.
   */
  async handleShopifyCallback(query: Record<string, string>): Promise<string> {
    if (!this.shopify.verifyCallbackHmac(query)) {
      this.logger.warn('Rejected a Shopify callback with an invalid HMAC');
      return this.buildReturnUrl(
        IntegrationProvider.SHOPIFY,
        'error',
        'invalid_signature',
      );
    }

    let sellerId: string;
    let expectedShop: string;
    try {
      const consumed = await this.consumeState(
        query.state,
        IntegrationProvider.SHOPIFY,
      );
      sellerId = consumed.sellerId;
      expectedShop = String(consumed.context.shopDomain ?? '');
    } catch {
      return this.buildReturnUrl(
        IntegrationProvider.SHOPIFY,
        'error',
        'expired_state',
      );
    }

    const shop = normalizeShopifyDomain(query.shop ?? expectedShop);
    // The shop that came back must be the shop the seller asked for; otherwise
    // a valid-looking callback could attach someone else's store.
    if (expectedShop && shop !== expectedShop) {
      this.logger.warn('Shopify callback shop did not match the initiated shop');
      return this.buildReturnUrl(
        IntegrationProvider.SHOPIFY,
        'error',
        'store_mismatch',
      );
    }

    if (!query.code) {
      return this.buildReturnUrl(IntegrationProvider.SHOPIFY, 'cancelled');
    }

    try {
      const credentials = await this.shopify.exchangeCodeForToken(
        shop,
        query.code,
      );
      const shopInfo = await this.shopify.fetchShopInfo(
        shop,
        credentials.accessToken,
      );

      await this.persistConnection({
        sellerId,
        provider: IntegrationProvider.SHOPIFY,
        externalAccountId: shop,
        externalStoreName: shopInfo.name,
        externalStoreUrl: `https://${shopInfo.domain}`,
        scopes: credentials.scope
          ? credentials.scope.split(',').map((s) => s.trim())
          : SHOPIFY_SCOPES,
        credentials: {
          accessToken: credentials.accessToken,
          scope: credentials.scope,
          shopDomain: shop,
        },
      });

      return this.buildReturnUrl(IntegrationProvider.SHOPIFY, 'connected');
    } catch (error) {
      this.logger.error(
        `Shopify connection failed for seller ${sellerId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      await this.integrations.log(sellerId, null, {
        action: 'CONNECT_FAILED',
        status: IntegrationLogStatus.FAILURE,
        message: 'Shopify connection could not be completed.',
      });
      return this.buildReturnUrl(
        IntegrationProvider.SHOPIFY,
        'error',
        'exchange_failed',
      );
    }
  }

  // ── WooCommerce ───────────────────────────────────────────────────────────

  /** Pre-flight probe used by the connect modal. */
  async checkWooCommerceStore(userId: string, storeUrl: string) {
    await this.integrations.resolveSellerId(userId);
    return this.woocommerce.checkStore(storeUrl);
  }

  async startWooCommerce(userId: string, storeUrlInput: string) {
    this.assertCredentialStorageReady();
    const sellerId = await this.integrations.resolveSellerId(userId);
    const storeUrl = normalizeStoreUrl(storeUrlInput);

    // Fail before redirecting rather than after: a seller who lands on a
    // WordPress 404 has no idea what went wrong.
    const check = await this.woocommerce.checkStore(storeUrl);
    if (!check.reachable || !check.isWooCommerce) {
      throw new BadRequestException(
        check.message ??
          "We couldn't connect to this WooCommerce store. Check the store URL and try again.",
      );
    }

    const state = await this.issueState(
      sellerId,
      IntegrationProvider.WOOCOMMERCE,
      { storeUrl },
    );

    return {
      authorizationUrl: this.woocommerce.buildAuthorizationUrl({
        storeUrl,
        appName: 'Yukizi',
        state,
        returnUrl: this.buildReturnUrl(
          IntegrationProvider.WOOCOMMERCE,
          'connected',
        ),
        callbackUrl: `${this.apiPublicUrl()}/integrations/woocommerce/callback`,
      }),
    };
  }

  /**
   * WooCommerce POSTs the generated key pair here, server to server. The
   * browser is redirected separately to `return_url`, so this method's
   * response is never seen by a human.
   *
   * `user_id` is the state we issued — it is the only thing tying these
   * credentials to a seller.
   */
  async handleWooCommerceCallback(body: {
    key_id?: number;
    user_id?: string;
    consumer_key?: string;
    consumer_secret?: string;
    key_permissions?: string;
  }): Promise<void> {
    const { sellerId, context } = await this.consumeState(
      body.user_id,
      IntegrationProvider.WOOCOMMERCE,
    );
    const storeUrl = String(context.storeUrl ?? '');

    if (!body.consumer_key || !body.consumer_secret || !storeUrl) {
      throw new BadRequestException('Incomplete WooCommerce callback.');
    }

    // Prove the delivered credentials actually work before we call this
    // connected — otherwise the seller sees "Connected" over a dead key.
    const valid = await this.woocommerce.verifyCredentials(
      storeUrl,
      body.consumer_key,
      body.consumer_secret,
    );
    if (!valid) {
      await this.integrations.log(sellerId, null, {
        action: 'CONNECT_FAILED',
        status: IntegrationLogStatus.FAILURE,
        message:
          'WooCommerce returned API credentials that were rejected by the store.',
      });
      throw new BadRequestException('WooCommerce credentials were rejected.');
    }

    const host = new URL(storeUrl).hostname;
    await this.persistConnection({
      sellerId,
      provider: IntegrationProvider.WOOCOMMERCE,
      externalAccountId: host,
      externalStoreName: host,
      externalStoreUrl: storeUrl,
      scopes: [body.key_permissions ?? 'read_write'],
      credentials: {
        consumerKey: body.consumer_key,
        consumerSecret: body.consumer_secret,
        keyPermissions: body.key_permissions ?? 'read_write',
        storeUrl,
      },
    });
  }

  // ── Amazon ────────────────────────────────────────────────────────────────

  /** Marketplace picker options, with a default derived from the seller. */
  async getAmazonMarketplaces(userId: string) {
    const sellerId = await this.integrations.resolveSellerId(userId);
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { id: sellerId },
      select: { state: true, city: true },
    });

    // Yukizi sellers are India-based; the picker still lets them change it.
    const suggested = this.amazon.defaultMarketplaceFor(
      seller?.state ? 'India' : undefined,
    );

    return {
      marketplaces: this.amazon.listMarketplaces(),
      defaultMarketplaceId: suggested.marketplaceId,
    };
  }

  async startAmazon(userId: string, marketplaceId: string) {
    this.assertCredentialStorageReady();
    const sellerId = await this.integrations.resolveSellerId(userId);

    const marketplace = this.amazon.findMarketplace(marketplaceId);
    if (!marketplace) {
      throw new BadRequestException('Choose a supported Amazon marketplace.');
    }

    const state = await this.issueState(sellerId, IntegrationProvider.AMAZON, {
      marketplaceId: marketplace.marketplaceId,
      region: marketplace.region,
    });

    return {
      authorizationUrl: this.amazon.buildAuthorizationUrl(
        marketplace.marketplaceId,
        state,
      ),
    };
  }

  /**
   * Amazon callback. Returns the seller-app URL to redirect to.
   *
   * Amazon sends `selling_partner_id`, `spapi_oauth_code` and our `state`.
   * There is no signature to verify, which makes the single-use state check
   * the entire anti-CSRF boundary.
   */
  async handleAmazonCallback(query: Record<string, string>): Promise<string> {
    let sellerId: string;
    let context: Record<string, unknown>;
    try {
      const consumed = await this.consumeState(
        query.state,
        IntegrationProvider.AMAZON,
      );
      sellerId = consumed.sellerId;
      context = consumed.context;
    } catch {
      return this.buildReturnUrl(
        IntegrationProvider.AMAZON,
        'error',
        'expired_state',
      );
    }

    const code = query.spapi_oauth_code;
    if (!code) {
      return this.buildReturnUrl(IntegrationProvider.AMAZON, 'cancelled');
    }

    const marketplaceId = String(context.marketplaceId ?? '');
    const region = String(context.region ?? 'na');
    const sellingPartnerId = query.selling_partner_id ?? '';

    try {
      const refreshToken = await this.amazon.exchangeCodeForRefreshToken(code);

      const credentials = {
        refreshToken,
        sellingPartnerId,
        marketplaceId,
        region,
      };

      // Confirm the grant actually works before reporting success.
      const participations = await this.amazon.fetchParticipations(credentials);
      if (participations === null) {
        throw new BadRequestException('Amazon rejected the new authorization.');
      }

      const storeName =
        participations.find((p) => p.marketplaceId === marketplaceId)
          ?.storeName ??
        this.amazon.findMarketplace(marketplaceId)?.country ??
        'Amazon';

      await this.persistConnection({
        sellerId,
        provider: IntegrationProvider.AMAZON,
        externalAccountId: sellingPartnerId || marketplaceId,
        externalStoreName: `Amazon ${storeName}`,
        externalStoreUrl: null,
        marketplaceId,
        region,
        scopes: ['sellingpartnerapi::listings', 'sellingpartnerapi::notifications'],
        credentials,
      });

      return this.buildReturnUrl(IntegrationProvider.AMAZON, 'connected');
    } catch (error) {
      this.logger.error(
        `Amazon connection failed for seller ${sellerId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      await this.integrations.log(sellerId, null, {
        action: 'CONNECT_FAILED',
        status: IntegrationLogStatus.FAILURE,
        message: 'Amazon connection could not be completed.',
      });
      return this.buildReturnUrl(
        IntegrationProvider.AMAZON,
        'error',
        'exchange_failed',
      );
    }
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /**
   * Creates or refreshes a connection row.
   *
   * Upsert on (sellerId, provider, externalAccountId) means reconnecting the
   * SAME store updates the existing row — keeping its mappings and history —
   * while a different store would create a separate row, which is what makes
   * multi-store support possible later without a schema change.
   */
  private async persistConnection(input: {
    sellerId: string;
    provider: IntegrationProvider;
    externalAccountId: string;
    externalStoreName: string | null;
    externalStoreUrl: string | null;
    marketplaceId?: string | null;
    region?: string | null;
    scopes: string[];
    credentials: Record<string, unknown>;
  }): Promise<void> {
    const encryptedCredentials = this.encryption.encrypt(input.credentials);

    const shared = {
      status: IntegrationStatus.CONNECTED,
      externalStoreName: input.externalStoreName,
      externalStoreUrl: input.externalStoreUrl,
      marketplaceId: input.marketplaceId ?? null,
      region: input.region ?? null,
      encryptedCredentials,
      credentialsKeyVersion: 1,
      scopes: input.scopes,
      syncEnabled: true,
      lastError: null,
      lastErrorAt: null,
      disconnectedAt: null,
    };

    const integration = await this.prisma.sellerIntegration.upsert({
      where: {
        sellerId_provider_externalAccountId: {
          sellerId: input.sellerId,
          provider: input.provider,
          externalAccountId: input.externalAccountId,
        },
      },
      create: {
        sellerId: input.sellerId,
        provider: input.provider,
        externalAccountId: input.externalAccountId,
        ...shared,
      },
      update: shared,
    });

    await this.integrations.log(input.sellerId, integration.id, {
      action: 'CONNECTED',
      status: IntegrationLogStatus.SUCCESS,
      message: `Connected ${input.externalStoreName ?? input.externalAccountId}.`,
    });
  }

  /**
   * Housekeeping for expired state rows. Called by the health cron rather than
   * on the request path.
   */
  async pruneExpiredStates(): Promise<number> {
    const { count } = await this.prisma.integrationOAuthState.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    return count;
  }
}
