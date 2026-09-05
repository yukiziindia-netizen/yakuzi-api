import {
  IntegrationProvider,
  IntegrationStatus,
  InventoryEventStatus,
  Prisma,
} from '@prisma/client';
import { IntegrationWebhooksService } from './integration-webhooks.service';

const build = () => {
  const prisma = {
    sellerIntegration: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'int-1',
        sellerId: 'seller-1',
        provider: IntegrationProvider.SHOPIFY,
        status: IntegrationStatus.CONNECTED,
        externalAccountId: 'demo.myshopify.com',
      }),
      update: jest.fn(),
    },
    integrationWebhook: { findFirst: jest.fn() },
    integrationProductMapping: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'map-1',
        sellerOfferId: 'offer-1',
      }),
    },
    inventoryEvent: {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const encryption = { decrypt: jest.fn().mockReturnValue({ secret: 'whsec' }) };
  const shopify = { verifyWebhookHmac: jest.fn().mockReturnValue(true) };
  const woocommerce = { verifyWebhookSignature: jest.fn().mockReturnValue(true) };

  const service = new IntegrationWebhooksService(
    prisma as never,
    encryption as never,
    shopify as never,
    woocommerce as never,
  );
  return { service, prisma, shopify, woocommerce, encryption };
};

const shopifyBody = (available: number) =>
  Buffer.from(JSON.stringify({ inventory_item_id: 55, available }));

describe('IntegrationWebhooksService — signature enforcement', () => {
  beforeEach(() => jest.clearAllMocks());

  it('drops an unsigned Shopify webhook before reading the body', async () => {
    const { service, prisma, shopify } = build();
    shopify.verifyWebhookHmac.mockReturnValue(false);

    const result = await service.handleShopifyWebhook({
      rawBody: shopifyBody(4),
      hmac: 'wrong',
      shopDomain: 'demo.myshopify.com',
      topic: 'inventory_levels/update',
      webhookId: 'wh-1',
    });

    expect(result).toEqual({ ok: false, handled: false });
    expect(prisma.sellerIntegration.findFirst).not.toHaveBeenCalled();
    expect(prisma.inventoryEvent.create).not.toHaveBeenCalled();
  });

  it('drops a WooCommerce webhook whose signature does not match its stored secret', async () => {
    const { service, prisma, woocommerce } = build();
    prisma.integrationWebhook.findFirst.mockResolvedValue({
      externalId: '9',
      encryptedSecret: 'v1.enc',
      integration: {
        id: 'int-2',
        sellerId: 'seller-1',
        status: IntegrationStatus.CONNECTED,
      },
    });
    woocommerce.verifyWebhookSignature.mockReturnValue(false);

    const result = await service.handleWooCommerceWebhook({
      rawBody: Buffer.from('{"id":1,"stock_quantity":3}'),
      signature: 'bad',
      webhookId: '9',
    });

    expect(result).toEqual({ ok: false, handled: false });
    expect(prisma.inventoryEvent.create).not.toHaveBeenCalled();
  });

  it('ignores events for a store that is not connected here', async () => {
    const { service, prisma } = build();
    prisma.sellerIntegration.findFirst.mockResolvedValue(null);

    const result = await service.handleShopifyWebhook({
      rawBody: shopifyBody(4),
      hmac: 'ok',
      shopDomain: 'someone-else.myshopify.com',
      topic: 'inventory_levels/update',
      webhookId: 'wh-1',
    });

    expect(result).toEqual({ ok: true, handled: false });
    expect(prisma.inventoryEvent.create).not.toHaveBeenCalled();
  });
});

