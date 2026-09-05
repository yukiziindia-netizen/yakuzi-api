import { ConfigService } from '@nestjs/config';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { IntegrationOAuthService } from './integration-oauth.service';

const config = {
  get: jest.fn((key: string) => {
    const values: Record<string, string> = {
      SELLER_APP_URL: 'https://seller.yukizi.com',
      API_PUBLIC_URL: 'https://yukizi.com/api',
    };
    return values[key];
  }),
} as unknown as ConfigService;

const build = () => {
  const prisma = {
    integrationOAuthState: {
      create: jest.fn(async ({ data }: any) => data),
      // Default: the state is valid and unused, so exactly one row is burned.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({
        sellerId: 'seller-1',
        context: { shopDomain: 'demo.myshopify.com' },
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    sellerIntegration: { upsert: jest.fn().mockResolvedValue({ id: 'int-1' }) },
    sellerProfile: { findUnique: jest.fn().mockResolvedValue({ state: 'WB' }) },
  };
  const encryption = {
    isConfigured: jest.fn().mockReturnValue(true),
    encrypt: jest.fn().mockReturnValue('v1.enc'),
  };
  const integrations = {
    resolveSellerId: jest.fn().mockResolvedValue('seller-1'),
    log: jest.fn(),
  };
  const shopify = {
    isConfigured: jest.fn().mockReturnValue(true),
    verifyCallbackHmac: jest.fn().mockReturnValue(true),
    buildAuthorizationUrl: jest.fn().mockReturnValue('https://shopify/auth'),
    exchangeCodeForToken: jest.fn().mockResolvedValue({
      accessToken: 'shpat_secret',
      scope: 'read_products',
      shopDomain: 'demo.myshopify.com',
    }),
    fetchShopInfo: jest.fn().mockResolvedValue({
      id: 1,
      name: 'Demo Store',
      domain: 'demo.myshopify.com',
      myshopifyDomain: 'demo.myshopify.com',
    }),
  };
  const woocommerce = {
    checkStore: jest.fn().mockResolvedValue({ reachable: true, isWooCommerce: true }),
    buildAuthorizationUrl: jest.fn().mockReturnValue('https://store/wc-auth'),
    verifyCredentials: jest.fn().mockResolvedValue(true),
  };
  const amazon = {
    isConfigured: jest.fn().mockReturnValue(true),
    listMarketplaces: jest.fn().mockReturnValue([]),
    findMarketplace: jest
      .fn()
      .mockReturnValue({ marketplaceId: 'A21TJRUUN4KGV', region: 'eu', country: 'India' }),
    defaultMarketplaceFor: jest.fn().mockReturnValue({ marketplaceId: 'A21TJRUUN4KGV' }),
    buildAuthorizationUrl: jest.fn().mockReturnValue('https://amazon/consent'),
    exchangeCodeForRefreshToken: jest.fn().mockResolvedValue('Atzr|refresh'),
    fetchParticipations: jest
      .fn()
      .mockResolvedValue([{ marketplaceId: 'A21TJRUUN4KGV', storeName: 'Amazon.in' }]),
  };

  const service = new IntegrationOAuthService(
    prisma as never,
    config,
    encryption as never,
    integrations as never,
    shopify as never,
    woocommerce as never,
    amazon as never,
  );
  return { service, prisma, encryption, integrations, shopify, woocommerce, amazon };
};

describe('IntegrationOAuthService — state issuance', () => {
  beforeEach(() => jest.clearAllMocks());

  it('issues unpredictable, single-use state tied to the seller server-side', async () => {
    const { service, prisma } = build();

    await service.startShopify('user-1', 'demo.myshopify.com');
    await service.startShopify('user-1', 'demo.myshopify.com');

    const first = prisma.integrationOAuthState.create.mock.calls[0][0].data;
    const second = prisma.integrationOAuthState.create.mock.calls[1][0].data;

    expect(first.state).not.toEqual(second.state);
    expect(first.state.length).toBeGreaterThanOrEqual(32);
    expect(first.sellerId).toBe('seller-1');
    expect(first.provider).toBe(IntegrationProvider.SHOPIFY);
    expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses to start any flow when credential storage is not configured', async () => {
    const { service, encryption } = build();
    encryption.isConfigured.mockReturnValue(false);

    await expect(
      service.startShopify('user-1', 'demo.myshopify.com'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('validates the Shopify domain before building the authorization URL', async () => {
    const { service } = build();
    await expect(service.startShopify('user-1', 'evil.com')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('checks a WooCommerce store is really WooCommerce before redirecting the seller', async () => {
    const { service, woocommerce } = build();
    woocommerce.checkStore.mockResolvedValue({
      reachable: true,
      isWooCommerce: false,
      message:
        'This looks like a WordPress site, but the WooCommerce REST API is not enabled. Check that WooCommerce is active on the store.',
    });

    await expect(
      service.startWooCommerce('user-1', 'https://mystore.com'),
    ).rejects.toThrow(/WooCommerce REST API is not enabled/);
  });
});

describe('IntegrationOAuthService — Shopify callback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores an encrypted credential and reports success', async () => {
    const { service, prisma, encryption } = build();

    const url = await service.handleShopifyCallback({
      code: 'authcode',
      shop: 'demo.myshopify.com',
      state: 'valid-state',
      hmac: 'sig',
    });

    expect(encryption.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'shpat_secret' }),
    );
    const upsert = prisma.sellerIntegration.upsert.mock.calls[0][0];
    expect(upsert.create.encryptedCredentials).toBe('v1.enc');
    // The raw token is never written to a column.
    expect(JSON.stringify(upsert)).not.toContain('shpat_secret');
    expect(url).toContain('status=connected');
  });

  it('rejects a callback with an invalid HMAC without touching state or the database', async () => {
    const { service, prisma, shopify } = build();
    shopify.verifyCallbackHmac.mockReturnValue(false);

    const url = await service.handleShopifyCallback({
      code: 'authcode',
      shop: 'demo.myshopify.com',
      state: 'valid-state',
      hmac: 'forged',
    });

    expect(url).toContain('reason=invalid_signature');
    expect(prisma.integrationOAuthState.updateMany).not.toHaveBeenCalled();
    expect(prisma.sellerIntegration.upsert).not.toHaveBeenCalled();
  });

  it('rejects a replayed callback, because burning the state matches zero rows the second time', async () => {
    const { service, prisma } = build();
    prisma.integrationOAuthState.updateMany.mockResolvedValue({ count: 0 });

    const url = await service.handleShopifyCallback({
      code: 'authcode',
      shop: 'demo.myshopify.com',
      state: 'already-used',
      hmac: 'sig',
    });

    expect(url).toContain('reason=expired_state');
    expect(prisma.sellerIntegration.upsert).not.toHaveBeenCalled();
  });

  it('burns the state atomically, only matching rows that are unused and unexpired', async () => {
    const { service, prisma } = build();

    await service.handleShopifyCallback({
      code: 'authcode',
      shop: 'demo.myshopify.com',
      state: 'valid-state',
      hmac: 'sig',
    });

    const where = prisma.integrationOAuthState.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      state: 'valid-state',
      provider: IntegrationProvider.SHOPIFY,
      consumedAt: null,
    });
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it('refuses a callback for a different store than the one the seller started', async () => {
    const { service, prisma } = build();

    const url = await service.handleShopifyCallback({
      code: 'authcode',
      shop: 'attacker.myshopify.com', // state context says demo.myshopify.com
      state: 'valid-state',
      hmac: 'sig',
    });

    expect(url).toContain('reason=store_mismatch');
    expect(prisma.sellerIntegration.upsert).not.toHaveBeenCalled();
  });

  it('treats a missing code as the seller cancelling, not an error', async () => {
    const { service } = build();

    const url = await service.handleShopifyCallback({
      shop: 'demo.myshopify.com',
      state: 'valid-state',
      hmac: 'sig',
    });

    expect(url).toContain('status=cancelled');
  });
});

describe('IntegrationOAuthService — WooCommerce callback', () => {
  beforeEach(() => jest.clearAllMocks());

  const wooState = (prisma: any) =>
    prisma.integrationOAuthState.findUnique.mockResolvedValue({
      sellerId: 'seller-1',
      context: { storeUrl: 'https://mystore.com' },
    });

  it('stores the delivered key pair encrypted after proving it works', async () => {
    const { service, prisma, encryption, woocommerce } = build();
    wooState(prisma);

    await service.handleWooCommerceCallback({
      user_id: 'valid-state',
      consumer_key: 'ck_live',
      consumer_secret: 'cs_live',
      key_permissions: 'read_write',
    });

    expect(woocommerce.verifyCredentials).toHaveBeenCalledWith(
      'https://mystore.com',
      'ck_live',
      'cs_live',
    );
    expect(encryption.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({ consumerKey: 'ck_live', consumerSecret: 'cs_live' }),
    );
    expect(JSON.stringify(prisma.sellerIntegration.upsert.mock.calls[0][0])).not.toContain(
      'cs_live',
    );
  });

  it('rejects credentials the store itself will not accept', async () => {
    const { service, prisma, woocommerce } = build();
    wooState(prisma);
    woocommerce.verifyCredentials.mockResolvedValue(false);

    await expect(
      service.handleWooCommerceCallback({
        user_id: 'valid-state',
        consumer_key: 'ck',
        consumer_secret: 'cs',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sellerIntegration.upsert).not.toHaveBeenCalled();
  });

  it('rejects a callback that carries no valid state, so credentials cannot be injected', async () => {
    const { service, prisma } = build();
    prisma.integrationOAuthState.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.handleWooCommerceCallback({
        user_id: 'forged',
        consumer_key: 'ck',
        consumer_secret: 'cs',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sellerIntegration.upsert).not.toHaveBeenCalled();
  });
});

describe('IntegrationOAuthService — Amazon callback', () => {
  beforeEach(() => jest.clearAllMocks());

  const amazonState = (prisma: any) =>
    prisma.integrationOAuthState.findUnique.mockResolvedValue({
      sellerId: 'seller-1',
      context: { marketplaceId: 'A21TJRUUN4KGV', region: 'eu' },
    });

  it('exchanges the code for a refresh token and stores it encrypted', async () => {
    const { service, prisma, encryption, amazon } = build();
    amazonState(prisma);

    const url = await service.handleAmazonCallback({
      state: 'valid-state',
      spapi_oauth_code: 'code',
      selling_partner_id: 'A1SELLER',
    });

    expect(amazon.exchangeCodeForRefreshToken).toHaveBeenCalledWith('code');
    expect(encryption.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'Atzr|refresh' }),
    );
    expect(JSON.stringify(prisma.sellerIntegration.upsert.mock.calls[0][0])).not.toContain(
      'Atzr|refresh',
    );
    expect(url).toContain('status=connected');
  });

  it('does not mark the channel connected when Amazon rejects the new grant', async () => {
    const { service, prisma, amazon } = build();
    amazonState(prisma);
    amazon.fetchParticipations.mockResolvedValue(null);

    const url = await service.handleAmazonCallback({
      state: 'valid-state',
      spapi_oauth_code: 'code',
      selling_partner_id: 'A1SELLER',
    });

    expect(url).toContain('status=error');
    expect(prisma.sellerIntegration.upsert).not.toHaveBeenCalled();
  });

  it('rejects a forged callback whose state was never issued', async () => {
    const { service, prisma } = build();
    prisma.integrationOAuthState.updateMany.mockResolvedValue({ count: 0 });

    const url = await service.handleAmazonCallback({
      state: 'forged',
      spapi_oauth_code: 'code',
      selling_partner_id: 'A1SELLER',
    });

    expect(url).toContain('reason=expired_state');
    expect(prisma.sellerIntegration.upsert).not.toHaveBeenCalled();
  });
});