describe('IntegrationWebhooksService — idempotency', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records the provider event id so a redelivery can be recognised', async () => {
    const { service, prisma } = build();

    await service.handleShopifyWebhook({
      rawBody: shopifyBody(4),
      hmac: 'ok',
      shopDomain: 'demo.myshopify.com',
      topic: 'inventory_levels/update',
      webhookId: 'wh-delivery-1',
    });

    expect(prisma.inventoryEvent.create.mock.calls[0][0].data).toMatchObject({
      sourcePlatform: IntegrationProvider.SHOPIFY,
      sourceEventId: 'wh-delivery-1',
      newQuantity: 4,
    });
  });

  it('acknowledges a duplicate delivery calmly instead of applying it twice', async () => {
    const { service, prisma } = build();
    // The unique index on (sourcePlatform, sourceEventId) rejects the second
    // insert — this is the real defence, and it holds across app instances.
    prisma.inventoryEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.2',
      }),
    );

    const result = await service.handleShopifyWebhook({
      rawBody: shopifyBody(4),
      hmac: 'ok',
      shopDomain: 'demo.myshopify.com',
      topic: 'inventory_levels/update',
      webhookId: 'wh-delivery-1',
    });

    // 200 so the provider stops retrying; handled:false because nothing new
    // happened.
    expect(result).toEqual({ ok: true, handled: false });
  });
});

describe('IntegrationWebhooksService — loop prevention', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips the echo of our own write instead of starting another sync round', async () => {
    const { service, prisma } = build();
    // Yukizi last pushed 4 to this channel.
    prisma.inventoryEvent.findFirst.mockResolvedValue({ newQuantity: 4 });

    const result = await service.handleShopifyWebhook({
      rawBody: shopifyBody(4), // Shopify now reports 4 — confirmation, not news.
      hmac: 'ok',
      shopDomain: 'demo.myshopify.com',
      topic: 'inventory_levels/update',
      webhookId: 'wh-echo',
    });

    const data = prisma.inventoryEvent.create.mock.calls[0][0].data;
    expect(data.status).toBe(InventoryEventStatus.SKIPPED);
    expect(data.skipReason).toBe('ECHO_OF_OUR_WRITE');
    // handled:false means no downstream channel update is triggered.
    expect(result.handled).toBe(false);
  });

  it('processes a genuine external change that differs from our last write', async () => {
    const { service, prisma } = build();
    prisma.inventoryEvent.findFirst.mockResolvedValue({ newQuantity: 4 });

    const result = await service.handleShopifyWebhook({
      rawBody: shopifyBody(3), // A real sale on Shopify: 4 -> 3.
      hmac: 'ok',
      shopDomain: 'demo.myshopify.com',
      topic: 'inventory_levels/update',
      webhookId: 'wh-real',
    });

    const data = prisma.inventoryEvent.create.mock.calls[0][0].data;
    expect(data.status).toBe(InventoryEventStatus.PENDING);
    expect(data.skipReason).toBeNull();
    expect(result.handled).toBe(true);
  });

  it('records an unmapped listing as needing attention rather than dropping it silently', async () => {
    const { service, prisma } = build();
    prisma.integrationProductMapping.findFirst.mockResolvedValue(null);

    await service.handleShopifyWebhook({
      rawBody: shopifyBody(9),
      hmac: 'ok',
      shopDomain: 'demo.myshopify.com',
      topic: 'inventory_levels/update',
      webhookId: 'wh-unmapped',
    });

    const data = prisma.inventoryEvent.create.mock.calls[0][0].data;
    expect(data.status).toBe(InventoryEventStatus.SKIPPED);
    expect(data.skipReason).toBe('NO_MAPPING');
    expect(data.mappingId).toBeNull();
  });
});

describe('IntegrationWebhooksService — app uninstalled', () => {
  beforeEach(() => jest.clearAllMocks());

  it('expires the connection and destroys the token when Shopify reports an uninstall', async () => {
    const { service, prisma } = build();

    const result = await service.handleShopifyWebhook({
      rawBody: Buffer.from('{}'),
      hmac: 'ok',
      shopDomain: 'demo.myshopify.com',
      topic: 'app/uninstalled',
      webhookId: 'wh-uninstall',
    });

    expect(result).toEqual({ ok: true, handled: true });
    expect(prisma.sellerIntegration.update.mock.calls[0][0].data).toMatchObject({
      status: IntegrationStatus.EXPIRED,
      encryptedCredentials: null,
      syncEnabled: false,
    });
  });
});
